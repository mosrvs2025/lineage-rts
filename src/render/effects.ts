/** Particles, arrows, rings and ambient life (leaves, fireflies, birds). All procedural, GPU-drawn. */
import * as THREE from 'three';

const PVERT = 'attribute vec3 aCol; attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=aSize*uScale/max(0.1,-mv.z); vC=aCol; vA=aAlpha; }';
const PFRAG = 'varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.12,d)*vA; if(a<0.01) discard; gl_FragColor=vec4(vC,a); #include <tonemapping_fragment>\n#include <colorspace_fragment>\n }';

export class Particles {
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  private cap: number; private cursor = 0;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private alpha: Float32Array;
  private vel: Float32Array; private life: Float32Array; private max: Float32Array; private s0: Float32Array; private s1: Float32Array; private grav: Float32Array; private drag: Float32Array; private a0: Float32Array;
  private geo = new THREE.BufferGeometry();
  private tmp = new THREE.Color();

  constructor(cap: number, additive: boolean) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap).fill(1); this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap); this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.a0 = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 } } });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
  }
  setScale(px: number) { this.mat.uniforms.uScale.value = px; }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: number, gravity = 0, drag = 0.6, a0 = 1) {
    const i = this.cursor++ % this.cap, k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z; this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.grav[i] = gravity; this.drag[i] = drag; this.a0[i] = a0;
    this.tmp.setHex(color); this.col[k] = this.tmp.r; this.col[k + 1] = this.tmp.g; this.col[k + 2] = this.tmp.b;
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, f = 1 - Math.max(0, this.life[i]) / this.max[i], dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr - this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * f;
      this.alpha[i] = this.a0[i] * (f < 0.1 ? f / 0.1 : 1 - (f - 0.1) / 0.9);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true; (this.geo.attributes.aCol as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Arrows in flight (small pooled meshes following a parabola). */
export class Arrows {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; t: number; dur: number; a: THREE.Vector3; b: THREE.Vector3; on: boolean; onHit: () => void }[] = [];
  constructor() {
    const g = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 4).rotateX(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.035, 0.12, 4).rotateX(Math.PI / 2).translate(0, 0, 0.33);
    const fea = new THREE.BoxGeometry(0.1, 0.002, 0.1).translate(0, 0, -0.25);
    const geo = new THREE.BufferGeometry();
    const parts = [g, tip, fea].map((p) => p.toNonIndexed());
    const pos: number[] = []; for (const p of parts) pos.push(...(p.attributes.position.array as Float32Array));
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8c9a0, roughness: 0.8 });
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(geo, mat); m.visible = false; this.group.add(m); this.items.push({ m, t: 0, dur: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), on: false, onHit: () => undefined }); }
  }
  fire(ax: number, ay: number, az: number, bx: number, by: number, bz: number, onHit: () => void) {
    const it = this.items.find((i) => !i.on); if (!it) return;
    it.on = true; it.t = 0; it.a.set(ax, ay, az); it.b.set(bx, by, bz); it.dur = 0.16 + it.a.distanceTo(it.b) * 0.028; it.onHit = onHit; it.m.visible = true;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt; const f = Math.min(1, it.t / it.dur);
      const px = it.a.x + (it.b.x - it.a.x) * f, pz = it.a.z + (it.b.z - it.a.z) * f, arc = Math.sin(f * Math.PI) * (0.5 + it.a.distanceTo(it.b) * 0.08);
      const py = it.a.y + (it.b.y - it.a.y) * f + arc;
      const f2 = Math.min(1, f + 0.04), qx = it.a.x + (it.b.x - it.a.x) * f2, qz = it.a.z + (it.b.z - it.a.z) * f2, qy = it.a.y + (it.b.y - it.a.y) * f2 + Math.sin(f2 * Math.PI) * (0.5 + it.a.distanceTo(it.b) * 0.08);
      it.m.position.set(px, py, pz); it.m.lookAt(qx, qy, qz);
      if (f >= 1) { it.on = false; it.m.visible = false; it.onHit(); }
    }
  }
}

/** Expanding ground rings (rally, spawn, building complete). */
export class Rings {
  readonly group = new THREE.Group();
  private items: { m: THREE.Mesh; t: number; dur: number; r: number; on: boolean }[] = [];
  constructor() {
    const geo = new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.renderOrder = 7; this.group.add(m); this.items.push({ m, t: 0, dur: 1, r: 1, on: false });
    }
  }
  burst(x: number, y: number, z: number, radius: number, color = 0xffe9a0, dur = 0.9) {
    const it = this.items.find((i) => !i.on) ?? this.items[0];
    it.on = true; it.t = 0; it.dur = dur; it.r = radius; it.m.position.set(x, y + 0.08, z); it.m.visible = true; (it.m.material as THREE.MeshBasicMaterial).color.setHex(color);
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.on) continue; it.t += dt; const f = it.t / it.dur;
      if (f >= 1) { it.on = false; it.m.visible = false; continue; }
      const e = 1 - Math.pow(1 - f, 3); it.m.scale.setScalar(0.2 + it.r * e); (it.m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - f);
    }
  }
}

