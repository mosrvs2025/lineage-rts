import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { placeCheck } from '../sim/commands';
import { SUPPLY_RANGE, hasDisc, isExplored, isVisible } from '../sim/rules';
import type { Building, BuildingKind, ResNode, Unit, World } from '../sim/types';
import { isWinter } from '../sim/util';
import { HEIGHT_RES, WATER_LEVEL, bakeTerrain, buildHeightGrid, hash2 } from './art';
import type { Camera } from './camera';
import type { AnimalGeo, BuildingModel, PersonGeo } from './models';
import {
  MAT, TREE_VARIANTS, animalGeo, buildBuilding, enhance, makeBushGeo, makeCarcassGeo, makeRockGeos, makeTreeGeos, merge, personGeo, shared,
} from './models';

export interface Overlay {
  selUnits: number[];
  selBuilding: number | null;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  place: { kind: BuildingKind; tx: number; ty: number } | null;
  alpha: number;
  pings: { x: number; y: number; age: number; c: string }[];
}

interface Rig {
  root: THREE.Group; kind: 'person' | 'deer' | 'wolf';
  body: THREE.Mesh; legA?: THREE.Mesh; legB?: THREE.Mesh; armR?: THREE.Mesh; armL?: THREE.Mesh;
  pack?: THREE.Mesh; axe?: THREE.Mesh; pick?: THREE.Mesh; hammer?: THREE.Mesh; torch?: THREE.Object3D;
  sel: THREE.Mesh; buff: THREE.Mesh;
  ang: number; phase: number; gen: number;
}
interface BEntry { model: BuildingModel; scaffold: THREE.Object3D; ring?: THREE.Mesh; done: boolean; phase: number }

const FOV_TAN = Math.tan((30 * Math.PI) / 360);

export class Renderer {
  three!: THREE.WebGLRenderer;
  ctx: CanvasRenderingContext2D;
  terrain: object | null = null;       // set to null to force a rebuild for a new world
  terrainCanvas: HTMLCanvasElement | null = null;
  dpr = 1;
  winterLevel = 0;
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
  private treeMeshes: THREE.InstancedMesh[] = [];
  private bushFull!: THREE.InstancedMesh; private bushEmpty!: THREE.InstancedMesh;
  private rockMeshes: THREE.InstancedMesh[] = [];
  private carcass!: THREE.InstancedMesh;
  private nodeSig = '';
  private bMap = new Map<number, BEntry>();
  private rigs = new Map<number, Rig>();
  private smoke!: THREE.Points; private smokeMat!: THREE.ShaderMaterial;
  private snow!: THREE.Points; private snowMat!: THREE.ShaderMaterial;
  private landmarks = new Map<string, THREE.Group>();
  private ghost: { kind: BuildingKind; group: THREE.Group; foot: THREE.Mesh } | null = null;
  private lastTime = 0;
  private ringGeo = new THREE.RingGeometry(0.4, 0.5, 28).rotateX(-Math.PI / 2);
  private dummy = new THREE.Object3D();
  private cols: Record<string, THREE.Color> = {};

