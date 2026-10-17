/**
 * Live 3D Character Showcase & Animated HUD Portrait Renderer.
 * Powers both:
 *  1. The interactive 3D Character & Unit Stage on the Clan Selection screen.
 *  2. The live 3D animated unit portrait inside the in-game Selection HUD (#selpanel).
 */
import * as THREE from 'three';
import { createWorld, makeUnit } from '../sim/world';
import type { Species, Unit, UnitKind, World } from '../sim/types';
import { MAT, merge } from './models';
import { animateRig, createRig, type Rig } from './rigs';

export type PreviewPose = 'idle' | 'walk' | 'attack' | 'work';

export interface StageConfig {
  species: Species;
  unitKind: UnitKind;
  gen: number;
  bannerColor: string;
  pose: PreviewPose;
  variant: number;
}

export class Preview3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  private pedestal = new THREE.Group();
  private pedestalGen2 = new THREE.Group();
  private pedestalGen3 = new THREE.Group();
  private fireLight = new THREE.PointLight(0xff9640, 2.6, 8, 1.5);
  private flames: THREE.Object3D[] = [];
  private rig: Rig | null = null;
  private dummyWorld: World;
  private dummyUnit: Unit;
  private cfgKey = '';
  private yaw = 0.35;
  private pulseT = 0;
  private dragging = false;
  private lastX = 0;
  private boundCanvas: HTMLCanvasElement | null = null;
  private lastT = performance.now() / 1000;

  constructor() {
    this.dummyWorld = createWorld('human', 777);
    this.dummyWorld.disc.portable = 'hidden';
    this.dummyUnit = makeUnit(this.dummyWorld, 'leader', 0, 10, 10);

    // Studio lighting for character stage
    const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4a3824, 0.9);
    const key = new THREE.DirectionalLight(0xfff0d4, 2.2);
    key.position.set(2.5, 4.4, 3.4);
    const rim = new THREE.DirectionalLight(0x6ab4ff, 1.5);
    rim.position.set(-2.8, 2.8, -2.5);
    this.fireLight.position.set(-0.75, 0.65, 0.65);
    this.scene.add(hemi, key, rim, this.fireLight, this.pedestal);

    this.buildPedestal();
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      const c = document.createElement('canvas');
      this.renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, powerPreference: 'high-performance' });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      return this.renderer;
    } catch {
      return null;
    }
  }

  private buildPedestal() {
    const cyl = (rt: number, rb: number, h: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
    const rock = (r: number) => new THREE.DodecahedronGeometry(r, 0);
    const cone = (r: number, h: number, seg = 6) => new THREE.ConeGeometry(r, h, seg);
    const sph = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, seg);

    const parts = [
      { g: cyl(0.96, 1.08, 0.14, 20), c: '#3d3326', p: [0, -0.07, 0] as [number, number, number] },
      { g: cyl(0.88, 0.94, 0.06, 20), c: '#5c6e3b', p: [0, 0.01, 0] as [number, number, number] },
      { g: rock(0.16), c: '#7a7d88', p: [0.66, 0.08, -0.35] as [number, number, number], s: [1.1, 0.7, 0.9] as [number, number, number] },
      { g: rock(0.11), c: '#8e919c', p: [0.54, 0.05, -0.52] as [number, number, number] },
    ];
    // Mini hearth stones on left of pedestal
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      parts.push({
        g: rock(0.065),
        c: '#8d909b',
        p: [-0.60 + Math.cos(a) * 0.16, 0.05, 0.36 + Math.sin(a) * 0.16] as [number, number, number],
      });
    }
    const baseMesh = new THREE.Mesh(merge(parts), MAT.unit);
    this.pedestal.add(baseMesh);

    const fg = new THREE.Group();
    fg.position.set(-0.60, 0.06, 0.36);
    const fOuter = new THREE.Mesh(cone(0.11, 0.32, 7), MAT.flame);
    fOuter.position.y = 0.16;
    const fCore = new THREE.Mesh(cone(0.06, 0.2, 6), MAT.flameCore);
    fCore.position.y = 0.1;
    fg.add(fOuter, fCore);
    this.pedestal.add(fg);
    this.flames.push(fg);

    // Era II (Gen II+) Pedestal Upgrades: Fired clay pottery jars & carved standing stone monolith
    const gen2Parts = [
      // Fired clay amphora jar
      { g: sph(0.11, 9), c: '#c87242', p: [0.62, 0.12, 0.32] as [number, number, number], s: [0.95, 1.25, 0.95] as [number, number, number] },
      { g: cyl(0.06, 0.05, 0.08, 9), c: '#d88452', p: [0.62, 0.25, 0.32] as [number, number, number] },
      { g: cyl(0.072, 0.072, 0.025, 9), c: '#3a2618', p: [0.62, 0.21, 0.32] as [number, number, number] },
      // Smaller grain bowl
      { g: sph(0.075, 8), c: '#b86438', p: [0.46, 0.08, 0.46] as [number, number, number], s: [1.1, 0.85, 1.1] as [number, number, number] },
      { g: sph(0.06, 7), c: '#e8bd63', p: [0.46, 0.11, 0.46] as [number, number, number], s: [1, 0.5, 1] as [number, number, number] },
      // Carved standing stone monolith
      { g: cyl(0.09, 0.13, 0.52, 6), c: '#8d929e', p: [-0.62, 0.26, -0.38] as [number, number, number], r: [0.05, 0.4, -0.06] as [number, number, number] },
      { g: cyl(0.095, 0.095, 0.04, 6), c: '#38d39c', p: [-0.61, 0.38, -0.37] as [number, number, number], r: [0.05, 0.4, -0.06] as [number, number, number] },
    ];
    this.pedestalGen2.add(new THREE.Mesh(merge(gen2Parts), MAT.unit));
    this.pedestal.add(this.pedestalGen2);

    // Era III (Gen III+) Pedestal Upgrades: Golden Temple Ring, Ancestral Totem & Twin Bronze Brazier
    const gen3Parts = [
      // Golden carved temple rim around the pedestal
      { g: cyl(0.91, 0.93, 0.035, 24), c: '#e8bd63', p: [0, 0.03, 0] as [number, number, number] },
      // Ancestral carved pillar & golden sun-totem at back of pedestal
      { g: cyl(0.11, 0.14, 0.78, 8), c: '#6e5233', p: [0, 0.39, -0.72] as [number, number, number] },
      { g: cyl(0.13, 0.13, 0.06, 10), c: '#f0c254', p: [0, 0.78, -0.72] as [number, number, number] },
      { g: cyl(0.18, 0.18, 0.04, 14), c: '#ffd86b', p: [0, 0.94, -0.72] as [number, number, number], r: [Math.PI / 2, 0, 0] as [number, number, number] },
      // Right-side bronze brazier tripod
      { g: cyl(0.15, 0.09, 0.18, 10), c: '#d99b2e', p: [0.64, 0.22, -0.10] as [number, number, number] },
      { g: cyl(0.17, 0.15, 0.05, 10), c: '#ffd86b', p: [0.64, 0.32, -0.10] as [number, number, number] },
    ];
    this.pedestalGen3.add(new THREE.Mesh(merge(gen3Parts), MAT.unit));

    const fg2 = new THREE.Group();
    fg2.position.set(0.64, 0.34, -0.10);
    const f2Outer = new THREE.Mesh(cone(0.10, 0.28, 7), MAT.flame);
    f2Outer.position.y = 0.14;
    const f2Core = new THREE.Mesh(cone(0.055, 0.18, 6), MAT.flameCore);
    f2Core.position.y = 0.09;
    fg2.add(f2Outer, f2Core);
    this.pedestalGen3.add(fg2);
    this.flames.push(fg2);

    this.pedestal.add(this.pedestalGen3);
  }

  private bindDrag(target: HTMLCanvasElement) {
    if (this.boundCanvas === target) return;
    this.boundCanvas = target;
    target.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      target.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.yaw += dx * 0.014;
    });
    const up = () => { this.dragging = false; };
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  /** Render either the Clan Selection 3D Hero Stage or the in-game 3D Unit Portrait if visible. */
  renderFrame(nowSec: number, stageCfg: StageConfig | null, liveUnit: Unit | null, liveWorld: World | null) {
    const dt = Math.min(0.1, Math.max(0.001, nowSec - this.lastT));
    this.lastT = nowSec;

    const stageCanvas = document.getElementById('clan-stage-canvas') as HTMLCanvasElement | null;
    if (stageCanvas && stageCfg) {
      this.bindDrag(stageCanvas);
      this.renderToCanvas(stageCanvas, dt, nowSec, {
        species: stageCfg.species,
        unitKind: stageCfg.unitKind,
        gen: stageCfg.gen,
        bannerColor: stageCfg.bannerColor,
        pose: stageCfg.pose,
        variant: stageCfg.variant,
        bustOnly: false,
      });
      return;
    }

    const hudCanvas = document.getElementById('sel-portrait-canvas') as HTMLCanvasElement | null;
    if (hudCanvas && liveUnit && liveWorld) {
      const sp = liveUnit.owner === 0 ? liveWorld.species : liveWorld.rivalSpecies;
      const mv = Math.hypot(liveUnit.x - liveUnit.ox, liveUnit.y - liveUnit.oy) / 0.05 > 0.2;
      const pose: PreviewPose = mv
        ? 'walk'
        : liveUnit.order.t === 'attack'
        ? 'attack'
        : liveUnit.order.t === 'gather' || liveUnit.order.t === 'build'
        ? 'work'
        : 'idle';
      this.renderToCanvas(hudCanvas, dt, nowSec, {
        species: sp,
        unitKind: liveUnit.kind,
        gen: liveUnit.gen,
        bannerColor: liveUnit.owner === 0 ? (liveWorld.bannerColor || '') : '#d84a36',
        pose,
        variant: liveUnit.id,
        bustOnly: true,
      });
    }
  }

  private renderToCanvas(
    target: HTMLCanvasElement,
    dt: number,
    nowSec: number,
    opts: StageConfig & { bustOnly: boolean },
  ) {
    const r = this.ensureRenderer();
    if (!r) return;

    const key = `${opts.species}|${opts.unitKind}|${opts.gen}|${opts.bannerColor}|${opts.variant & 3}`;
    if (key !== this.cfgKey || !this.rig) {
      const hadPrev = !!this.cfgKey;
      this.cfgKey = key;
      if (this.rig) this.scene.remove(this.rig.root);
      this.dummyWorld.species = opts.species;
      this.dummyWorld.gen = opts.gen;
      this.dummyWorld.disc.portable = opts.gen >= 2 ? 'known' : 'hidden';
      this.dummyWorld.bannerColor = opts.bannerColor || undefined;
      this.dummyUnit.kind = opts.unitKind;
      this.dummyUnit.gen = opts.gen;
      this.dummyUnit.id = opts.variant;
      this.dummyUnit.owner = opts.bannerColor === '#d84a36' ? 1 : 0;
      this.rig = createRig(this.dummyUnit, this.dummyWorld, nowSec - 2);
      this.scene.add(this.rig.root);
      if (hadPrev && !opts.bustOnly) this.pulseT = 0.36;
    }

    if (this.pulseT > 0) this.pulseT = Math.max(0, this.pulseT - dt);

    // Drive pose via dummyUnit state
    const u = this.dummyUnit;
    u.ox = u.x;
    u.oy = u.y;
    u.carry = { res: null, n: 0 };
    if (opts.pose === 'walk') {
      u.x = u.ox + 0.14;
      u.order = { t: 'move', x: u.x + 2, y: u.y };
    } else if (opts.pose === 'attack') {
      u.order = { t: 'attack', target: 9999 };
      u.cd = (1 - ((nowSec * 1.15) % 1)) * 1.1;
    } else if (opts.pose === 'work') {
      u.order = { t: 'build', b: 1 };
    } else {
      u.order = { t: 'idle' };
    }

    animateRig(this.rig, u, { time: nowSec, dt, w: this.dummyWorld, alpha: 1, selected: false });

    // Show golden ancestral mastery ring under Gen III character on stage
    this.rig.buff.visible = !opts.bustOnly && opts.gen >= 3;

    if (opts.bustOnly) {
      this.pedestal.visible = false;
      this.rig.root.rotation.y = Math.sin(nowSec * 0.8) * 0.28 + 0.18;
      const isAnimal = opts.unitKind === 'deer' || opts.unitKind === 'wolf' || opts.unitKind === 'mammoth';
      const eyeY = isAnimal ? 0.95 : 1.24 * (this.rig.root.scale.y || 1.35) / 1.35;
      this.cam.position.set(0.12, eyeY + 0.05, isAnimal ? 2.2 : 1.55);
      this.cam.lookAt(0, eyeY - 0.06, 0);
    } else {
      this.pedestal.visible = true;
      this.pedestalGen2.visible = opts.gen >= 2;
      this.pedestalGen3.visible = opts.gen >= 3;

      if (!this.dragging) this.yaw += dt * 0.45;
      const popScale = 1 + Math.sin((this.pulseT / 0.36) * Math.PI) * 0.06;
      this.rig.root.scale.multiplyScalar(popScale);
      this.rig.root.rotation.y = this.yaw;
      this.pedestal.rotation.y = this.yaw;
      for (const f of this.flames) {
        f.scale.set(1 + Math.sin(nowSec * 14) * 0.08, 0.9 + Math.sin(nowSec * 19) * 0.14 + this.pulseT * 0.8, 1);
      }
      const baseIntensity = opts.gen >= 3 ? 3.2 : opts.gen === 2 ? 2.8 : 2.4;
      this.fireLight.intensity = baseIntensity + Math.sin(nowSec * 17) * 0.35 + this.pulseT * 3.5;
      this.cam.position.set(0, 1.30, 3.68);
      this.cam.lookAt(0, 0.86, 0);
    }

    const rect = target.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round((rect.width || target.width || 200) * dpr));
    const h = Math.max(64, Math.round((rect.height || target.height || 200) * dpr));
    if (target.width !== w || target.height !== h) {
      target.width = w;
      target.height = h;
    }
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();

    r.setSize(w, h, false);
    r.render(this.scene, this.cam);

    const ctx = target.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(r.domElement, 0, 0, w, h);
    }
  }
}