/** Falling leaves, night fireflies and a flock of birds. */
export class AmbientLife {
  readonly group = new THREE.Group();
  private leaves: THREE.Points; private flies: THREE.Points; private birds: THREE.Mesh[] = [];
  private leafMat: THREE.ShaderMaterial; private flyMat: THREE.ShaderMaterial;
  constructor() {
    const mkPts = (n: number, col: (i: number) => number[], span: number) => {
      const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { p[i * 3] = Math.random() * span; p[i * 3 + 1] = Math.random() * 14; p[i * 3 + 2] = Math.random() * span; const cc = col(i); c.set(cc, i * 3); }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(c, 3)); return g;
    };
    const leafCols = [[0.9, 0.45, 0.1], [0.85, 0.2, 0.08], [0.95, 0.7, 0.15], [0.6, 0.3, 0.08]].map((c) => c.map((v) => Math.pow(v, 2.2)));
    this.leafMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uFocus: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLevel: { value: 0 }, uScale: { value: 600 } },
      vertexShader: 'attribute vec3 aCol; varying vec3 vC; uniform vec3 uFocus; uniform float uTime; uniform float uScale; void main(){ vec3 p=position; float sp=0.5+fract(p.x*3.7)*0.5; float fall=mod(p.y-uTime*sp,14.0); vec2 xz=mod(p.xz-uFocus.xz+25.0,50.0)-25.0+uFocus.xz; xz+=vec2(sin(uTime*0.9+p.z*2.0),cos(uTime*0.7+p.x*2.0))*0.8; vec4 mv=viewMatrix*vec4(xz.x,fall,xz.y,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=0.16*uScale/-mv.z; vC=aCol; }',
      fragmentShader: 'varying vec3 vC; uniform float uLevel; void main(){ vec2 c=gl_PointCoord-0.5; float a=step(abs(c.x)+abs(c.y)*1.6,0.48)*uLevel; if(a<0.01) discard; gl_FragColor=vec4(vC,a); #include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
    });
    this.leaves = new THREE.Points(mkPts(260, (i) => leafCols[i % 4], 50), this.leafMat); this.leaves.frustumCulled = false; this.leaves.renderOrder = 5;
    this.flyMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uFocus: { value: new THREE.Vector3() }, uTime: { value: 0 }, uLevel: { value: 0 }, uScale: { value: 600 } },
      vertexShader: 'attribute vec3 aCol; varying float vB; uniform vec3 uFocus; uniform float uTime; uniform float uScale; void main(){ vec3 p=position; float h=fract(p.x*5.3+p.z*1.7); vec2 xz=mod(p.xz-uFocus.xz+22.0,44.0)-22.0+uFocus.xz; xz+=vec2(sin(uTime*0.5+h*20.0),cos(uTime*0.4+h*17.0))*1.6; float y=0.4+mod(p.y,1.6)+sin(uTime*0.8+h*9.0)*0.3; vec4 mv=viewMatrix*vec4(xz.x,y,xz.y,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=0.2*uScale/-mv.z; vB=0.35+0.65*pow(0.5+0.5*sin(uTime*(1.5+h*2.0)+h*30.0),3.0); }',
      fragmentShader: 'varying float vB; uniform float uLevel; void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.0,d)*vB*uLevel; if(a<0.01) discard; gl_FragColor=vec4(0.75,1.0,0.35,a); #include <tonemapping_fragment>\n#include <colorspace_fragment>\n }',
    });
    this.flies = new THREE.Points(mkPts(160, () => [1, 1, 1], 44), this.flyMat); this.flies.frustumCulled = false; this.flies.renderOrder = 6;
    const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, -0.4, 0, -0.05, 0, 0, -0.02, 0, 0, 0.12, 0.4, 0, -0.05, 0, 0, -0.02], 3)); wing.computeVertexNormals();
    const bm = new THREE.MeshBasicMaterial({ color: 0x22201e, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(wing, bm); b.scale.setScalar(0.9); this.birds.push(b); this.group.add(b); }
    this.group.add(this.leaves, this.flies);
  }
  setScale(px: number) { this.leafMat.uniforms.uScale.value = px; this.flyMat.uniforms.uScale.value = px; }
  update(time: number, fx: number, fz: number, autumn: number, night: number, winter: number) {
    for (const m of [this.leafMat, this.flyMat]) { m.uniforms.uFocus.value.set(fx, 0, fz); m.uniforms.uTime.value = time; }
    this.leafMat.uniforms.uLevel.value = autumn; this.leaves.visible = autumn > 0.02;
    this.flyMat.uniforms.uLevel.value = night * (1 - winter); this.flies.visible = night * (1 - winter) > 0.05;
    const day = Math.max(0, 1 - night * 1.6) * (1 - winter * 0.9);
    this.birds.forEach((b, i) => {
      b.visible = day > 0.2;
      const a = time * (0.12 + (i % 3) * 0.02) + i * 0.9, r = 9 + (i % 4) * 2.5;
      b.position.set(fx + Math.cos(a) * r + Math.sin(time * 0.3 + i) * 2, 8 + Math.sin(time * 0.5 + i) * 0.8 + (i % 3), fz + Math.sin(a * 0.9) * r * 0.7);
      b.rotation.y = -a + Math.PI / 2; b.scale.set(0.9, 1, 0.9); (b.geometry.attributes.position as THREE.BufferAttribute);
      b.rotation.z = Math.sin(time * 9 + i * 2) * 0.5; // flap by banking the V
    });
  }
}