  constructor(public canvas: HTMLCanvasElement, public cam: Camera) {
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.NeutralToneMapping;
    this.three.shadowMap.enabled = true;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color(0x10151c);
    this.scene.fog = new THREE.Fog(0x9db0c4, 70, 170);
    this.scene.add(this.root, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 100;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa050, 0, 11, 1.8); this.scene.add(l); this.lights.push(l); }
    this.overlay = document.createElement('canvas'); this.overlay.id = 'overlay';
    canvas.parentElement!.insertBefore(this.overlay, canvas.nextSibling);
    this.ctx = this.overlay.getContext('2d')!;
    this.cols = { sun: new THREE.Color(0xfff0d6), sunW: new THREE.Color(0xcfe0ff), hemi: new THREE.Color(0xbcd4ff), hemiW: new THREE.Color(0xdbe8ff), bg: new THREE.Color(0x9db0c4), bgW: new THREE.Color(0xc9d6e4) };
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const r = this.canvas.getBoundingClientRect();
    this.three.setPixelRatio(this.dpr);
    this.three.setSize(r.width, r.height, false);
    this.overlay.width = Math.round(r.width * this.dpr); this.overlay.height = Math.round(r.height * this.dpr);
    this.cam.setSize(r.width, r.height);
    const small = r.width < 760 || r.height < 520;
    const size = small ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
  }

  clear() { this.three.setClearColor(0x0d100c); this.three.clear(); }

  // ------------------------------------------------------------------ terrain queries
  heightAt = (x: number, y: number): number => {
    if (!this.gw) return 0;
    const R = HEIGHT_RES, GW = this.gw, GH = this.heights.length / GW, hs = this.heights;
    const fx = Math.max(0, Math.min(GW - 1.001, x * R)), fy = Math.max(0, Math.min(GH - 1.001, y * R));
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, h = hs;
    const a = h[iy * GW + ix], b = h[iy * GW + ix + 1], c = h[(iy + 1) * GW + ix], d = h[(iy + 1) * GW + ix + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  // ------------------------------------------------------------------ one-time scene build for a world
  private setup(w: World) {
    for (const o of [...this.root.children]) { this.root.remove(o); }
    this.bMap.clear(); this.rigs.clear(); this.landmarks.clear(); this.ghost = null; this.nodeSig = '';
    const W = w.W, H = w.H, R = HEIGHT_RES;
    this.heights = buildHeightGrid(w); this.gw = W * R + 1;
    this.cam.heightAt = this.heightAt;
    this.cam.worldW = W; this.cam.worldH = H;
    this.terrainCanvas = bakeTerrain(w);
    this.terrain = {};
    this.bakedFor = w;

    // ground mesh displaced by the height grid
    const geo = new THREE.PlaneGeometry(W, H, W * R, H * R).rotateX(-Math.PI / 2).translate(W / 2, 0, H / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heights[i]);
    geo.computeVertexNormals();
    const tex = new THREE.CanvasTexture(this.terrainCanvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, this.three.capabilities.getMaxAnisotropy()); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const ground = new THREE.Mesh(geo, enhance(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }), { snow: 1 }));
    ground.receiveShadow = true; this.root.add(ground);

    // water surface (only quads near water; the carved bed decides the visible shoreline)
    const wp: number[] = [], wuv: number[] = [];
    const isW = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (w.terrain[y][x] === '~' || w.terrain[y][x] === '=');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isW(x + dx, y + dy)) { near = true; break; }
      if (!near) continue;
      const q = [[x, y], [x, y + 1], [x + 1, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
      for (const [qx, qy] of q) { wp.push(qx, WATER_LEVEL, qy); wuv.push(qx / 5, qy / 5); }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2)); wg.computeVertexNormals();
    this.waterNormal = this.makeWaterNormal();
    const wm = new THREE.Mesh(wg, enhance(new THREE.MeshStandardMaterial({ color: 0x2f7fae, transparent: true, opacity: 0.72, roughness: 0.08, metalness: 0.1, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.55, 0.55), depthWrite: false }), {}));
    wm.renderOrder = 1; this.root.add(wm);

    // fog-of-war texture (4 texels per tile, alpha = darkness)
    this.fogData = new Uint8Array(W * 4 * H * 4 * 4);
    this.fogTex = new THREE.DataTexture(this.fogData, W * 4, H * 4, THREE.RGBAFormat);
    this.fogTex.magFilter = THREE.LinearFilter; this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
    shared.fogMap.value = this.fogTex; shared.mapSize.value.set(W, H);
    this.fogTick = -99;

    // instanced nature
    const caps = { tree: 0, bush: 0, rock: 0 };
    for (const n of w.nodes) if (n.kind === 'tree') caps.tree++; else if (n.kind === 'bush') caps.bush++; else if (n.kind === 'rock') caps.rock++;
    this.treeMeshes = makeTreeGeos().map((g) => this.inst(g, MAT.tree, caps.tree + 4));
    this.bushFull = this.inst(makeBushGeo(true), MAT.prop, caps.bush + 2); this.bushEmpty = this.inst(makeBushGeo(false), MAT.prop, caps.bush + 2);
    this.rockMeshes = makeRockGeos().map((g) => this.inst(g, MAT.prop, caps.rock + 4));
    this.carcass = this.inst(makeCarcassGeo(), MAT.prop, 60);
    for (const m of [...this.treeMeshes, this.bushFull, this.bushEmpty, ...this.rockMeshes, this.carcass]) { m.castShadow = true; m.receiveShadow = true; this.root.add(m); }

    // particles
    const N = 24 * 8, sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); sg.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(N).fill(1), 1));
    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 600 } },
      vertexShader: 'attribute float aT; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = (0.4+aT*1.3)*uScale/-mv.z; vA = (1.0-aT)*smoothstep(0.0,0.1,aT)*0.55; }',
      fragmentShader: 'varying float vA; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(0.82,0.83,0.86,smoothstep(0.5,0.05,d)*vA); }',
    });
    this.smoke = new THREE.Points(sg, this.smokeMat); this.smoke.frustumCulled = false; this.smoke.renderOrder = 3; this.root.add(this.smoke);
    const SN = 1600, snp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) { snp[i * 3] = Math.random() * 60; snp[i * 3 + 1] = Math.random() * 30; snp[i * 3 + 2] = Math.random() * 60; }
    const sng = new THREE.BufferGeometry(); sng.setAttribute('position', new THREE.BufferAttribute(snp, 3));
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uFocus: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLevel: { value: 0 }, uScale: { value: 600 } },
      vertexShader: 'uniform vec3 uFocus; uniform float uTime; uniform float uScale; varying float vD; void main(){ vec3 p=position; float fall=mod(p.y-uTime*(1.2+fract(p.x*7.13)*0.9),30.0); vec2 xz=mod(p.xz-uFocus.xz+30.0,60.0)-30.0+uFocus.xz; xz.x+=sin(uTime*0.8+p.z)*0.4; vec4 mv=viewMatrix*vec4(xz.x,fall-1.0,xz.y,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=0.07*uScale/-mv.z; vD=-mv.z; }',
      fragmentShader: 'uniform float uLevel; varying float vD; void main(){ float d=length(gl_PointCoord-0.5); gl_FragColor=vec4(1.0,1.0,1.0,smoothstep(0.5,0.1,d)*uLevel*0.85); }',
    });
    this.snow = new THREE.Points(sng, this.snowMat); this.snow.frustumCulled = false; this.snow.renderOrder = 4; this.root.add(this.snow);

    // landmarks
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

  // ------------------------------------------------------------------ per-frame sync
  draw(w: World, ov: Overlay, time: number) {
    if (this.bakedFor !== w || !this.terrain) this.setup(w);
    const cam = this.cam; cam.update();
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime)); this.lastTime = time;
    shared.time.value = time;
    const target = isWinter(w) ? 1 : 0;
    this.winterLevel += (target - this.winterLevel) * 0.02;
    const L = this.winterLevel;
    shared.snow.value = L;

    // light & atmosphere
    this.sun.color.copy(this.cols.sun).lerp(this.cols.sunW, L); this.sun.intensity = 2.3 - 0.5 * L;
    this.hemi.color.copy(this.cols.hemi).lerp(this.cols.hemiW, L); this.hemi.intensity = 0.6 + 0.2 * L;
    (this.scene.fog as THREE.Fog).color.copy(this.cols.bg).lerp(this.cols.bgW, L);
    this.sun.position.set(cam.x - 17, 30, cam.y + 13); this.sun.target.position.set(cam.x, 0, cam.y);
    this.waterNormal.offset.x = time * 0.012; this.waterNormal.offset.y = time * 0.006;
    const pxScale = (cam.vh * this.dpr) / (2 * FOV_TAN);
    this.smokeMat.uniforms.uScale.value = pxScale; this.snowMat.uniforms.uScale.value = pxScale;
    this.snowMat.uniforms.uFocus.value.set(cam.x, 0, cam.y); this.snowMat.uniforms.uTime.value = time; this.snowMat.uniforms.uLevel.value = L;
    this.snow.visible = L > 0.02;

    this.updateFog(w);
    this.syncNodes(w);
    const emitters: THREE.Vector3[] = [];
    this.syncBuildings(w, ov, time, emitters);
    this.syncUnits(w, ov, time, dt);
    this.syncLandmarks(w, time);
    this.updateGhost(w, ov);
    this.updateLights(w, time);
    this.updateSmoke(emitters, time);
    this.three.render(this.scene, cam.three);
    this.drawOverlay(w, ov, time);
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
    const put = (m: THREE.InstancedMesh, n: ResNode, scale: number, yoff = 0) => {
      const i = counts.get(m) ?? 0; if (i >= m.instanceMatrix.count) return;
      const hh = hash2(n.x, n.y, 4), x = n.x + 0.5 + (hash2(n.x, n.y, 5) - 0.5) * 0.35, z = n.y + 0.5 + (hash2(n.x, n.y, 6) - 0.5) * 0.35;
      this.dummy.position.set(x, this.heightAt(x, z) + yoff, z); this.dummy.rotation.set(0, hh * 6.283, 0); this.dummy.scale.setScalar(scale); this.dummy.updateMatrix();
      m.setMatrixAt(i, this.dummy.matrix);
      if (m.instanceColor || i === 0) { const k = 0.88 + hash2(n.x, n.y, 9) * 0.26; m.setColorAt(i, new THREE.Color(k, k, k)); }
      counts.set(m, i + 1);
    };
    for (const n of w.nodes) {
      if (!isExplored(w, n.x, n.y)) continue;
      const hh = hash2(n.x, n.y, 4);
      if (n.kind === 'tree') put(this.treeMeshes[Math.floor(hh * TREE_VARIANTS)], n, 0.95 + hash2(n.x, n.y, 8) * 0.4);
      else if (n.kind === 'bush') put(n.amount / n.max > 0.25 ? this.bushFull : this.bushEmpty, n, 1.0 + hh * 0.2);
      else if (n.kind === 'rock') put(this.rockMeshes[Math.floor(hh * 3)], n, 1.1 + hh * 0.5);
      else put(this.carcass, n, 1.0);
    }
    for (const m of [...this.treeMeshes, this.bushFull, this.bushEmpty, ...this.rockMeshes, this.carcass]) {
      m.count = counts.get(m) ?? 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  private syncBuildings(w: World, ov: Overlay, time: number, emitters: THREE.Vector3[]) {
    const seen = new Set<number>();
    for (const b of w.buildings) {
      seen.add(b.id);
      let e = this.bMap.get(b.id);
      if (!e) {
        const model = buildBuilding(b.kind, b.owner === 0 ? 0 : 1, b.w, b.h);
        const sc = new THREE.Group();
        const poles = new THREE.Mesh(merge([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ g: new THREE.CylinderGeometry(0.04, 0.05, 1.5, 5), c: '#7a5230', p: [(sx * b.w) / 2, 0.75, (sz * b.h) / 2] as [number, number, number] }))), MAT.prop);
        sc.add(poles);
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, 1.4, b.h)), new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.7 }));
        edge.position.y = 0.7; sc.add(edge);
        model.group.add(sc);
        const cx = b.x + b.w / 2, cz = b.y + b.h / 2;
        model.group.position.set(cx, this.heightAt(cx, cz), cz);
        this.root.add(model.group);
        e = { model, scaffold: sc, done: b.done, phase: Math.random() * 6 }; this.bMap.set(b.id, e);
      }
      const g = e.model.group;
      const show = b.owner === 0 || isExplored(w, b.x + b.w / 2, b.y + b.h / 2);
      g.visible = show;
      if (!show) continue;
      e.scaffold.visible = !b.done;
      g.scale.y = b.done ? 1 : 0.12 + 0.88 * b.progress;
      e.scaffold.scale.y = b.done ? 1 : 1 / g.scale.y;
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
      if (e.ring) e.ring.visible = sel;
    }
    for (const [id, e] of this.bMap) if (!seen.has(id)) { this.root.remove(e.model.group); this.bMap.delete(id); }
  }

  private makeRig(u: Unit, w: World): Rig {
    const root = new THREE.Group();
    const sel = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff6a0, transparent: true, opacity: 0.95, depthWrite: false })); sel.position.y = 0.06; sel.renderOrder = 5; sel.visible = false; sel.scale.setScalar(1.15); root.add(sel);
    const buff = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.8, depthWrite: false })); buff.position.y = 0.07; buff.scale.setScalar(1.6); buff.visible = false; root.add(buff);
    const mk = (g: THREE.BufferGeometry, cast = false) => { const m = new THREE.Mesh(g, MAT.unit); m.castShadow = cast; return m; };
    if (u.kind === 'deer' || u.kind === 'wolf') {
      const ag: AnimalGeo = animalGeo(u.kind, u.id % 2);
      const body = mk(ag.body, true), legA = mk(ag.legF), legB = mk(ag.legB);
      legA.position.y = 0.6; legB.position.y = 0.6; if (u.kind === 'wolf') { legA.position.y = 0.5; legB.position.y = 0.5; }
      root.add(body, legA, legB); root.scale.setScalar(u.kind === 'deer' ? 1.3 : 1.2);
      return { root, kind: u.kind, body, legA, legB, sel, buff, ang: 0, phase: Math.random() * 6, gen: 0 };
    }
    const sp = u.owner === 0 ? w.species : w.rivalSpecies;
    const pg: PersonGeo = personGeo(u.kind, sp, u.owner === 0 ? 0 : 1, u.gen);
    const body = mk(pg.body, true), legA = mk(pg.leg), legB = mk(pg.leg), armR = mk(pg.armR), armL = mk(pg.armL);
    legA.position.set(-0.09, 0.36, 0); legB.position.set(0.09, 0.36, 0);
    armR.position.set(0.24, 0.72, 0); armL.position.set(-0.24, 0.72, 0);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.15), MAT.pack.food); pack.position.set(0, 0.58, -0.22); pack.visible = false; pack.castShadow = true;
    const axe = mk(pg.toolAxe), pick = mk(pg.toolPick), hammer = mk(pg.toolHammer);
    for (const t of [axe, pick, hammer]) { t.position.y = -0.3; t.visible = false; armR.add(t); }
    const torch = new THREE.Group(); torch.position.set(0, -0.25, 0.15); torch.visible = false;
    torch.add(mk(pg.torch)); const fl = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 6), MAT.flame); fl.position.y = 0.4; torch.add(fl); armL.add(torch);
    root.add(body, legA, legB, armR, armL, pack);
    root.scale.setScalar(sp === 'neanderthal' ? 1.5 : 1.4);
    return { root, kind: 'person', body, legA, legB, armR, armL, pack, axe, pick, hammer, torch, sel, buff, ang: 0, phase: Math.random() * 6, gen: u.gen };
  }

  private syncUnits(w: World, ov: Overlay, time: number, dt: number) {
    const seen = new Set<number>(), selSet = new Set(ov.selUnits);
    for (const u of w.units) {
      seen.add(u.id);
      let r = this.rigs.get(u.id);
      if (!r) { r = this.makeRig(u, w); this.root.add(r.root); this.rigs.set(u.id, r); }
      const show = u.owner === 0 || isVisible(w, u.x, u.y);
      r.root.visible = show;
      if (!show) continue;
      const x = u.ox + (u.x - u.ox) * ov.alpha, y = u.oy + (u.y - u.oy) * ov.alpha;
      r.root.position.set(x, this.heightAt(x, y), y);
      const mvx = u.x - u.ox, mvy = u.y - u.oy, moving = Math.hypot(mvx, mvy) > 0.004;
      let want = r.ang;
      if (moving) want = Math.atan2(mvx, mvy);
      else if (u.order.t === 'attack') { const t = w._u?.get(u.order.target) ?? w._b?.get(u.order.target); if (t) { const tx = 'progress' in t ? t.x + t.w / 2 : t.x, ty = 'progress' in t ? t.y + t.h / 2 : t.y; want = Math.atan2(tx - u.x, ty - u.y); } }
      let d = want - r.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); r.ang += d * Math.min(1, dt * 14 + 0.05);
      r.root.rotation.y = r.ang;
      if (moving) r.phase += dt * (u.kind === 'wolf' ? 14 : 11);
      const sw = moving ? Math.sin(r.phase) : 0;
      r.sel.visible = selSet.has(u.id); r.buff.visible = u.buff > 0;
      const def = UNITS[u.kind];
      const attacking = def.dmg > 0 && u.cd > def.cd - 0.25 && u.order.t !== 'idle';
      if (r.kind !== 'person') {
        r.legA!.rotation.x = sw * 0.7; r.legB!.rotation.x = -sw * 0.7;
        r.body.position.y = moving ? Math.abs(sw) * 0.05 : 0;
        if (u.kind === 'wolf') r.body.rotation.x = attacking ? -0.2 : 0;
        continue;
      }
      r.legA!.rotation.x = sw * 0.75; r.legB!.rotation.x = -sw * 0.75;
      r.armL!.rotation.x = -sw * 0.6; r.armR!.rotation.x = sw * 0.6;
      r.body.position.y = moving ? Math.abs(sw) * 0.045 : Math.sin(time * 2 + u.id) * 0.006;
      r.body.rotation.x = 0; r.armR!.rotation.z = 0;
      const o = u.order;
      const node = o.t === 'gather' ? w._n?.get(o.node) : undefined;
      const working = !!node && Math.hypot(u.x - (node.x + 0.5), u.y - (node.y + 0.5)) < 1.9 && u.carry.n < def.carry;
      const building = o.t === 'build' && !moving;
      r.axe!.visible = working && node?.res === 'wood'; r.pick!.visible = working && node?.res === 'stone'; r.hammer!.visible = building;
      if (working || building) {
        const sv = Math.sin(time * 9 + u.id);
        r.armR!.rotation.x = -1.3 + sv * 0.8; r.armL!.rotation.x = -0.3;
        if (working && node?.res === 'food') { r.body.rotation.x = 0.35; r.armR!.rotation.x = -0.9 + sv * 0.4; }
      }
      if (attacking) r.armR!.rotation.x = u.kind === 'hunter' ? -1.4 : -1.7;
      const carry = u.carry.n > 0 && u.carry.res;
      r.pack!.visible = !!carry; if (carry) r.pack!.material = MAT.pack[u.carry.res!];
      r.torch!.visible = u.owner === 0 && hasDisc(w, 'portable') && (u.kind === 'hunter' || u.kind === 'guard' || u.kind === 'leader');
      if (r.torch!.visible) { const fl = r.torch!.children[1]; fl.scale.set(1, 0.8 + 0.3 * Math.sin(time * 13 + u.id), 1); }
    }
    for (const [id, r] of this.rigs) if (!seen.has(id)) { this.root.remove(r.root); this.rigs.delete(id); }
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
    this.lights.forEach((l, i) => {
      const s = c[i];
      if (!s || s.d > 40) { l.intensity = 0; return; }
      l.position.copy(s.p); l.intensity = (8 + 3 * this.winterLevel) * (0.9 + 0.1 * Math.sin(time * 9 + i * 3) + 0.05 * Math.sin(time * 21));
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

  // ------------------------------------------------------------------ 2D overlay (bars, order lines, labels)
  private ring(wx: number, wy: number, r: number, n = 40) {
    const { ctx, cam } = this;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, p = cam.toScreen(wx + Math.cos(a) * r, wy + Math.sin(a) * r, this.heightAt(wx, wy)); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
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
    // supply range
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 9]);
    for (const b of w.buildings) if (b.owner === 0 && b.done && (b.kind === 'hearth' || b.kind === 'watch')) { this.ring(b.x + b.w / 2, b.y + b.h / 2, SUPPLY_RANGE, 96); ctx.stroke(); }
    ctx.restore();
    // landmark labels
    for (const l of w.landmarks) {
      if (!isExplored(w, l.x, l.y) || z < 16) continue;
      const p = cam.toScreen(l.x + 0.5, l.y + 0.5, l.id === 'cave' ? 2.4 : 2.8);
      ctx.font = `700 ${Math.max(10, z * 0.38)}px system-ui,sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(l.name, p.x + 1, p.y + 1); ctx.fillStyle = '#fff4cc'; ctx.fillText(l.name, p.x, p.y);
    }
    // building bars + warmth ring
    for (const b of w.buildings) {
      const e = this.bMap.get(b.id); if (!e || !e.model.group.visible) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, p = cam.toScreen(cx, cy, b.kind === 'watch' ? 4.2 : 2.0), bw = Math.max(34, b.w * z * 0.8);
      if (!b.done) this.bar(p.x - bw / 2, p.y, bw, 6, b.progress, '#ffd54a');
      else if (b.queue.length) this.bar(p.x - bw / 2, p.y, bw, 6, 1 - b.queue[0].t / UNITS[b.queue[0].kind].time, '#7ec8ff');
      else if (b.hp < b.maxHp) this.bar(p.x - bw / 2, p.y, bw, 5, b.hp / b.maxHp, b.hp / b.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
      if (b.outpost) { ctx.fillStyle = '#ffe36e'; ctx.font = `800 ${Math.max(10, z * 0.36)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('OUTPOST', p.x, p.y - 10); }
      if (ov.selBuilding === b.id) { const wm = BUILDINGS[b.kind].warmth; if (wm) { ctx.strokeStyle = 'rgba(255,170,80,.6)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); this.ring(cx, cy, wm + Math.max(b.w, b.h) / 2); ctx.stroke(); ctx.setLineDash([]); } }
    }
    // unit bars
    const sel = new Set(ov.selUnits);
    for (const u of w.units) {
      const r = this.rigs.get(u.id); if (!r || !r.root.visible) continue;
      const x = u.ox + (u.x - u.ox) * ov.alpha, y = u.oy + (u.y - u.oy) * ov.alpha;
      const s = sel.has(u.id);
      if (u.owner === 0 && u.order.t === 'research') { const p = cam.toScreen(x, y, 1.6); ctx.fillStyle = '#ffe36e'; ctx.font = '800 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', p.x, p.y); }
      if (!s && u.hp >= u.maxHp) continue;
      const p = cam.toScreen(x, y, this.heightAt(x, y) + 1.45), bw = Math.max(22, z * 0.7);
      this.bar(p.x - bw / 2, p.y, bw, 4, u.hp / u.maxHp, u.hp / u.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
    }
    // order lines
    ctx.save(); ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
    for (const id of ov.selUnits) {
      const u = w._u?.get(id); if (!u) continue;
      let tx: number | null = null, ty: number | null = null, c = 'rgba(255,255,255,.65)';
      const o = u.order;
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
    // combat effects
    for (const f of w._fx ?? []) {
      const a = cam.toScreen(f.x1, f.y1, 0.8), b = cam.toScreen(f.x2, f.y2, 0.8);
      ctx.globalAlpha = Math.min(1, f.t * 6);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 3) { ctx.strokeStyle = '#f2e6c0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 7); ctx.fill(); }
      else { ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 2.5; for (let i = 0; i < 6; i++) { const ang = i * 1.05, r0 = 5 + (0.12 - f.t) * 50; ctx.beginPath(); ctx.moveTo(a.x + Math.cos(ang) * r0, a.y + Math.sin(ang) * r0 * 0.7); ctx.lineTo(a.x + Math.cos(ang) * (r0 + 6), a.y + Math.sin(ang) * (r0 + 6) * 0.7); ctx.stroke(); } }
      ctx.globalAlpha = 1;
    }
    // pings
    for (const p of ov.pings) { ctx.strokeStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - p.age / 0.7); ctx.lineWidth = 3; this.ring(p.x, p.y, 0.25 + p.age * 1.4); ctx.stroke(); ctx.globalAlpha = 1; }
    // placement label
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
    const corners = [[0, 0], [this.cam.vw, 0], [this.cam.vw, this.cam.vh], [0, this.cam.vh]].map(([x, y]) => this.cam.toWorld(x, y));
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath();
    corners.forEach((p, i) => { const px = Math.max(0, Math.min(c.width, p.x * sx)), py = Math.max(0, Math.min(c.height, p.y * sy)); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath(); g.stroke();
  }
}

export type { Building };
