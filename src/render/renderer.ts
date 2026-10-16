import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { placeCheck } from '../sim/commands';
import { SUPPLY_RANGE, hasDisc, isExplored, isVisible } from '../sim/rules';
import type { Building, BuildingKind, GameEvent, ResNode, World } from '../sim/types';
import { isWinter } from '../sim/util';
import { settings, onSettings } from '../ui/settings';
import { HEIGHT_RES, WATER_LEVEL, bakeTerrain, buildHeightGrid, hash2 } from './art';
import type { Camera } from './camera';
import { Arrows, AmbientLife, Particles, Rings } from './effects';
import { Grass } from './grass';
import type { BuildingModel } from './models';
import { RANK_KILLS } from '../sim/rules';
import { MAPS } from '../data/maps';
import { MAT, blobGeo, blobMat, buildBuilding, enhance, makeBushGeo, makeCarcassGeo, makeRockGeos, makeTreeGeos, merge, shared } from './models';
import { Post } from './post';
import type { Rig } from './rigs';
import { leaderGeometry, leaderMaterial } from './characters';
import { animateRig, createRig } from './rigs';

export interface Overlay {
  selUnits: number[];
  allBars?: boolean;
  selBuilding: number | null;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  place: { kind: BuildingKind; tx: number; ty: number } | null;
  alpha: number;
  pings: { x: number; y: number; age: number; c: string }[];
}

/** Which tree variants grow in each biome (indices into makeTreeGeos). */
const TREE_MIX: Record<string, number[]> = { autumn: [0, 1, 2, 3, 4, 5, 6, 7], lush: [0, 6, 6, 3, 2, 0, 7], tundra: [2, 5, 2, 5, 3], steppe: [7, 1, 3, 7, 4], badlands: [7, 3, 7, 5] };

const fishMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.3, metalness: 0.5, emissive: 0x335566, emissiveIntensity: 0.5, flatShading: true });
function fishGeo() {
  const g = new THREE.SphereGeometry(0.11, 6, 4).scale(1, 0.55, 2.3), tail = new THREE.ConeGeometry(0.07, 0.16, 4).rotateX(-Math.PI / 2).translate(0, 0, -0.3);
  return merge([{ g, c: '#d8ecf6', p: [0, 0, 0] }, { g: tail, c: '#9fc8de', p: [0, 0, 0] }]);
}

interface BEntry { fx?: number; model: BuildingModel; scaffold: THREE.Object3D; ring?: THREE.Mesh; tier: number; done: boolean; phase: number; pop: number; cx: number; cz: number }
interface Floater { x: number; y: number; text: string; color: string; age: number; life: number; big?: boolean }
interface FallingTree { mesh: THREE.Mesh; t: number; dx: number; dz: number; landed: boolean }
type Q = 'high' | 'medium' | 'low';

const FOV_TAN = Math.tan((30 * Math.PI) / 360);
const RES_COL: Record<string, string> = { food: '#ff9c86', wood: '#e0ac74', stone: '#d6dbe4', knowledge: '#ffe27a', provisions: '#f0b070' };
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export class Renderer {
  three!: THREE.WebGLRenderer;
  ctx: CanvasRenderingContext2D;
  terrain: object | null = null;       // set to null to force a rebuild for a new world
  terrainCanvas: HTMLCanvasElement | null = null;
  dpr = 1;
  winterLevel = 0;
  night = 0;
  quality: Q = 'high';
  private overlay: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private hemi = new THREE.HemisphereLight(0xbcd4ff, 0x6b5a3a, 0.6);
  private sun = new THREE.DirectionalLight(0xfff0d6, 2.3);
  private lights: THREE.PointLight[] = [];
  private bakedFor: World | null = null;
  private heights: ArrayLike<number> = [];
  private gw = 0;
  private waterNormal!: THREE.Texture;
  private fogData = new Uint8Array(4);
  private fogTex!: THREE.DataTexture;
  private fogTick = -99;
  private wearW = 0; private wearH = 0; private wearData = new Uint8Array(1); private wearTex!: THREE.DataTexture; private wearAt = 0;
  private blobs!: THREE.InstancedMesh;
  private ice: THREE.Mesh | null = null;
  private fish!: THREE.InstancedMesh; private fishCount = 0;
  private treeMeshes: THREE.InstancedMesh[] = [];
  private bushFull!: THREE.InstancedMesh; private bushEmpty!: THREE.InstancedMesh;
  private rockMeshes: THREE.InstancedMesh[] = [];
  private carcass!: THREE.InstancedMesh;
  private nodeSig = '';
  private bMap = new Map<number, BEntry>();
  private rigs = new Map<number, Rig>();
  private dying: { rig: Rig; t: number }[] = [];
  private smoke!: THREE.Points; private smokeMat!: THREE.ShaderMaterial;
  private snow!: THREE.Points; private snowMat!: THREE.ShaderMaterial;
  private landmarks = new Map<string, THREE.Group>();
  private ghost: { kind: BuildingKind; group: THREE.Group; foot: THREE.Mesh } | null = null;
  private lastTime = 0;
  private dummy = new THREE.Object3D();
  private cols: Record<string, THREE.Color> = {};
  private particles = new Particles(900, false);
  private sparks = new Particles(500, true);
  private arrows = new Arrows();
  private rings = new Rings();
  private ambient = new AmbientLife();
  private grass = new Grass();
  private falling: FallingTree[] = [];
  private floaters: Floater[] = [];
  private post: Post | null = null;
  private perfAcc = 0; private perfN = 0; private perfCool = 0;
  private dprCap = 1.5;
  private shadowSize = 2048;

  constructor(public canvas: HTMLCanvasElement, public cam: Camera) {
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.NeutralToneMapping;
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x10151c);
    this.scene.fog = new THREE.Fog(0x9db0c4, 70, 170);
    this.scene.add(this.root, this.hemi, this.sun, this.sun.target, this.particles.points, this.sparks.points, this.arrows.group, this.rings.group, this.ambient.group, this.grass.mesh);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 110;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa050, 0, 11, 1.8); this.scene.add(l); this.lights.push(l); }
    this.overlay = document.createElement('canvas'); this.overlay.id = 'overlay';
    canvas.parentElement!.insertBefore(this.overlay, canvas.nextSibling);
    this.ctx = this.overlay.getContext('2d')!;
    this.cols = {
      sunDay: new THREE.Color(0xfff0d6), sunDusk: new THREE.Color(0xff9a5a), sunNight: new THREE.Color(0x8fa6ff), sunW: new THREE.Color(0xcfe0ff),
      skyDay: new THREE.Color(0xbcd4ff), skyNight: new THREE.Color(0x5a74b8), bgDay: new THREE.Color(0x9db0c4), bgDusk: new THREE.Color(0xc98a6a), bgNight: new THREE.Color(0x0f1626), bgW: new THREE.Color(0xc9d6e4),
    };
    this.buildEnvironment();
    this.quality = this.pickQuality(); this.applyQuality();
    onSettings(() => { const q = this.pickQuality(); if (q !== this.quality) { this.quality = q; this.applyQuality(); } });
  }

  // ------------------------------------------------------------------ quality
  private pickQuality(): Q {
    if (settings.quality !== 'auto') return settings.quality;
    const small = window.innerWidth < 900 || window.innerHeight < 560 || navigator.maxTouchPoints > 0;
    return small ? 'medium' : 'high';
  }
  private applyQuality() {
    const q = this.quality;
    this.dprCap = q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 1;
    this.shadowSize = q === 'high' ? 2048 : 1024;
    this.sun.castShadow = q !== 'low';
    if (this.sun.shadow.mapSize.x !== this.shadowSize) { this.sun.shadow.mapSize.set(this.shadowSize, this.shadowSize); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.grass.spacing = q === 'high' ? 0.19 : q === 'medium' ? 0.3 : 0.55; this.grass.radius = q === 'high' ? 22 : q === 'medium' ? 18 : 13;
    this.grass.mesh.visible = true;
    this.resize();
    this.nodeSig = ''; this.fogTick = -99;
    if (this.bakedFor) this.grass.update(this.cam.x, this.cam.y, this.bakedFor, this.heightAt, this.winterLevel, true);
  }
  /** Automatic quality: step down when the frame rate stays low. */
  private watchPerf(dt: number) {
    if (settings.quality !== 'auto' || dt <= 0 || dt > 0.25) return;
    this.perfAcc += dt; this.perfN++; this.perfCool = Math.max(0, this.perfCool - dt);
    if (this.perfN < 100) return;
    const avg = this.perfAcc / this.perfN; this.perfAcc = 0; this.perfN = 0;
    if (avg > 0.036 && this.perfCool <= 0 && this.quality !== 'low') { this.quality = this.quality === 'high' ? 'medium' : 'low'; this.perfCool = 6; this.applyQuality(); }
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const r = this.canvas.getBoundingClientRect();
    this.three.setPixelRatio(this.dpr);
    this.three.setSize(r.width, r.height, false);
    this.overlay.width = Math.round(r.width * this.dpr); this.overlay.height = Math.round(r.height * this.dpr);
    this.cam.setSize(r.width, r.height);
    this.post?.resize(r.width, r.height, this.dpr);
  }

  clear() { this.three.setClearColor(0x0d100c); this.three.clear(); }

  private buildEnvironment() {
    const env = new THREE.Scene();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h=vP.y; vec3 sky=mix(vec3(.62,.74,.86),vec3(.2,.4,.8),smoothstep(0.,.8,h)); vec3 gr=mix(vec3(.45,.42,.3),vec3(.22,.28,.18),smoothstep(0.,-.7,h)); vec3 c=h>0.?sky:gr; float s=pow(max(dot(vP,normalize(vec3(.5,.55,.3))),0.),50.); c+=vec3(1.,.82,.55)*s*2.2; gl_FragColor=vec4(c,1.); }',
    });
    env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
    const pm = new THREE.PMREMGenerator(this.three);
    this.scene.environment = pm.fromScene(env, 0.04).texture; this.scene.environmentIntensity = 0.45; pm.dispose();
  }

  // ------------------------------------------------------------------ terrain queries
  heightAt = (x: number, y: number): number => {
    if (!this.gw) return 0;
    const R = HEIGHT_RES, GW = this.gw, GH = this.heights.length / GW, hs = this.heights;
    const fx = Math.max(0, Math.min(GW - 1.001, x * R)), fy = Math.max(0, Math.min(GH - 1.001, y * R));
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const a = hs[iy * GW + ix], b = hs[iy * GW + ix + 1], c = hs[(iy + 1) * GW + ix], d = hs[(iy + 1) * GW + ix + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  // ------------------------------------------------------------------ one-time scene build for a world
  private setup(w: World) {
    for (const o of [...this.root.children]) this.root.remove(o);
    this.bMap.clear(); this.rigs.clear(); this.dying = []; this.falling = []; this.floaters = []; this.landmarks.clear(); this.ghost = null; this.nodeSig = '';
    const W = w.W, H = w.H, R = HEIGHT_RES;
    this.heights = buildHeightGrid(w); this.gw = W * R + 1;
    this.cam.heightAt = this.heightAt;
    this.cam.worldW = W; this.cam.worldH = H;
    this.terrainCanvas = bakeTerrain(w);
    this.terrain = {};
    this.bakedFor = w;

    const geo = new THREE.PlaneGeometry(W, H, W * R, H * R).rotateX(-Math.PI / 2).translate(W / 2, 0, H / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heights[i]);
    geo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(this.terrainCanvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, this.three.capabilities.getMaxAnisotropy()); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const ground = new THREE.Mesh(geo, enhance(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }), { snow: 1, wear: true }));
    ground.receiveShadow = true; this.root.add(ground);

    const wp: number[] = [], wuv: number[] = [];
    const isW = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (w.terrain[y][x] === '~' || w.terrain[y][x] === '=' || w.terrain[y][x] === 'L');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isW(x + dx, y + dy)) { near = true; break; }
      if (!near) continue;
      for (const [qx, qy] of [[x, y], [x, y + 1], [x + 1, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) { wp.push(qx, WATER_LEVEL, qy); wuv.push(qx / 5, qy / 5); }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2)); wg.computeVertexNormals();
    this.waterNormal = this.makeWaterNormal();
    const wm = new THREE.Mesh(wg, enhance(new THREE.MeshStandardMaterial({ color: 0x2f7fae, transparent: true, opacity: 0.74, roughness: 0.06, metalness: 0.15, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false, envMapIntensity: 1.6 }), {}));
    wm.renderOrder = 1; this.root.add(wm);
    // open sea around the island so the map edge never reads as a void
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(520, 520).rotateX(-Math.PI / 2), enhance(new THREE.MeshStandardMaterial({ color: 0x2a6f96, roughness: 0.2, metalness: 0.1, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.3 }), {}));
    sea.position.set(W / 2, WATER_LEVEL - 0.04, H / 2); sea.renderOrder = 0; this.root.add(sea);
    // winter ice over the lake tiles: fades in as the season turns, glossy and white-blue
    const ip: number[] = [], iu: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (w.terrain[y][x] === 'L') for (const [qx, qy] of [[x, y], [x, y + 1], [x + 1, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) { ip.push(qx, WATER_LEVEL + 0.035, qy); iu.push(qx / 3, qy / 3); }
    this.ice = null;
    if (ip.length) {
      const ig = new THREE.BufferGeometry(); ig.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3)); ig.setAttribute('uv', new THREE.Float32BufferAttribute(iu, 2)); ig.computeVertexNormals();
      const im = new THREE.Mesh(ig, enhance(new THREE.MeshStandardMaterial({ color: 0xd4eaf6, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.12, 0.12), envMapIntensity: 1.8, depthWrite: false }), { snow: 0 }));
      im.renderOrder = 2; im.visible = false; this.root.add(im); this.ice = im;
    }
    // fishing spots: little silver shoals that circle and glint, with a ripple ring
    this.fishCount = w.nodes.filter((n) => n.kind === 'fish').length;
    this.fish = this.inst(fishGeo(), fishMat, Math.max(1, this.fishCount * 5)); this.fish.frustumCulled = false; this.root.add(this.fish);
    // footpaths: foot traffic is accumulated into a texture the ground shader reads
    this.wearW = W * 4; this.wearH = H * 4; this.wearData = new Uint8Array(this.wearW * this.wearH);
    this.wearTex = new THREE.DataTexture(this.wearData, this.wearW, this.wearH, THREE.RedFormat); this.wearTex.magFilter = THREE.LinearFilter; this.wearTex.minFilter = THREE.LinearFilter; this.wearTex.needsUpdate = true;
    shared.wear.value = this.wearTex; this.wearAt = 0;

    this.fogData = new Uint8Array(W * 4 * H * 4 * 4);
    this.fogTex = new THREE.DataTexture(this.fogData, W * 4, H * 4, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
    shared.fogMap.value = this.fogTex; shared.mapSize.value.set(W, H);
    this.fogTick = -99;

    const caps = { tree: 0, bush: 0, rock: 0 };
    for (const n of w.nodes) if (n.kind === 'tree') caps.tree++; else if (n.kind === 'bush') caps.bush++; else if (n.kind === 'rock') caps.rock++;
    this.treeMeshes = makeTreeGeos().map((g) => this.inst(g, MAT.tree, caps.tree + 4));
    this.bushFull = this.inst(makeBushGeo(true), MAT.prop, caps.bush + 2); this.bushEmpty = this.inst(makeBushGeo(false), MAT.prop, caps.bush + 2);
    this.rockMeshes = makeRockGeos().map((g) => this.inst(g, MAT.prop, caps.rock + 4));
    this.carcass = this.inst(makeCarcassGeo(), MAT.prop, 60);
    for (const m of [...this.treeMeshes, this.bushFull, this.bushEmpty, ...this.rockMeshes, this.carcass]) { m.castShadow = true; m.receiveShadow = true; this.root.add(m); }

    // soft contact shadows ground every tree, bush and rock
    this.blobs = this.inst(blobGeo, blobMat, w.nodes.length + 8); this.blobs.renderOrder = 2; this.root.add(this.blobs);

    const N = 24 * 8, sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); sg.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(N).fill(1), 1));
    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute float aT; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = (0.4+aT*1.3)*uScale/-mv.z; vA = (1.0-aT)*smoothstep(0.0,0.1,aT)*0.55; }',
      fragmentShader: 'varying float vA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(0.82,0.83,0.86,smoothstep(0.5,0.05,d)*vA); \n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
    });
    this.smoke = new THREE.Points(sg, this.smokeMat); this.smoke.frustumCulled = false; this.smoke.renderOrder = 3; this.root.add(this.smoke);
    const SN = 1600, snp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) { snp[i * 3] = Math.random() * 60; snp[i * 3 + 1] = Math.random() * 30; snp[i * 3 + 2] = Math.random() * 60; }
    const sng = new THREE.BufferGeometry(); sng.setAttribute('position', new THREE.BufferAttribute(snp, 3));
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uFocus: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLevel: { value: 0 }, uScale: { value: 600 } },
      vertexShader: 'uniform vec3 uFocus; uniform float uTime; uniform float uScale; void main(){ vec3 p=position; float fall=mod(p.y-uTime*(1.2+fract(p.x*7.13)*0.9),30.0); vec2 xz=mod(p.xz-uFocus.xz+30.0,60.0)-30.0+uFocus.xz; xz.x+=sin(uTime*0.8+p.z)*0.4; vec4 mv=viewMatrix*vec4(xz.x,fall-1.0,xz.y,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=0.07*uScale/-mv.z; }',
      fragmentShader: 'uniform float uLevel; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(1.0,1.0,1.0,smoothstep(0.5,0.1,d)*uLevel*0.85); }',
    });
    this.snow = new THREE.Points(sng, this.snowMat); this.snow.frustumCulled = false; this.snow.renderOrder = 4; this.root.add(this.snow);

    for (const l of w.landmarks) {
      const g = new THREE.Group(); g.position.set(l.x + 0.5, this.heightAt(l.x + 0.5, l.y + 0.5), l.y + 0.5);
      if (l.id === 'cave') {
        const parts = [{ g: new THREE.DodecahedronGeometry(1.1, 0), c: '#7a7b86', p: [0, 0.9, -0.5] as [number, number, number], s: [1.6, 1.1, 1] as [number, number, number] }, { g: new THREE.DodecahedronGeometry(0.8, 0), c: '#6a6b76', p: [-1.2, 0.5, 0.2] as [number, number, number] }, { g: new THREE.DodecahedronGeometry(0.8, 0), c: '#85868f', p: [1.2, 0.5, 0.1] as [number, number, number] }, { g: new THREE.CircleGeometry(0.62, 12), c: '#120c08', p: [0, 0.55, 0.52] as [number, number, number] }];
        const m = new THREE.Mesh(merge(parts), MAT.prop); m.castShadow = true; g.add(m);
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 6), MAT.flame); f.position.set(0, 0.45, 0.6); g.add(f);
      } else {
        const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.5, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe99a, transparent: true, opacity: 0.55, depthWrite: false }));
        ring.position.y = 0.12; g.add(ring);
        const m = new THREE.Mesh(merge([{ g: new THREE.CylinderGeometry(0.04, 0.05, 2.2, 5), c: '#5a3d25', p: [0, 1.1, 0] }, { g: new THREE.BoxGeometry(0.8, 0.45, 0.03), c: '#ffd54a', p: [0.42, 1.95, 0] }]), MAT.prop); g.add(m);
      }
      this.root.add(g); this.landmarks.set(l.id, g);
    }
    this.grass.update(this.cam.x, this.cam.y, w, this.heightAt, 0, true);
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); return m;
  }

  private makeWaterNormal() {
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d')!, img = g.createImageData(S, S);
    const hf = (x: number, y: number) => { const u = (x / S) * 6.283, v = (y / S) * 6.283; return Math.sin(u * 2 + Math.sin(v * 3) * 1.2) * 0.5 + Math.sin(v * 3 + u) * 0.35 + Math.sin(u * 5 - v * 4) * 0.2; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = hf(x + 1, y) - hf(x - 1, y), dy = hf(x, y + 1) - hf(x, y - 1), o = (y * S + x) * 4;
      img.data[o] = 128 - dx * 90; img.data[o + 1] = 128 - dy * 90; img.data[o + 2] = 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  // ------------------------------------------------------------------ gameplay events -> visual effects
  onEvents(w: World, evs: GameEvent[], time: number) {
    for (const e of evs) {
      if (e.owner !== 0 && e.owner !== undefined && !isVisible(w, e.x, e.y) && e.k !== 'felled') continue;
      const h = this.heightAt(e.x, e.y), P = this.particles, S = this.sparks, r = Math.random;
      const dust = (x: number, y: number, z: number, n: number, col = 0xb7a98a, sz = 0.35, up = 0.8) => { for (let i = 0; i < n; i++) P.spawn(x + (r() - 0.5) * 0.4, y, z + (r() - 0.5) * 0.4, (r() - 0.5) * 1.2, up * (0.4 + r()), (r() - 0.5) * 1.2, 0.7 + r() * 0.5, sz * 0.5, sz * 1.5, col, -0.3, 1.6, 0.55); };
      switch (e.k) {
        case 'chop': for (let i = 0; i < 6; i++) P.spawn(e.x, h + 0.9, e.y, (r() - 0.5) * 3, 1.2 + r() * 2, (r() - 0.5) * 3, 0.7, 0.09, 0.05, i % 2 ? 0x9a6a3a : 0xc9a070, 7, 0.3, 1); dust(e.x, h + 0.2, e.y, 2, 0x8a7a5a, 0.3, 0.3); break;
        case 'mine': for (let i = 0; i < 5; i++) S.spawn(e.x, h + 0.6, e.y, (r() - 0.5) * 3.5, 1 + r() * 2.2, (r() - 0.5) * 3.5, 0.4, 0.09, 0.01, 0xffd89a, 8, 0.2, 1); dust(e.x, h + 0.3, e.y, 2, 0xa8a8b0, 0.35, 0.5); break;
        case 'pick': for (let i = 0; i < 3; i++) P.spawn(e.x, h + 0.5, e.y, (r() - 0.5) * 1.2, 0.8 + r(), (r() - 0.5) * 1.2, 0.8, 0.1, 0.05, 0x6fb04a, 2, 0.8, 1); break;
        case 'hammer': dust(e.x, h + 0.25, e.y, 3, 0xc2b08a, 0.3, 0.5); P.spawn(e.x, h + 0.6, e.y, (r() - 0.5) * 2, 2, (r() - 0.5) * 2, 0.5, 0.08, 0.04, 0xb88a50, 7, 0.4, 1); break;
        case 'hit': { const x = e.x2 ?? e.x, z = e.y2 ?? e.y, hh = this.heightAt(x, z); for (let i = 0; i < 4; i++) S.spawn(x, hh + 0.8, z, (r() - 0.5) * 4, 0.8 + r() * 2, (r() - 0.5) * 4, 0.28, 0.1, 0.01, i % 2 ? 0xffe2a0 : 0xff9a5a, 6, 0.3, 1); dust(x, hh + 0.4, z, 2, 0xb0a590, 0.3, 0.4); break; }
        case 'shoot': { const x2 = e.x2 ?? e.x, z2 = e.y2 ?? e.y; this.arrows.fire(e.x, h + 1.0, e.y, x2, this.heightAt(x2, z2) + 0.8, z2, () => { for (let i = 0; i < 3; i++) S.spawn(x2, this.heightAt(x2, z2) + 0.8, z2, (r() - 0.5) * 3, 1 + r() * 1.5, (r() - 0.5) * 3, 0.25, 0.08, 0.01, 0xffe2a0, 6, 0.3, 1); }); break; }
        case 'death': dust(e.x, h + 0.2, e.y, e.kind === 'mammoth' ? 22 : 7, e.kind === 'wolf' ? 0x777a84 : e.kind === 'mammoth' ? 0x8a7050 : 0x9a8a6a, e.kind === 'mammoth' ? 1.1 : 0.55, 0.6); break;
        case 'deliver': this.floaters.push({ x: e.x, y: e.y, text: `+${e.n}`, color: RES_COL[e.res ?? 'food'] ?? '#fff', age: 0, life: 1.4 }); break;
        case 'spawn': this.rings.burst(e.x, h, e.y, 1.1, 0x7fe0ea, 0.7); for (let i = 0; i < 8; i++) S.spawn(e.x, h + 0.2, e.y, (r() - 0.5) * 1.4, 1.2 + r() * 1.4, (r() - 0.5) * 1.4, 0.8, 0.12, 0.02, 0xbff4ff, -0.2, 1, 1); break;
        case 'built': {
          dust(e.x, h + 0.2, e.y, 12, 0xc2b08a, 0.75, 0.9); this.rings.burst(e.x, h, e.y, 2.8, 0xffe9a0, 1.1); for (let i = 0; i < 12; i++) S.spawn(e.x + (r() - 0.5) * 2, h + 0.4, e.y + (r() - 0.5) * 2, (r() - 0.5) * 0.8, 1.2 + r() * 1.6, (r() - 0.5) * 0.8, 1.1, 0.14, 0.02, 0xffe58a, -0.4, 0.8, 1);
          for (const en of this.bMap.values()) if (Math.hypot(en.cx - e.x, en.cz - e.y) < 0.3) en.pop = time;
          this.floaters.push({ x: e.x, y: e.y - 1, text: 'Complete', color: '#ffe9a0', age: 0, life: 1.8, big: true }); break;
        }
        case 'felled': { this.felTree(e.x, e.y, time); break; }
        case 'rally': this.rings.burst(e.x, h, e.y, 6.5, 0xffd54a, 1.1); for (let i = 0; i < 14; i++) S.spawn(e.x + (r() - 0.5) * 6, h + 0.3, e.y + (r() - 0.5) * 6, 0, 1 + r(), 0, 1, 0.14, 0.02, 0xffe27a, -0.3, 0.5, 1); break;
        case 'discover': case 'preserved': this.rings.burst(e.x, h, e.y, 3.2, e.k === 'discover' ? 0xffd27a : 0x9be07a, 1.4); for (let i = 0; i < 22; i++) S.spawn(e.x + (r() - 0.5) * 1.2, h + 0.3, e.y + (r() - 0.5) * 1.2, (r() - 0.5) * 0.6, 1.4 + r() * 2, (r() - 0.5) * 0.6, 1.6, 0.15, 0.02, e.k === 'discover' ? 0xffe27a : 0xb8ff9a, -0.3, 0.4, 1); this.floaters.push({ x: e.x, y: e.y - 1.2, text: e.k === 'discover' ? 'Discovery!' : 'Preserved', color: e.k === 'discover' ? '#ffd27a' : '#b8ff9a', age: 0, life: 2.4, big: true }); break;
        case 'upgrade': {
          dust(e.x, h + 0.2, e.y, 16, 0xd8c8a0, 0.9, 1.0); this.rings.burst(e.x, h, e.y, 4, 0xffd27a, 1.3); this.rings.burst(e.x, h, e.y, 2.4, 0xffffff, 0.9);
          for (let i = 0; i < 26; i++) S.spawn(e.x + (r() - 0.5) * 2.4, h + 0.3, e.y + (r() - 0.5) * 2.4, (r() - 0.5) * 0.5, 2 + r() * 3, (r() - 0.5) * 0.5, 1.5, 0.15, 0.02, 0xffe27a, -0.4, 0.4, 1);
          for (const en of this.bMap.values()) if (Math.hypot(en.cx - e.x, en.cz - e.y) < 0.3) en.pop = time;
          this.floaters.push({ x: e.x, y: e.y - 1.4, text: 'Upgraded!', color: '#ffd27a', age: 0, life: 2.2, big: true }); break;
        }
        case 'tech': this.rings.burst(e.x, h, e.y, 3, 0x7fd0ff, 1.2); for (let i = 0; i < 16; i++) S.spawn(e.x + (r() - 0.5) * 1.5, h + 0.5, e.y + (r() - 0.5) * 1.5, 0, 1.4 + r() * 1.6, 0, 1.3, 0.13, 0.02, 0xbfe8ff, -0.3, 0.4, 1); this.floaters.push({ x: e.x, y: e.y - 1.2, text: 'Learned', color: '#9fdcff', age: 0, life: 2, big: true }); break;
        case 'freeze': { for (let i = 0; i < 40; i++) { const px = 22 + r() * 28, pz = 15 + r() * 18; S.spawn(px, WATER_LEVEL + 0.2, pz, (r() - 0.5) * 0.6, 0.6 + r() * 1.4, (r() - 0.5) * 0.6, 1.8, 0.12, 0.02, e.n ? 0xdff4ff : 0xb8e0f4, -0.2, 0.3, 1); } this.floaters.push({ x: w.W / 2, y: w.H / 2, text: e.n ? 'The lake freezes' : 'The ice breaks', color: '#bfe8ff', age: 0, life: 3, big: true }); break; }
        case 'job': this.rings.burst(e.x, h, e.y, 1.4, 0x9fe0ff, 0.9); this.floaters.push({ x: e.x, y: e.y - 0.9, text: `→ ${e.res === 'food' ? 'Food' : e.res === 'wood' ? 'Wood' : 'Stone'}`, color: RES_COL[e.res ?? 'food'] ?? '#fff', age: 0, life: 1.8, big: true }); break;
        case 'heal': S.spawn(e.x + (r() - 0.5) * 0.4, h + 0.6, e.y + (r() - 0.5) * 0.4, 0, 0.9, 0, 0.9, 0.15, 0.02, 0x8cff9a, -0.1, 0.5, 1); break;
        case 'rank': this.rings.burst(e.x, h, e.y, 2, 0xffd54a, 1); for (let i = 0; i < 14; i++) S.spawn(e.x, h + 1.2, e.y, (r() - 0.5) * 2, 1 + r() * 2, (r() - 0.5) * 2, 1, 0.14, 0.02, 0xffd54a, -0.6, 0.5, 1); this.floaters.push({ x: e.x, y: e.y - 0.8, text: e.n === 2 ? 'Elite!' : 'Veteran!', color: '#ffd54a', age: 0, life: 1.8, big: true }); break;
        default: break;
      }
    }
  }

  private felTree(x: number, z: number, time: number) {
    const tx = Math.floor(x), tz = Math.floor(z), vs = TREE_MIX[MAPS[this.bakedFor?.map ?? 'valley']?.biome ?? 'autumn'] ?? TREE_MIX.autumn, v = vs[Math.floor(hash2(tx, tz, 4) * vs.length)] ?? 0;
    const src = this.treeMeshes[v]; if (!src) return;
    const m = new THREE.Mesh(src.geometry, MAT.tree); m.castShadow = true; m.position.set(x, this.heightAt(x, z), z); m.scale.setScalar(1.1); m.rotation.order = 'YXZ'; m.rotation.y = hash2(tx, tz, 99) * 6.28;
    this.scene.add(m); const a = Math.random() * 6.28; this.falling.push({ mesh: m, t: 0, dx: Math.cos(a), dz: Math.sin(a), landed: false }); void time;
  }

  // ------------------------------------------------------------------ frame
  draw(w: World, ov: Overlay, time: number) {
    if (this.bakedFor !== w || !this.terrain) this.setup(w);
    const cam = this.cam; cam.update();
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime)); this.lastTime = time;
    this.watchPerf(dt);
    shared.time.value = time;
    const snowFloor = MAPS[w.map]?.permaFrost ? 0.45 : 0;
    this.winterLevel += (Math.max(snowFloor, isWinter(w) ? 1 : 0) - this.winterLevel) * 0.02;
    const L = this.winterLevel;
    shared.snow.value = L;

    // ---- time of day: a 6-minute day. sunAlt: -1 midnight .. +1 noon
    const ph = (w.time / 360 + 0.3) % 1, sunAlt = Math.sin((ph - 0.25) * Math.PI * 2);
    const theta = (ph - 0.25) * Math.PI * 2;
    this.night = smooth(0.12, -0.3, sunAlt);
    const dusk = Math.exp(-(((sunAlt - 0.05) / 0.2) ** 2)) * (1 - this.night * 0.5);
    const N = this.night, C = this.cols;
    this.sun.color.copy(C.sunDay).lerp(C.sunDusk, dusk * 0.9).lerp(C.sunNight, N).lerp(C.sunW, L * 0.6 * (1 - N));
    this.sun.intensity = (2.3 - 0.5 * L) * (1 - N) + 1.15 * N;
    this.hemi.color.copy(C.skyDay).lerp(C.skyNight, N); this.hemi.intensity = (0.6 + 0.2 * L) * (1 - N) + 0.62 * N;
    (this.scene.fog as THREE.Fog).color.copy(C.bgDay).lerp(C.bgDusk, dusk * 0.8).lerp(C.bgW, L * 0.7).lerp(C.bgNight, N);
    this.scene.environmentIntensity = 0.45 * (1 - N * 0.45);
    const height = Math.max(7, Math.abs(Math.sin(theta)) * 34);
    this.sun.position.set(cam.x + Math.cos(theta) * 30, height, cam.y + 11); this.sun.target.position.set(cam.x, 0, cam.y);
    shared.cloud.value = (1 - N) * (0.95 - 0.5 * L);
    this.waterNormal.offset.x = time * 0.012; this.waterNormal.offset.y = time * 0.006;
    const pxScale = (cam.vh * this.dpr) / (2 * FOV_TAN);
    for (const m of [this.smokeMat, this.snowMat]) m.uniforms.uScale.value = pxScale;
    this.particles.setScale(pxScale); this.sparks.setScale(pxScale); this.ambient.setScale(pxScale);
    this.snowMat.uniforms.uFocus.value.set(cam.x, 0, cam.y); this.snowMat.uniforms.uTime.value = time; this.snowMat.uniforms.uLevel.value = L;
    this.snow.visible = L > 0.02;

    this.updateFog(w); this.updateWear(w, time); this.updateIce(L); this.updateFish(w, time);
    this.syncNodes(w);
    const emitters: THREE.Vector3[] = [];
    this.syncBuildings(w, ov, time, emitters);
    this.syncUnits(w, ov, time, dt);
    this.syncLandmarks(w, time);
    this.updateGhost(w, ov);
    this.updateLights(w, time);
    this.updateSmoke(emitters, time);

    // ---- effects
    this.particles.update(dt); this.sparks.update(dt); this.arrows.update(dt); this.rings.update(dt);
    this.ambient.update(time, cam.x, cam.y, (1 - L) * (1 - N * 0.6) * 0.9, N, L);
    this.updateFalling(dt);
    for (const f of this.floaters) f.age += dt; this.floaters = this.floaters.filter((f) => f.age < f.life);
    this.grass.update(cam.x, cam.y, w, this.heightAt, L);

    // ---- render
    if (this.quality !== 'low') {
      const sp = this.sun.position.clone().project(cam.three); const sunUv: [number, number] = [sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5];
      if (!this.post) this.post = new Post(this.three, this.scene, cam.three, cam.vw, cam.vh, this.dpr);
      const warm: [number, number, number] = [1 + 0.05 * (1 - N) + 0.1 * dusk - 0.1 * N, 1 + 0.01 * (1 - N) - 0.02 * N, 1 - 0.04 * (1 - N) - 0.08 * dusk + 0.14 * N];
      const t = L * 0.5; warm[0] -= t * 0.08; warm[2] += t * 0.1;
      this.post.setLook({ bloom: this.quality === 'high', tilt: this.quality === 'high' ? 0.85 : 0.6, tint: warm, vig: 0.5, sat: 1.1 - 0.12 * L, time, sun: sunUv, shaft: this.quality === 'high' && sp.z < 1 ? (0.3 + 1.1 * dusk) * (1 - N) * (1 - 0.7 * L) : 0, sunCol: [this.sun.color.r, this.sun.color.g, this.sun.color.b] });
      this.post.bloom.strength = 0.34 + 0.35 * N; this.post.render(dt);
    } else this.three.render(this.scene, cam.three);
    this.drawOverlay(w, ov, time);
  }

  private updateFalling(dt: number) {
    for (const f of [...this.falling]) {
      f.t += dt;
      const k = Math.min(1, f.t / 0.95), ang = k * k * 1.5;
      f.mesh.rotation.x = ang * f.dz; f.mesh.rotation.z = ang * f.dx;
      if (!f.landed && k >= 1) {
        f.landed = true;
        const p = f.mesh.position; for (let i = 0; i < 14; i++) this.particles.spawn(p.x + f.dx * 1.2 + (Math.random() - 0.5), p.y + 0.4, p.z + f.dz * 1.2 + (Math.random() - 0.5), (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 1.4, 0.16, 0.08, [0xe0a030, 0xd96a2c, 0x7ab04a][i % 3], 1.5, 0.5, 1);
        for (let i = 0; i < 6; i++) this.particles.spawn(p.x + f.dx, p.y + 0.1, p.z + f.dz, (Math.random() - 0.5), 0.4, (Math.random() - 0.5), 0.9, 0.5, 1.1, 0xa89a7a, -0.2, 1.5, 0.5);
      }
      if (f.t > 2.2) f.mesh.scale.multiplyScalar(0.92);
      if (f.t > 2.8) { this.scene.remove(f.mesh); this.falling.splice(this.falling.indexOf(f), 1); }
    }
  }

  private updateIce(L: number) {
    if (!this.ice) return;
    const m = this.ice.material as THREE.MeshStandardMaterial;
    m.opacity = Math.min(0.97, Math.max(0, (L - 0.05) * 1.3)); this.ice.visible = m.opacity > 0.01;
  }

  /** Each fishing spot shows a few fish circling just under the surface; they thin out as the spot is fished empty. */
  private updateFish(w: World, time: number) {
    if (!this.fishCount) return;
    let i = 0; const d = this.dummy;
    for (const n of w.nodes) {
      if (n.kind !== 'fish' || !isExplored(w, n.x, n.y)) continue;
      const n5 = Math.max(1, Math.round(5 * n.amount / n.max)), cx = n.x + 0.5, cz = n.y + 0.5, h = WATER_LEVEL - 0.05 + (this.ice?.visible ? 0 : 0);
      for (let k = 0; k < n5 && i < this.fish.instanceMatrix.count; k++) {
        const a = time * (0.7 + k * 0.13) + k * 1.9 + n.id, r = 0.28 + (k % 3) * 0.12;
        d.position.set(cx + Math.cos(a) * r, h + Math.sin(time * 3 + k) * 0.015, cz + Math.sin(a) * r); d.rotation.set(0, -a + Math.PI / 2, 0); d.scale.setScalar(0.8 + (k % 2) * 0.25); d.updateMatrix(); this.fish.setMatrixAt(i++, d.matrix);
      }
    }
    this.fish.count = i; this.fish.instanceMatrix.needsUpdate = true;
  }

  private updateWear(w: World, time: number) {
    if (!this.wearTex || time - this.wearAt < 0.4) return;
    this.wearAt = time;
    const d = this.wearData, S = 4;
    for (const u of w.units) {
      if (u.owner !== 0 || u.kind === 'deer' || u.kind === 'wolf') continue;
      if (Math.hypot(u.x - u.ox, u.y - u.oy) < 0.004) continue; // only moving feet wear the grass
      const cx = Math.floor(u.x * S), cy = Math.floor(u.y * S);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= this.wearW || y >= this.wearH) continue;
        const i = y * this.wearW + x, add = dx === 0 && dy === 0 ? 9 : 3;
        d[i] = Math.min(255, d[i] + add);
      }
    }
    this.wearTex.needsUpdate = true;
  }

  private updateFog(w: World) {
    if (!w._vis || !w._exp) return;
    if (w.tick - this.fogTick < 4 && w.tick >= this.fogTick) return;
    this.fogTick = w.tick;
    const W = w.W, H = w.H, S = 4, data = this.fogData;
    const field = new Float32Array(W * H);
    for (let i = 0; i < field.length; i++) field[i] = w._vis[i] === 2 ? 0 : w._exp[i] ? 0.5 : 1;
    const at = (x: number, y: number) => field[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
    for (let py = 0; py < H * S; py++) {
      const fy = (py + 0.5) / S - 0.5, y0 = Math.floor(fy), v = fy - y0;
      for (let px = 0; px < W * S; px++) {
        const fx = (px + 0.5) / S - 0.5, x0 = Math.floor(fx), u = fx - x0;
        const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        const val = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
        const t = val * val * (3 - 2 * val), o = (py * W * S + px) * 4;
        data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = Math.round(t * (val > 0.75 ? 255 : 150));
      }
    }
    this.fogTex.needsUpdate = true;
  }

  private syncNodes(w: World) {
    let sig = String(w.nodes.length), explored = 0;
    for (const n of w.nodes) { if (isExplored(w, n.x, n.y)) { explored++; if (n.kind === 'bush') sig += n.amount / n.max > 0.25 ? 'f' : 'e'; } }
    sig += `|${explored}`;
    if (sig === this.nodeSig) return;
    this.nodeSig = sig;
    const counts = new Map<THREE.InstancedMesh, number>();
    const put = (m: THREE.InstancedMesh, n: ResNode, scale: number) => {
      const i = counts.get(m) ?? 0; if (i >= m.instanceMatrix.count) return;
      const hh = hash2(n.x, n.y, 4), x = n.x + 0.5 + (hash2(n.x, n.y, 5) - 0.5) * 0.35, z = n.y + 0.5 + (hash2(n.x, n.y, 6) - 0.5) * 0.35;
      this.dummy.position.set(x, this.heightAt(x, z), z); this.dummy.rotation.set(0, hh * 6.283, 0); this.dummy.scale.setScalar(scale); this.dummy.updateMatrix();
      m.setMatrixAt(i, this.dummy.matrix);
      const k = 0.88 + hash2(n.x, n.y, 9) * 0.26; m.setColorAt(i, new THREE.Color(k, k, k));
      counts.set(m, i + 1);
    };
    let bi = 0;
    const blob = (x: number, z: number, rad: number, a: number) => {
      if (bi >= this.blobs.instanceMatrix.count) return;
      this.dummy.position.set(x, this.heightAt(x, z) + 0.04, z); this.dummy.rotation.set(0, 0, 0); this.dummy.scale.set(rad, 1, rad); this.dummy.updateMatrix();
      this.blobs.setMatrixAt(bi, this.dummy.matrix); this.blobs.setColorAt(bi, new THREE.Color(a, a, a)); bi++;
    };
    for (const n of w.nodes) {
      if (!isExplored(w, n.x, n.y)) continue;
      const hh = hash2(n.x, n.y, 4);
      if (n.kind !== 'carcass') blob(n.x + 0.5, n.y + 0.5, n.kind === 'tree' ? 1.7 : n.kind === 'bush' ? 1.1 : 1.3, n.kind === 'tree' ? 0.55 : 0.4);
      if (n.kind === 'tree') { const vs = TREE_MIX[MAPS[w.map]?.biome ?? 'autumn'] ?? TREE_MIX.autumn; put(this.treeMeshes[vs[Math.floor(hh * vs.length)] ?? 0], n, 0.95 + hash2(n.x, n.y, 8) * 0.4); }
      else if (n.kind === 'bush') put(n.amount / n.max > 0.25 ? this.bushFull : this.bushEmpty, n, 1.0 + hh * 0.2);
      else if (n.kind === 'rock') put(this.rockMeshes[Math.floor(hh * 3)], n, 1.1 + hh * 0.5);
      else put(this.carcass, n, 1.0);
    }
    this.blobs.count = bi; this.blobs.instanceMatrix.needsUpdate = true; if (this.blobs.instanceColor) this.blobs.instanceColor.needsUpdate = true;
    for (const m of [...this.treeMeshes, this.bushFull, this.bushEmpty, ...this.rockMeshes, this.carcass]) {
      m.count = counts.get(m) ?? 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private syncBuildings(w: World, ov: Overlay, time: number, emitters: THREE.Vector3[]) {
    const seen = new Set<number>();
    for (const b of w.buildings) {
      seen.add(b.id);
      let e = this.bMap.get(b.id);
      if (e && e.tier !== b.tier) { this.root.remove(e.model.group); this.bMap.delete(b.id); e = undefined; }
      if (!e) {
        const model = buildBuilding(b.kind, b.owner === 0 ? 0 : 1, b.w, b.h, b.tier);
        const sc = new THREE.Group();
        const poles = new THREE.Mesh(merge([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ g: new THREE.CylinderGeometry(0.04, 0.05, 1.5, 5), c: '#7a5230', p: [(sx * b.w) / 2, 0.75, (sz * b.h) / 2] as [number, number, number] }))), MAT.prop);
        sc.add(poles);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, 1.4, b.h)), new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.7 }));
        edge.position.y = 0.7; sc.add(edge);
        model.group.add(sc);
        const bl = new THREE.Mesh(blobGeo, blobMat.clone()); (bl.material as THREE.MeshBasicMaterial).vertexColors = false; (bl.material as THREE.MeshBasicMaterial).opacity = 0.6; bl.scale.set(Math.max(b.w, 1.5) * 1.15, 1, Math.max(b.h, 1.5) * 1.15); bl.position.y = 0.05; bl.renderOrder = 2; model.group.add(bl);
        const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
        model.group.position.set(cx, this.heightAt(cx, cz), cz);
        this.root.add(model.group);
        e = { model, scaffold: sc, tier: b.tier, done: b.done, phase: Math.random() * 6, pop: -9, cx, cz }; this.bMap.set(b.id, e);
        if (b.done && time > 1) e.pop = time - 0.2;
      }
      const g = e.model.group;
      const show = b.owner === 0 || isExplored(w, b.x + b.w / 2, b.y + b.h / 2);
      g.visible = show;
      if (!show) continue;
      e.scaffold.visible = !b.done;
      const pk = time - e.pop, pop = pk < 0.5 ? 1 + Math.sin(pk * 14) * 0.09 * (1 - pk / 0.5) : 1;
      g.scale.set(b.done ? pop : 1, b.done ? pop : 0.12 + 0.88 * b.progress, b.done ? pop : 1);
      e.scaffold.scale.y = b.done ? 1 : 1 / g.scale.y;
      if (!b.done || b.upg) {
        // a building site is alive: the structure shudders with each hammer blow and throws up dust and chips
        const k = 0.012 * Math.sin(time * 17 + e.phase);
        g.scale.x *= 1 + k; g.scale.z *= 1 - k * 0.8;
        if (time > (e.fx ?? 0)) {
          e.fx = time + 0.28 + Math.random() * 0.2;
          const P = this.particles, hh = g.position.y, hw = (b.w / 2) * (0.6 + Math.random() * 0.6), a = Math.random() * 6.283;
          P.spawn(g.position.x + Math.cos(a) * hw, hh + 0.15, g.position.z + Math.sin(a) * hw * (b.h / b.w), (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8, 1.1, 0.2, 0.55, 0xcdbb94, -0.2, 1.6, 0.5);
          if (Math.random() < 0.5) P.spawn(g.position.x + (Math.random() - 0.5) * b.w, hh + 0.6 + b.progress * 1.2, g.position.z + (Math.random() - 0.5) * b.h, (Math.random() - 0.5) * 1.6, 1.4, (Math.random() - 0.5) * 1.6, 0.8, 0.07, 0.04, 0xc99a5a, 6, 0.3, 1);
        }
      }
      const active = b.done && (b.kind !== 'rack' || (hasDisc(w, 'preservation') && w.res.food >= 6));
      e.model.flames.forEach((f, i) => { f.visible = active; const s = 0.85 + 0.25 * Math.sin(time * 11 + e!.phase + i * 2) + 0.08 * Math.sin(time * 23 + i); f.scale.set(1 + 0.08 * Math.sin(time * 9), s, 1 + 0.08 * Math.cos(time * 8)); });
      if (active) for (const p of e.model.emitters) emitters.push(p.clone().applyMatrix4(g.matrixWorld));
      if (b.done && b.hp < b.maxHp * 0.5) emitters.push(new THREE.Vector3(g.position.x, g.position.y + 1.4, g.position.z));
      const sel = ov.selBuilding === b.id;
      if (sel && !e.ring) {
        const r = Math.max(b.w, b.h) * 0.62;
        e.ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff6a0, transparent: true, opacity: 0.95, depthWrite: false }));
        e.ring.position.y = 0.1; e.ring.renderOrder = 5; g.add(e.ring);
      }
      if (e.ring) { e.ring.visible = sel; e.ring.scale.setScalar(1 + Math.sin(time * 4) * 0.025); }
    }
    for (const [id, e] of this.bMap) if (!seen.has(id)) { this.root.remove(e.model.group); this.bMap.delete(id); }
  }

  private syncUnits(w: World, ov: Overlay, time: number, dt: number) {
    const seen = new Set<number>(), selSet = new Set(ov.selUnits);
    for (const u of w.units) {
      seen.add(u.id);
      let r = this.rigs.get(u.id);
      if (!r) { r = createRig(u, w, time); this.root.add(r.root); this.rigs.set(u.id, r); }
      // Upgrade an existing fallback in place when its GLB finishes loading.
      if (u.kind === 'leader') {
        const asset = leaderGeometry(u.owner === 0 ? w.species : w.rivalSpecies, u.owner, u.gen);
        if (asset && r.asset !== asset) { r.mesh.geometry = asset; r.mesh.material = leaderMaterial; r.asset = asset; }
      }
      const show = u.owner === 0 || isVisible(w, u.x, u.y);
      r.root.visible = show;
      if (!show) continue;
      const x = u.ox + (u.x - u.ox) * ov.alpha, y = u.oy + (u.y - u.oy) * ov.alpha;
      r.root.position.set(x, this.heightAt(x, y), y);
      const moving = animateRig(r, u, { time, dt, w, alpha: ov.alpha, selected: selSet.has(u.id) });
      if (moving && u.owner !== 2 && Math.random() < dt * 5 && this.quality !== 'low') this.particles.spawn(x, this.heightAt(x, y) + 0.05, y, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4, 0.55, 0.12, 0.32, 0xa89a78, -0.1, 1.2, 0.28);
      r.sel.visible = selSet.has(u.id); r.sel.scale.setScalar(1.15 + Math.sin(time * 5) * 0.04); r.buff.visible = u.buff > 0;
    }
    for (const [id, r] of this.rigs) if (!seen.has(id)) { this.rigs.delete(id); this.dying.push({ rig: r, t: 0 }); r.sel.visible = false; r.buff.visible = false; }
    for (const d of [...this.dying]) {
      d.t += dt; const r = d.rig, k = Math.min(1, d.t / 0.55), e = k * k * (3 - 2 * k);
      if (r.kind === 'person') { r.root.rotation.x = -1.5 * e; r.b.shL.rotation.x = -1.2 * e; r.b.shR.rotation.x = -1.6 * e; r.b.hipL.rotation.x = 0.4 * e; } else r.root.rotation.z = 1.5 * e;
      if (d.t > 1.0) r.root.position.y -= dt * 0.35;
      if (d.t > 1.9) { this.root.remove(r.root); this.dying.splice(this.dying.indexOf(d), 1); }
    }
  }

  private syncLandmarks(w: World, time: number) {
    for (const l of w.landmarks) {
      const g = this.landmarks.get(l.id); if (!g) continue;
      g.visible = isExplored(w, l.x, l.y);
      if (l.id === 'cave' && g.children[1]) g.children[1].scale.set(1, 0.85 + 0.25 * Math.sin(time * 10), 1);
    }
  }

  private updateGhost(w: World, ov: Overlay) {
    const pl = ov.place;
    if (!pl) { if (this.ghost) this.ghost.group.visible = false; return; }
    if (!this.ghost || this.ghost.kind !== pl.kind) {
      if (this.ghost) this.root.remove(this.ghost.group);
      const d = BUILDINGS[pl.kind], m = buildBuilding(pl.kind, 0, d.w, d.h), grp = m.group;
      const gm = new THREE.MeshStandardMaterial({ color: 0x8dff9f, transparent: true, opacity: 0.5, roughness: 0.6, depthWrite: false });
      grp.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) { if (me.material === MAT.flame || me.material === MAT.flameCore) me.visible = false; else { me.material = gm; me.castShadow = false; } } });
      const foot = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8dff9f, transparent: true, opacity: 0.35, depthWrite: false }));
      foot.position.y = 0.08; foot.renderOrder = 4; grp.add(foot);
      this.root.add(grp); this.ghost = { kind: pl.kind, group: grp, foot };
    }
    const d = BUILDINGS[pl.kind], cx = pl.tx + d.w / 2, cz = pl.ty + d.h / 2;
    const ok = placeCheck(w, pl.kind, pl.tx, pl.ty).ok;
    this.ghost.group.visible = true; this.ghost.group.position.set(cx, this.heightAt(cx, cz), cz);
    const col = ok ? 0x8dff9f : 0xff6a5c;
    this.ghost.group.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) (me.material as THREE.MeshBasicMaterial).color.setHex(col); });
  }

  private updateLights(w: World, time: number) {
    const c: { p: THREE.Vector3; d: number }[] = [];
    for (const b of w.buildings) {
      if (!b.done) continue;
      const e = this.bMap.get(b.id); if (!e?.model.lightAt || !e.model.group.visible) continue;
      const p = e.model.lightAt.clone().applyMatrix4(e.model.group.matrixWorld);
      c.push({ p, d: Math.hypot(p.x - this.cam.x, p.z - this.cam.y) });
    }
    c.sort((a, b) => a.d - b.d);
    const boost = 1 + this.night * 1.8 + this.winterLevel * 0.4;
    this.lights.forEach((l, i) => {
      const s = c[i];
      if (!s || s.d > 40 || (this.quality === 'low' && i > 0)) { l.intensity = 0; return; }
      l.position.copy(s.p); l.intensity = 8 * boost * (0.9 + 0.1 * Math.sin(time * 9 + i * 3) + 0.05 * Math.sin(time * 21));
    });
  }

  private updateSmoke(emitters: THREE.Vector3[], time: number) {
    const pos = this.smoke.geometry.attributes.position as THREE.BufferAttribute, aT = this.smoke.geometry.attributes.aT as THREE.BufferAttribute;
    const N = pos.count; let k = 0;
    for (let e = 0; e < emitters.length && k < N; e++) {
      const em = emitters[e];
      for (let i = 0; i < 8 && k < N; i++, k++) {
        const t = (time * 0.32 + i / 8 + e * 0.37) % 1;
        pos.setXYZ(k, em.x + Math.sin(time * 0.7 + i * 2 + e) * 0.15 * t + t * 0.7, em.y + t * 2.6, em.z + Math.cos(time * 0.6 + i * 3) * 0.12 * t);
        aT.setX(k, t);
      }
    }
    for (; k < N; k++) aT.setX(k, 1);
    pos.needsUpdate = true; aT.needsUpdate = true;
  }

  // ------------------------------------------------------------------ 2D overlay (bars, order lines, labels, floating numbers)
  private ring(wx: number, wy: number, r: number, n = 40) {
    const { ctx, cam } = this;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, p = cam.toScreen(wx + Math.cos(a) * r, wy + Math.sin(a) * r, this.heightAt(wx, wy)); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
  }
  /** A progress ring laid on the ground around a building site. */
  private ringArc(cx: number, cy: number, rad: number, frac: number, col: string, time: number) {
    const { ctx } = this, cam = this.cam, N = 64;
    const pt = (i: number) => { const a = -Math.PI / 2 + (i / N) * Math.PI * 2; return cam.toScreen(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, this.heightAt(cx, cy) + 0.06); };
    ctx.save(); ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 6; ctx.beginPath(); for (let i = 0; i <= N; i++) { const p = pt(i); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); } ctx.stroke();
    const n = Math.max(1, Math.round(N * Math.max(0.02, Math.min(1, frac))));
    ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.shadowColor = col; ctx.shadowBlur = 10 + 4 * Math.sin(time * 6);
    ctx.beginPath(); for (let i = 0; i <= n; i++) { const p = pt(i); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); } ctx.stroke();
    const tip = pt(n); ctx.fillStyle = '#fff'; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(tip.x, tip.y, 3.5, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  private bar(x: number, y: number, w: number, h: number, f: number, col: string) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(8,10,8,.75)'; ctx.beginPath(); ctx.roundRect(x - 1, y - 1, w + 2, h + 2, 3); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, Math.min(1, f)) * w, h, 2); ctx.fill();
  }

  private drawOverlay(w: World, ov: Overlay, time: number) {
    const { ctx, cam } = this, z = cam.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 9]);
    for (const b of w.buildings) if (b.owner === 0 && b.done && (b.kind === 'hearth' || b.kind === 'watch')) { this.ring(b.x + b.w / 2, b.y + b.h / 2, SUPPLY_RANGE, 96); ctx.stroke(); }
    ctx.restore();
    for (const l of w.landmarks) {
      if (!isExplored(w, l.x, l.y) || z < 16) continue;
      const p = cam.toScreen(l.x + 0.5, l.y + 0.5, l.id === 'cave' ? 2.4 : 2.8);
      ctx.font = `700 ${Math.max(10, z * 0.38)}px Cinzel, Georgia, serif`; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(l.name, p.x + 1, p.y + 1); ctx.fillStyle = '#fff4cc'; ctx.fillText(l.name, p.x, p.y);
    }
    for (const b of w.buildings) {
      const e = this.bMap.get(b.id); if (!e || !e.model.group.visible) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, p = cam.toScreen(cx, cy, b.kind === 'watch' ? 4.2 : 2.0), bw = Math.max(34, b.w * z * 0.8);
      const prog = !b.done ? b.progress : b.upg ? 1 - b.upg.t / b.upg.total : b.research ? 1 - b.research.t / b.research.total : -1;
      if (prog >= 0) this.ringArc(cx, cy, Math.max(b.w, b.h) / 2 + 0.9, prog, !b.done ? '#ffd54a' : b.upg ? '#ffb347' : '#7fd0ff', time);
      if (!b.done) this.bar(p.x - bw / 2, p.y, bw, 6, b.progress, '#ffd54a');
      else if (b.queue.length) this.bar(p.x - bw / 2, p.y, bw, 6, 1 - b.queue[0].t / UNITS[b.queue[0].kind].time, '#7ec8ff');
      else if (b.hp < b.maxHp || ov.allBars) this.bar(p.x - bw / 2, p.y, bw, 5, b.hp / b.maxHp, b.hp / b.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
      if (b.outpost) { ctx.fillStyle = '#ffe36e'; ctx.font = `800 ${Math.max(10, z * 0.36)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('OUTPOST', p.x, p.y - 10); }
      if (ov.selBuilding === b.id && b.rally) {
        // rally flag with a dotted trail from the door
        const from = cam.toScreen(cx, cy, 0.4), to = cam.toScreen(b.rally.x, b.rally.y, this.heightAt(b.rally.x, b.rally.y));
        ctx.save(); ctx.strokeStyle = 'rgba(255,215,110,.85)'; ctx.lineWidth = 2; ctx.setLineDash([5, 6]); ctx.lineDashOffset = -time * 18;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
        const fh = Math.max(22, z * 0.9), wave = Math.sin(time * 5) * 3;
        ctx.strokeStyle = '#3a2614'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(to.x, to.y); ctx.lineTo(to.x, to.y - fh); ctx.stroke();
        ctx.fillStyle = '#ffd54a'; ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.moveTo(to.x, to.y - fh); ctx.quadraticCurveTo(to.x + fh * 0.35, to.y - fh + 2 + wave, to.x + fh * 0.62, to.y - fh * 0.78); ctx.lineTo(to.x, to.y - fh * 0.56); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,215,110,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(to.x, to.y, 9, 4.5, 0, 0, 6.283); ctx.stroke(); ctx.restore();
      }
      if (ov.selBuilding === b.id) { const wm = BUILDINGS[b.kind].warmth; if (wm) { ctx.strokeStyle = 'rgba(255,170,80,.6)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); this.ring(cx, cy, wm + Math.max(b.w, b.h) / 2); ctx.stroke(); ctx.setLineDash([]); } }
    }
    const sel = new Set(ov.selUnits);
    for (const u of w.units) {
      const r = this.rigs.get(u.id); if (!r || !r.root.visible) continue;
      const x = u.ox + (u.x - u.ox) * ov.alpha, y = u.oy + (u.y - u.oy) * ov.alpha;
      const s = sel.has(u.id);
      if (u.owner === 0 && u.order.t === 'research') { const p = cam.toScreen(x, y, 2.0); ctx.fillStyle = '#ffe36e'; ctx.font = '800 16px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', p.x, p.y); }
      if (u.owner === 0 && u.kills >= RANK_KILLS[0]) {
        const rk = u.kills >= RANK_KILLS[1] ? 2 : 1, pr = cam.toScreen(x, y, this.heightAt(x, y) + 1.95);
        ctx.strokeStyle = rk === 2 ? '#ffd54a' : '#e8e0c8'; ctx.lineWidth = 2;
        for (let i = 0; i < rk; i++) { const yy = pr.y - i * 4; ctx.beginPath(); ctx.moveTo(pr.x - 4, yy); ctx.lineTo(pr.x, yy - 3); ctx.lineTo(pr.x + 4, yy); ctx.stroke(); }
      }
      if (!s && u.hp >= u.maxHp && !ov.allBars) continue;
      if (ov.allBars && u.owner !== 0 && !isVisible(w, u.x, u.y)) continue;
      const p = cam.toScreen(x, y, this.heightAt(x, y) + 1.75), bw = Math.max(24, z * 0.75);
      this.bar(p.x - bw / 2, p.y, bw, 4, u.hp / u.maxHp, u.hp / u.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
    }
    ctx.save(); ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
    for (const id of ov.selUnits) {
      const u = w._u?.get(id); if (!u) continue;
      let tx: number | null = null, ty: number | null = null, c = 'rgba(255,255,255,.65)';
      const o = u.order;
      if (o.t === 'patrol') {
        const p1 = cam.toScreen(o.x, o.y, this.heightAt(o.x, o.y) + 0.1), p2 = cam.toScreen(o.x2, o.y2, this.heightAt(o.x2, o.y2) + 0.1);
        ctx.strokeStyle = 'rgba(255,200,90,.85)'; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        for (const p of [p1, p2]) { ctx.beginPath(); ctx.ellipse(p.x, p.y, 7, 4, 0, 0, Math.PI * 2); ctx.stroke(); }
      }
      // shift-queued waypoints: a numbered chain after the current target
      if (u.q?.length) {
        const pt = (q: (typeof u.q)[number]) => q.t === 'move' || q.t === 'amove' || q.t === 'patrol' ? { x: q.x, y: q.y } : q.t === 'gather' ? (w._n?.get(q.node) ? { x: w._n.get(q.node)!.x + 0.5, y: w._n.get(q.node)!.y + 0.5 } : null) : q.t === 'attack' ? ((): { x: number; y: number } | null => { const t = w._u?.get(q.target) ?? w._b?.get(q.target); return t ? ('progress' in t ? { x: t.x + t.w / 2, y: t.y + t.h / 2 } : { x: t.x, y: t.y }) : null; })() : q.t === 'build' ? (w._b?.get(q.b) ? { x: w._b.get(q.b)!.x + 1, y: w._b.get(q.b)!.y + 1 } : null) : null;
        let prev = o.t === 'move' || o.t === 'amove' || o.t === 'patrol' ? { x: o.x, y: o.y } : { x: u.x, y: u.y };
        u.q.forEach((q, n) => {
          const p = pt(q); if (!p) return;
          const a = cam.toScreen(prev.x, prev.y, this.heightAt(prev.x, prev.y) + 0.1), b = cam.toScreen(p.x, p.y, this.heightAt(p.x, p.y) + 0.1);
          ctx.strokeStyle = q.t === 'amove' || q.t === 'attack' ? 'rgba(255,120,100,.6)' : q.t === 'gather' ? 'rgba(160,255,160,.6)' : 'rgba(255,255,255,.5)';
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.save(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(10,8,6,.8)'; ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, 6.283); ctx.fill(); ctx.fillStyle = '#ffe9a0'; ctx.font = '700 10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(n + 1), b.x, b.y + 3.5); ctx.restore();
          prev = p;
        });
      }
      if (o.t === 'move' || o.t === 'amove' || o.t === 'flee') { tx = o.x; ty = o.y; if (o.t === 'amove') c = 'rgba(255,120,100,.85)'; }
      else if (o.t === 'attack') { const t = w._u?.get(o.target) ?? w._b?.get(o.target); if (t) { tx = 'progress' in t ? t.x + t.w / 2 : t.x; ty = 'progress' in t ? t.y + t.h / 2 : t.y; c = 'rgba(255,120,100,.85)'; } }
      else if (o.t === 'gather') { const n = w._n?.get(o.node); if (n) { tx = n.x + 0.5; ty = n.y + 0.5; c = 'rgba(160,255,160,.8)'; } }
      else if (o.t === 'build') { const b = w._b?.get(o.b); if (b) { tx = b.x + b.w / 2; ty = b.y + b.h / 2; c = 'rgba(255,220,120,.85)'; } }
      if (tx === null || ty === null) continue;
      const a = cam.toScreen(u.x, u.y, this.heightAt(u.x, u.y) + 0.1), b = cam.toScreen(tx, ty, this.heightAt(tx, ty) + 0.1);
      ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(b.x, b.y, 7, 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    for (const p of ov.pings) { ctx.strokeStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - p.age / 0.7); ctx.lineWidth = 3; this.ring(p.x, p.y, 0.25 + p.age * 1.4); ctx.stroke(); ctx.globalAlpha = 1; }
    // floating numbers / banners
    for (const f of this.floaters) {
      const k = f.age / f.life, p = cam.toScreen(f.x, f.y, this.heightAt(f.x, f.y) + 1.6 + k * (f.big ? 1.2 : 1.6));
      ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45); ctx.textAlign = 'center';
      ctx.font = `700 ${f.big ? 22 : 15}px Cinzel, Georgia, serif`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(10,8,5,.85)'; ctx.strokeText(f.text, p.x, p.y); ctx.fillStyle = f.color; ctx.fillText(f.text, p.x, p.y); ctx.globalAlpha = 1;
    }
    if (ov.place) {
      const d = BUILDINGS[ov.place.kind], chk = placeCheck(w, ov.place.kind, ov.place.tx, ov.place.ty);
      if (!chk.ok) {
        const p = cam.toScreen(ov.place.tx + d.w / 2, ov.place.ty + d.h / 2, 3);
        ctx.font = `600 ${Math.max(11, z * 0.36)}px system-ui`; ctx.textAlign = 'center'; const tw = ctx.measureText(chk.reason).width + 14;
        ctx.fillStyle = 'rgba(20,10,10,.9)'; ctx.beginPath(); ctx.roundRect(p.x - tw / 2, p.y - 22, tw, 22, 6); ctx.fill();
        ctx.fillStyle = '#ffb3a8'; ctx.fillText(chk.reason, p.x, p.y - 7);
      }
      if (d.warmth) { ctx.strokeStyle = 'rgba(255,170,80,.5)'; ctx.setLineDash([4, 6]); this.ring(ov.place.tx + d.w / 2, ov.place.ty + d.h / 2, d.warmth); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (ov.box) {
      ctx.strokeStyle = '#9fe870'; ctx.fillStyle = 'rgba(159,232,112,.15)'; ctx.lineWidth = 1.5;
      const bx = Math.min(ov.box.x0, ov.box.x1), by = Math.min(ov.box.y0, ov.box.y1);
      ctx.fillRect(bx, by, Math.abs(ov.box.x1 - ov.box.x0), Math.abs(ov.box.y1 - ov.box.y0)); ctx.strokeRect(bx, by, Math.abs(ov.box.x1 - ov.box.x0), Math.abs(ov.box.y1 - ov.box.y0));
    }
    void time;
  }

  /** Nearest hearth/circle fire strength (0..1) for the audio engine. */
  fireNear(w: World): number {
    let best = 99;
    for (const b of w.buildings) if (b.owner === 0 && b.done && (b.kind === 'hearth' || b.kind === 'circle')) best = Math.min(best, Math.hypot(b.x + b.w / 2 - this.cam.x, b.y + b.h / 2 - this.cam.y));
    return clamp(1 - best / 16);
  }

  // ------------------------------------------------------------------ minimap
  drawMinimap(w: World, c: HTMLCanvasElement) {
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const sx = c.width / w.W, sy = c.height / w.H;
    if (this.terrainCanvas) g.drawImage(this.terrainCanvas, 0, 0, c.width, c.height);
    for (const n of w.nodes) {
      if (!isExplored(w, n.x, n.y) || n.kind === 'carcass') continue;
      g.fillStyle = n.kind === 'tree' ? '#1f5a22' : n.kind === 'rock' ? '#ddd' : '#c44';
      g.fillRect(n.x * sx, n.y * sy, Math.max(1, sx), Math.max(1, sy));
    }
    for (const b of w.buildings) {
      if (b.owner !== 0 && !isExplored(w, b.x, b.y)) continue;
      g.fillStyle = b.owner === 0 ? '#5fe0d0' : '#ff6a55'; g.fillRect(b.x * sx - 1, b.y * sy - 1, b.w * sx + 2, b.h * sy + 2);
    }
    for (const u of w.units) {
      if (u.owner !== 0 && !isVisible(w, u.x, u.y)) continue;
      g.fillStyle = u.owner === 0 ? '#bff' : u.owner === 1 ? '#f66' : '#cb8'; g.fillRect(u.x * sx - 1, u.y * sy - 1, 3, 3);
    }
    if (w._vis && w._exp) {
      const img = g.getImageData(0, 0, c.width, c.height);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = Math.floor(y / sy) * w.W + Math.floor(x / sx), v = w._vis[i], e = w._exp[i];
        if (v === 2) continue;
        const k = e ? 0.55 : 1, o = (y * c.width + x) * 4;
        img.data[o] *= 1 - k; img.data[o + 1] *= 1 - k; img.data[o + 2] *= 1 - k;
      }
      g.putImageData(img, 0, 0);
    }
    if (w.alert && w.time - w.alert.t < 15) {
      const k = (performance.now() / 600) % 1;
      g.strokeStyle = `rgba(255,70,50,${1 - k})`; g.lineWidth = 2; g.beginPath(); g.arc(w.alert.x * sx, w.alert.y * sy, 3 + k * 12, 0, 6.283); g.stroke();
      g.fillStyle = '#ff4a3a'; g.beginPath(); g.arc(w.alert.x * sx, w.alert.y * sy, 2.5, 0, 6.283); g.fill();
    }
    const corners = [[0, 0], [this.cam.vw, 0], [this.cam.vw, this.cam.vh], [0, this.cam.vh]].map(([x, y]) => this.cam.toWorld(x, y));
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
    corners.forEach((p, i) => { const px = Math.max(0, Math.min(c.width, p.x * sx)), py = Math.max(0, Math.min(c.height, p.y * sy)); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath(); g.stroke();
  }
}

export type { Building };
