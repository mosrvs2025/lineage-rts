/** Low-poly 3D models built from primitives (no asset files) and the materials/shader patches they share. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingKind, UnitKind } from '../sim/types';

// ------------------------------------------------------------------ shared shader state (fog of war, snow, wind)
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;
export const shared = {
  fogMap: { value: blank as THREE.Texture },
  mapSize: { value: new THREE.Vector2(72, 48) },
  snow: { value: 0 },
  time: { value: 0 },
};

/** Patch a standard material: fog-of-war darkening, winter snow on upward faces, optional wind sway on instanced meshes. */
export function enhance<T extends THREE.MeshStandardMaterial>(m: T, o: { sway?: boolean; snow?: number } = {}): T {
  const snow = o.snow ?? 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFogMap = shared.fogMap; sh.uniforms.uMapSize = shared.mapSize; sh.uniforms.uSnow = shared.snow; sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;\nvarying float vWNy;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.sway ? `#ifdef USE_INSTANCING
        float sw = sin(uTime * 1.4 + instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.6) * 0.04;
        transformed.x += sw * max(transformed.y, 0.0) * max(transformed.y, 0.0) * 0.45;
      #endif` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        fwp = modelMatrix * fwp;
        vFogWorld = fwp.xyz;
        vWNy = normalize(mat3(modelMatrix) * objectNormal).y;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;\nvarying float vWNy;\nuniform sampler2D uFogMap;\nuniform vec2 uMapSize;\nuniform float uSnow;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float notBlue = step(diffuseColor.b, diffuseColor.g * 1.25 + 0.04);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), uSnow * smoothstep(0.35, 0.85, vWNy) * notBlue * ${snow.toFixed(2)});`)
      .replace('#include <dithering_fragment>', `gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.02, 0.03, 0.06), texture2D(uFogMap, vFogWorld.xz / uMapSize).a);
        #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => `enh${o.sway ? 1 : 0}${snow}`;
  return m;
}

const lit = (rough = 0.88) => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: rough, metalness: 0 });
export const MAT = {
  prop: enhance(lit(), { snow: 1 }),                      // buildings, rocks: snow on roofs
  tree: enhance(lit(0.95), { sway: true, snow: 1 }),
  unit: enhance(lit(0.8)),
  flame: new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }),
  flameCore: new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  pack: { food: enhance(new THREE.MeshStandardMaterial({ color: 0xc23a3a, roughness: 0.9, flatShading: true })), wood: enhance(new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9, flatShading: true })), stone: enhance(new THREE.MeshStandardMaterial({ color: 0x9a9ca6, roughness: 0.9, flatShading: true })) },
};

// ------------------------------------------------------------------ geometry builders
const tmp = new THREE.Object3D();
type V3 = [number, number, number];
export interface Part { g: THREE.BufferGeometry; c: number | string; p?: V3; r?: V3; s?: V3 }

export function merge(parts: Part[]): THREE.BufferGeometry {
  const list = parts.map((pt) => {
    const g = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
    tmp.position.set(...(pt.p ?? [0, 0, 0])); tmp.rotation.set(...(pt.r ?? [0, 0, 0])); tmp.scale.set(...(pt.s ?? [1, 1, 1])); tmp.updateMatrix();
    g.applyMatrix4(tmp.matrix);
    const col = new THREE.Color(pt.c as THREE.ColorRepresentation), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(list, false)!;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);
const sph = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const rock = (r: number) => new THREE.DodecahedronGeometry(r, 0);
const shade = (hex: string, f: number) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return c.getHex(); };
const TEAM = { 0: '#27b7c6', 1: '#d84a36', 2: '#999999' } as const;
const rnd = (seed: number) => { let s = seed | 0; return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 8) & 0xffff) / 65536; }; };

// ------------------------------------------------------------------ nature
export const TREE_VARIANTS = 8;
function oakGeo(a: string, b: string, seed: number) {
  const r = rnd(seed), parts: Part[] = [{ g: cyl(0.08, 0.14, 1.0, 6), c: '#6b4a2e', p: [0, 0.5, 0] }];
  const blobs: [number, number, number, number][] = [[0, 1.45, 0, 0.7], [0.45, 1.1, 0.15, 0.5], [-0.42, 1.15, -0.12, 0.52], [0.12, 2.0, 0.05, 0.5], [-0.2, 1.7, 0.36, 0.42], [0.25, 1.65, -0.35, 0.4]];
  blobs.forEach(([x, y, z, rr], i) => parts.push({ g: sph(rr, 1), c: shade(i % 2 ? a : b, 0.85 + r() * 0.3), p: [x, y, z], s: [1, 0.9, 1] }));
  return merge(parts);
}
function pineGeo(shadeK: number) {
  const parts: Part[] = [{ g: cyl(0.07, 0.12, 0.9, 6), c: '#5a3d25', p: [0, 0.45, 0] }];
  [[0.8, 1.0, 0.95], [0.64, 0.9, 1.6], [0.5, 0.85, 2.15], [0.34, 0.75, 2.65]].forEach(([rr, hh, y], i) => parts.push({ g: cone(rr, hh, 7), c: shade('#2d6a3c', (0.8 + i * 0.1) * shadeK), p: [0, y, 0] }));
  return merge(parts);
}
function birchGeo() {
  const parts: Part[] = [{ g: cyl(0.06, 0.1, 1.5, 6), c: '#ece8dc', p: [0, 0.75, 0] }];
  for (let i = 0; i < 5; i++) parts.push({ g: box(0.13, 0.04, 0.13), c: '#3a3a34', p: [0, 0.3 + i * 0.25, 0] });
  [[0, 1.8, 0, 0.6], [0.35, 1.5, 0.1, 0.42], [-0.34, 1.55, -0.1, 0.44], [0.05, 2.3, 0, 0.42]].forEach(([x, y, z, rr], i) => parts.push({ g: sph(rr, 1), c: shade('#f0d060', 0.9 + (i % 2) * 0.15), p: [x, y, z] }));
  return merge(parts);
}
export const makeTreeGeos = () => [
  oakGeo('#5fa83f', '#3a7a2c', 1), oakGeo('#e9a23a', '#c0762a', 2), pineGeo(1), birchGeo(),
  oakGeo('#d96a2c', '#a8442a', 3), pineGeo(0.9), oakGeo('#6fb04a', '#3f8a34', 4), oakGeo('#b6c24a', '#7a8a2a', 5),
];
export const makeBushGeo = (berries: boolean) => {
  const parts: Part[] = [];
  [[0, 0.3, 0, 0.36], [0.3, 0.24, 0.1, 0.28], [-0.28, 0.24, -0.08, 0.3], [0.05, 0.28, 0.3, 0.26]].forEach(([x, y, z, r], i) => parts.push({ g: sph(r, 1), c: shade('#4e9a3a', 0.85 + (i % 2) * 0.2), p: [x, y, z] }));
  if (berries) for (let i = 0; i < 10; i++) { const a = i * 2.39, rr = 0.2 + (i % 3) * 0.1; parts.push({ g: sph(0.055, 0), c: '#d83a3a', p: [Math.cos(a) * rr, 0.3 + (i % 4) * 0.07, Math.sin(a) * rr] }); }
  return merge(parts);
};
export const makeRockGeos = () => [0, 1, 2].map((v) => {
  const defs: [number, number, number, number, number, number][][] = [
    [[0, 0.22, 0, 0.42, 0.75, 0.9], [0.5, 0.15, 0.2, 0.28, 0.8, 1]],
    [[0, 0.25, 0, 0.5, 0.7, 0.8], [-0.4, 0.12, 0.3, 0.26, 1, 0.8], [0.35, 0.14, -0.3, 0.3, 0.8, 1]],
    [[0, 0.3, 0, 0.45, 1, 0.85], [0.42, 0.14, 0.2, 0.3, 0.7, 0.9]],
  ];
  return merge(defs[v].map(([x, y, z, r, sy, sz], i) => ({ g: rock(r), c: shade('#8a8c96', 0.8 + i * 0.12), p: [x, y, z] as V3, r: [0.3 * i, i, 0.2] as V3, s: [1, sy, sz] as V3 })));
});
export const makeCarcassGeo = () => merge([
  { g: sph(0.34, 1), c: '#9a6b45', p: [0, 0.2, 0], s: [1.35, 0.55, 0.8] }, { g: sph(0.26, 1), c: '#c99a6e', p: [0, 0.16, 0.06], s: [1.2, 0.4, 0.7] },
  { g: sph(0.13, 1), c: '#e6c8a4', p: [0.5, 0.2, 0.05] }, ...[-0.3, -0.1, 0.12, 0.3].map((x) => ({ g: cyl(0.025, 0.025, 0.28, 4), c: '#7a5434', p: [x, 0.1, 0.25] as V3, r: [0.9, 0, 0] as V3 })),
]);

// ------------------------------------------------------------------ buildings (local origin = footprint centre on the ground)
function banner(x: number, z: number, h: number, col: string): Part[] {
  return [{ g: cyl(0.03, 0.04, h, 5), c: '#5a3d25', p: [x, h / 2, z] }, { g: box(0.5, 0.28, 0.03), c: col, p: [x + 0.26, h - 0.16, z] }];
}
function logPart(x: number, y: number, z: number, len: number, r: number, rotY = 0): Part {
  return { g: cyl(r, r, len, 7), c: shade('#8a5f38', 0.85 + ((x * 7 + z * 13) % 1 + 1) % 1 * 0.3), p: [x, y, z], r: [0, rotY, Math.PI / 2] };
}
export function buildingParts(kind: BuildingKind, owner: 0 | 1, w: number, h: number): Part[] {
  const team = TEAM[owner], P: Part[] = [];
  const dirt = (rx: number, rz: number) => P.push({ g: cyl(1, 1.04, 0.16, 20), c: '#8a6f49', p: [0, 0.04, 0], s: [rx, 1, rz] });
  switch (kind) {
    case 'hearth': {
      dirt(1.75, 1.75);
      for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283; P.push({ g: rock(0.2), c: shade('#aab0b8', 0.8 + (i % 3) * 0.12), p: [Math.cos(a) * 0.95, 0.14, Math.sin(a) * 0.95], s: [1, 0.8, 1] }); }
      P.push({ g: cyl(0.78, 0.8, 0.1, 14), c: '#2b2622', p: [0, 0.07, 0] });
      for (const a of [0.4, 2.5, 4.6]) P.push({ g: cyl(0.1, 0.1, 0.95, 7), c: '#7a5230', p: [Math.cos(a) * 1.35, 0.12, Math.sin(a) * 1.35], r: [0, -a, Math.PI / 2] });
      for (const sx of [-1, 1]) P.push({ g: cyl(0.04, 0.05, 1.15, 5), c: '#5a3d25', p: [sx * 1.05, 0.55, 0] });
      P.push({ g: cyl(0.03, 0.03, 2.2, 5), c: '#5a3d25', p: [0, 1.1, 0], r: [0, 0, Math.PI / 2] });
      P.push(...banner(-1.35, -1.35, 1.9, team));
      break;
    }
    case 'shelter': {
      dirt(1.2, 1.2);
      P.push({ g: cone(0.98, 1.9, 10), c: '#b98a5a', p: [0, 0.95, 0] });
      P.push({ g: cyl(0.99, 1.02, 0.14, 10), c: '#6a4a2c', p: [0, 0.07, 0] });
      P.push({ g: box(0.42, 0.74, 0.06), c: '#20150e', p: [0, 0.38, 0.78], r: [-0.24, 0, 0] });
      for (const s of [-1, 1]) P.push({ g: cyl(0.025, 0.025, 0.7, 4), c: '#5a3d25', p: [s * 0.1, 2.15, 0], r: [0, 0, s * 0.22] });
      P.push(...banner(0.05, 0, 0.5, team).map((p) => ({ ...p, p: [(p.p ?? [0, 0, 0])[0], (p.p ?? [0, 0, 0])[1] + 2.1, (p.p ?? [0, 0, 0])[2]] as V3 })));
      break;
    }
    case 'stockpile': {
      dirt(1.15, 1.15);
      const rows: [number, number][] = [[4, 0.13], [3, 0.36], [2, 0.59]];
      rows.forEach(([n, y], r) => { for (let i = 0; i < n; i++) P.push(logPart((i - (n - 1) / 2) * 0.27, y, -0.4, 1.15, 0.125)); void r; });
      P.push({ g: box(0.5, 0.42, 0.5), c: '#b89468', p: [0.55, 0.21, 0.5] }, { g: box(0.52, 0.06, 0.52), c: '#7a5a3a', p: [0.55, 0.44, 0.5] });
      P.push({ g: rock(0.2), c: '#9a9ca6', p: [-0.55, 0.15, 0.55] }, { g: rock(0.15), c: '#85878f', p: [-0.2, 0.12, 0.7] });
      break;
    }
    case 'toolshelter': {
      dirt(1.2, 1.1);
      for (const [x, z] of [[-0.85, -0.65], [0.85, -0.65], [-0.85, 0.5], [0.85, 0.5]]) P.push({ g: cyl(0.06, 0.07, z < 0 ? 1.45 : 1.05, 6), c: '#5a3d25', p: [x, z < 0 ? 0.72 : 0.52, z] });
      P.push({ g: box(2.2, 0.1, 1.85), c: '#c9a85a', p: [0, 1.33, -0.08], r: [0.3, 0, 0] });
      P.push({ g: box(2.22, 0.05, 0.1), c: '#8a6a30', p: [0, 1.58, -0.52], r: [0.3, 0, 0] });
      P.push({ g: box(1.1, 0.34, 0.5), c: '#8b8d97', p: [0, 0.17, 0.1] }, { g: box(0.7, 0.1, 0.4), c: '#b0b2bc', p: [0, 0.39, 0.1] });
      P.push({ g: cyl(0.02, 0.02, 0.55, 5), c: '#7a5230', p: [0.25, 0.5, 0.1], r: [0, 0, 1.1] }, { g: box(0.16, 0.1, 0.06), c: '#9a9ca6', p: [0.45, 0.62, 0.1] });
      P.push(...banner(0.95, 0.75, 1.5, team));
      break;
    }
    case 'lodge': {
      dirt(1.8, 1.25);
      P.push({ g: box(2.7, 0.75, 1.5), c: '#7a5a3a', p: [0, 0.38, 0] });
      P.push({ g: cone(1, 1.25, 4), c: '#c9a85a', p: [0, 1.3, 0], r: [0, Math.PI / 4, 0], s: [1.95, 1, 1.28] });
      P.push({ g: box(0.55, 0.62, 0.06), c: '#20150e', p: [0, 0.32, 0.77] });
      for (const s of [-1, 1]) P.push({ g: cyl(0.02, 0.025, 0.55, 4), c: '#e6dcc4', p: [s * 0.2, 0.95, 0.8], r: [0, 0, s * 0.6] });
      P.push(...banner(1.25, 0.8, 1.7, team));
      break;
    }
    case 'circle': {
      dirt(1.7, 1.7);
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283 + 0.3, hh = 1.0 + (i % 4) * 0.18; P.push({ g: box(0.34, hh, 0.26), c: shade('#9a9ca6', 0.8 + (i % 3) * 0.12), p: [Math.cos(a) * 1.3, hh / 2, Math.sin(a) * 1.3], r: [(i % 3 - 1) * 0.05, -a, (i % 2 ? 1 : -1) * 0.06] }); }
      P.push({ g: cyl(0.4, 0.42, 0.08, 10), c: '#2b2622', p: [0, 0.05, 0] });
      for (let i = 0; i < 8; i++) P.push({ g: rock(0.1), c: '#aab0b8', p: [Math.cos(i * 0.8) * 0.42, 0.1, Math.sin(i * 0.8) * 0.42] });
      P.push(...banner(0, -0.7, 2.0, team));
      break;
    }
    case 'rack': {
      dirt(1.05, 1.0);
      for (const sx of [-0.85, 0.85]) for (const s of [-1, 1]) P.push({ g: cyl(0.04, 0.05, 1.7, 5), c: '#5a3d25', p: [sx, 0.8, s * 0.12], r: [s * 0.18, 0, 0] });
      P.push({ g: cyl(0.04, 0.04, 1.9, 5), c: '#6a4526', p: [0, 1.5, 0], r: [0, 0, Math.PI / 2] });
      for (let i = 0; i < 8; i++) P.push({ g: box(0.07, 0.5 - (i % 3) * 0.06, 0.04), c: shade('#8a3a24', 0.8 + (i % 3) * 0.12), p: [-0.77 + i * 0.22, 1.2, 0] });
      P.push({ g: cyl(0.42, 0.45, 0.06, 9), c: '#2b2622', p: [0, 0.05, 0] });
      break;
    }
    case 'watch': {
      dirt(1.1, 1.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push({ g: cyl(0.06, 0.09, 3.0, 6), c: '#6a4526', p: [sx * 0.7, 1.5, sz * 0.7], r: [-sz * 0.05, 0, sx * 0.05] });
      for (const y of [0.9, 1.9]) { for (const s of [-1, 1]) P.push({ g: box(1.4, 0.06, 0.06), c: '#7a5230', p: [0, y, s * 0.7] }, { g: box(0.06, 0.06, 1.4), c: '#7a5230', p: [s * 0.7, y, 0] }); }
      P.push({ g: box(1.75, 0.1, 1.75), c: '#a87a4a', p: [0, 3.0, 0] });
      for (const s of [-1, 1]) P.push({ g: box(1.75, 0.34, 0.05), c: '#8a5f38', p: [0, 3.25, s * 0.85] }, { g: box(0.05, 0.34, 1.75), c: '#8a5f38', p: [s * 0.85, 3.25, 0] });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push({ g: cyl(0.04, 0.04, 0.9, 5), c: '#5a3d25', p: [sx * 0.8, 3.5, sz * 0.8] });
      P.push({ g: cone(1.35, 0.8, 4), c: '#8b6a3a', p: [0, 4.35, 0], r: [0, Math.PI / 4, 0] });
      P.push(...banner(0, 0, 1.0, team).map((p) => ({ ...p, p: [(p.p ?? [0, 0, 0])[0], (p.p ?? [0, 0, 0])[1] + 4.7, (p.p ?? [0, 0, 0])[2]] as V3 })));
      for (let i = 0; i < 5; i++) P.push({ g: box(0.34, 0.04, 0.05), c: '#7a5230', p: [0.0, 0.3 + i * 0.55, 0.82], r: [0.28, 0, 0] });
      break;
    }
    case 'palisade': {
      for (let i = 0; i < 4; i++) {
        const x = -0.36 + i * 0.24, z = ((i * 37) % 5 - 2) * 0.015, hh = 1.35 + (i % 2) * 0.12;
        P.push({ g: cyl(0.11, 0.13, hh, 6), c: shade('#8a5f38', 0.8 + (i % 2) * 0.2), p: [x, hh / 2, z] }, { g: cone(0.11, 0.3, 6), c: '#a87a4a', p: [x, hh + 0.14, z] });
      }
      P.push({ g: box(1.0, 0.05, 0.05), c: '#d6c08a', p: [0, 0.8, 0.12] });
      break;
    }
  }
  void w; void h;
  return P;
}

export interface BuildingModel { group: THREE.Group; flames: THREE.Object3D[]; emitters: THREE.Vector3[]; lightAt?: THREE.Vector3 }
function flame(scale: number, x: number, y: number, z: number): THREE.Object3D {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const o = new THREE.Mesh(cone(0.3 * scale, 0.8 * scale, 7), MAT.flame); o.position.y = 0.4 * scale; g.add(o);
  const c = new THREE.Mesh(cone(0.16 * scale, 0.5 * scale, 6), MAT.flameCore); c.position.y = 0.25 * scale; g.add(c);
  return g;
}
export function buildBuilding(kind: BuildingKind, owner: 0 | 1, w: number, h: number): BuildingModel {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(merge(buildingParts(kind, owner, w, h)), MAT.prop);
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  const m: BuildingModel = { group, flames: [], emitters: [] };
  if (kind === 'hearth') { const f = flame(1.15, 0, 0.1, 0); group.add(f); m.flames.push(f); m.emitters.push(new THREE.Vector3(0, 1.0, 0)); m.lightAt = new THREE.Vector3(0, 1.1, 0); }
  if (kind === 'circle') { const f = flame(0.55, 0, 0.1, 0); group.add(f); m.flames.push(f); m.lightAt = new THREE.Vector3(0, 0.8, 0); }
  if (kind === 'rack') { const f = flame(0.3, 0, 0.06, 0); group.add(f); m.flames.push(f); m.emitters.push(new THREE.Vector3(0, 0.9, 0)); }
  return m;
}

// ------------------------------------------------------------------ people
const SKIN = { human: '#e6bd94', neanderthal: '#d9a888' } as const;
const HAIR = { human: '#46301e', neanderthal: '#2a1c14' } as const;
const TUNIC: Record<string, string> = { gatherer: '#c29a62', scout: '#d8c590', hunter: '#7f9a50', guard: '#92683f', raider: '#5a4644', leader: '#a44a32' };

export interface PersonGeo { body: THREE.BufferGeometry; leg: THREE.BufferGeometry; armR: THREE.BufferGeometry; armL: THREE.BufferGeometry; toolAxe: THREE.BufferGeometry; toolPick: THREE.BufferGeometry; toolHammer: THREE.BufferGeometry; torch: THREE.BufferGeometry }
const personCache = new Map<string, PersonGeo>();
export function personGeo(kind: UnitKind, species: 'human' | 'neanderthal', owner: 0 | 1, gen: number): PersonGeo {
  const key = `${kind}${species}${owner}${gen >= 2 ? 2 : 1}`;
  const hit = personCache.get(key); if (hit) return hit;
  const neo = species === 'neanderthal';
  const team = owner === 0 ? (gen >= 2 ? '#38d39c' : '#27b7c6') : '#d84a36';
  const skin = SKIN[species], hair = HAIR[species], tun = TUNIC[kind] ?? TUNIC.gatherer;
  const body: Part[] = [
    { g: box(0.38, 0.42, 0.25), c: tun, p: [0, 0.55, 0] }, { g: box(0.4, 0.06, 0.27), c: '#3a2a1c', p: [0, 0.4, 0] },
    { g: box(0.08, 0.44, 0.02), c: team, p: [0.02, 0.55, 0.135], r: [0, 0, 0.55] },
    { g: sph(neo ? 0.165 : 0.15, 1), c: skin, p: [0, 0.9, 0.01], s: neo ? [1.1, 1, 1.1] : [1, 1, 1] },
    { g: sph(neo ? 0.175 : 0.16, 1), c: hair, p: [0, 0.95, -0.03], s: [1, 0.85, 1] },
    { g: cyl(0.165, 0.165, 0.05, 10), c: team, p: [0, 0.93, 0] },
    { g: sph(0.022, 0), c: '#1a1210', p: [0.06, 0.9, 0.14] }, { g: sph(0.022, 0), c: '#1a1210', p: [-0.06, 0.9, 0.14] },
  ];
  if (neo) body.push({ g: box(0.22, 0.035, 0.06), c: '#3a2418', p: [0, 0.94, 0.14] });
  if (kind === 'guard') body.push({ g: cyl(0.27, 0.3, 0.1, 8), c: '#d8cfc0', p: [0, 0.74, 0] });
  if (kind === 'raider') body.push({ g: box(0.22, 0.04, 0.03), c: '#c23a2a', p: [0, 0.88, 0.15] }, { g: cyl(0.27, 0.3, 0.09, 8), c: '#2a2a30', p: [0, 0.74, 0] });
  if (kind === 'hunter') body.push({ g: cyl(0.05, 0.06, 0.4, 6), c: '#6a4526', p: [-0.1, 0.62, -0.17], r: [0.2, 0, 0.15] }, { g: cone(0.04, 0.1, 4), c: '#e6dcc4', p: [-0.13, 0.86, -0.2] });
  if (kind === 'scout') body.push({ g: cyl(0.015, 0.015, 0.28, 4), c: '#e8d8a0', p: [-0.1, 1.05, -0.02], r: [0, 0, 0.5] });
  if (kind === 'leader') {
    body.push({ g: box(0.4, 0.62, 0.03), c: team, p: [0, 0.5, -0.15], r: [0.12, 0, 0] });
    [[-0.07, '#f0ead0'], [0, '#c23a2a'], [0.07, '#f0ead0']].forEach(([x, col], i) => body.push({ g: cone(0.025, 0.28, 4), c: col as string, p: [x as number, 1.15 + (i === 1 ? 0.04 : 0), -0.02], r: [0, 0, (x as number) * 3] }));
  }
  const leg = merge([{ g: box(0.13, 0.36, 0.14), c: '#4a3a2a', p: [0, -0.18, 0] }, { g: box(0.14, 0.06, 0.2), c: '#33271c', p: [0, -0.35, 0.03] }]);
  const arm: Part[] = [{ g: box(0.09, 0.3, 0.09), c: skin, p: [0, -0.15, 0] }, { g: sph(0.05, 0), c: skin, p: [0, -0.31, 0] }];
  const armR: Part[] = [...arm];
  if (kind === 'guard' || kind === 'leader') armR.push({ g: cyl(0.022, 0.022, 1.55, 5), c: '#8b6a40', p: [0, 0.3, 0.1] }, { g: cone(0.045, 0.2, 5), c: '#c7c9d0', p: [0, 1.16, 0.1] });
  if (kind === 'hunter') armR.push({ g: new THREE.TorusGeometry(0.4, 0.016, 4, 12, Math.PI), c: '#6a4526', p: [0, -0.28, 0.14], r: [0, Math.PI / 2, -Math.PI / 2] }, { g: cyl(0.004, 0.004, 0.8, 3), c: '#eee', p: [0, -0.28, 0.14] });
  if (kind === 'raider') armR.push({ g: cyl(0.025, 0.025, 0.6, 5), c: '#6a4526', p: [0, -0.1, 0.12], r: [0.3, 0, 0] }, { g: rock(0.14), c: '#80828c', p: [0, 0.2, 0.2], s: [0.8, 1.2, 0.8] });
  if (kind === 'scout') armR.push({ g: cyl(0.018, 0.018, 1.35, 4), c: '#a78858', p: [0, 0.15, 0.08] });
  const armL: Part[] = [...arm];
  if (kind === 'guard') armL.push({ g: cyl(0.27, 0.27, 0.05, 12), c: team, p: [-0.1, -0.15, 0.1], r: [0, 0, Math.PI / 2] }, { g: cyl(0.1, 0.1, 0.07, 8), c: '#e8dcc0', p: [-0.12, -0.15, 0.1], r: [0, 0, Math.PI / 2] });
  const g: PersonGeo = {
    body: merge(body), leg, armR: merge(armR), armL: merge(armL),
    toolAxe: merge([{ g: cyl(0.02, 0.02, 0.6, 5), c: '#7a5230', p: [0, -0.1, 0.12] }, { g: box(0.05, 0.14, 0.2), c: '#a5a7b0', p: [0, 0.2, 0.17] }]),
    toolPick: merge([{ g: cyl(0.02, 0.02, 0.6, 5), c: '#7a5230', p: [0, -0.1, 0.12] }, { g: box(0.05, 0.06, 0.4), c: '#8b8d97', p: [0, 0.2, 0.12] }]),
    toolHammer: merge([{ g: cyl(0.02, 0.02, 0.45, 5), c: '#7a5230', p: [0, -0.05, 0.1] }, { g: box(0.1, 0.1, 0.22), c: '#8b8d97', p: [0, 0.18, 0.1] }]),
    torch: merge([{ g: cyl(0.02, 0.03, 0.55, 5), c: '#6a4526', p: [0, 0, 0] }]),
  };
  personCache.set(key, g);
  return g;
}

export interface AnimalGeo { body: THREE.BufferGeometry; legF: THREE.BufferGeometry; legB: THREE.BufferGeometry }
const animalCache = new Map<string, AnimalGeo>();
export function animalGeo(kind: 'deer' | 'wolf', variant: number): AnimalGeo {
  const key = `${kind}${variant}`; const hit = animalCache.get(key); if (hit) return hit;
  let g: AnimalGeo;
  if (kind === 'deer') {
    const col = '#b98a58', b: Part[] = [
      { g: sph(0.5, 1), c: col, p: [0, 0.68, 0], s: [0.46, 0.46, 1.0] }, { g: sph(0.4, 1), c: '#e6cfa8', p: [0, 0.56, 0], s: [0.38, 0.3, 0.9] },
      { g: cyl(0.1, 0.14, 0.55, 6), c: col, p: [0, 1.0, 0.45], r: [0.5, 0, 0] }, { g: sph(0.14, 1), c: col, p: [0, 1.28, 0.62], s: [0.9, 0.9, 1.4] },
      { g: sph(0.04, 0), c: '#2a1c10', p: [0.07, 1.3, 0.72] }, { g: sph(0.04, 0), c: '#2a1c10', p: [-0.07, 1.3, 0.72] },
      { g: cone(0.05, 0.16, 4), c: '#9a6b45', p: [0.1, 1.42, 0.55], r: [0, 0, -0.4] }, { g: cone(0.05, 0.16, 4), c: '#9a6b45', p: [-0.1, 1.42, 0.55], r: [0, 0, 0.4] },
      { g: sph(0.07, 0), c: '#ffffff', p: [0, 0.8, -0.5] },
    ];
    for (let i = 0; i < 7; i++) b.push({ g: sph(0.025, 0), c: '#ffffff', p: [((i * 53) % 9 - 4) * 0.04, 0.95, ((i * 31) % 11 - 5) * 0.1] });
    if (variant % 2 === 0) for (const s of [-1, 1]) b.push({ g: cyl(0.015, 0.02, 0.45, 4), c: '#d9c8a2', p: [s * 0.12, 1.6, 0.52], r: [0.1, 0, -s * 0.3] }, { g: cyl(0.012, 0.015, 0.25, 4), c: '#d9c8a2', p: [s * 0.2, 1.72, 0.5], r: [0.3, 0, s * 0.5] });
    const leg = (z: number) => merge([-1, 1].map((s) => ({ g: cyl(0.035, 0.05, 0.6, 5), c: '#7a5434', p: [s * 0.14, -0.3, z] as V3 })));
    g = { body: merge(b), legF: leg(0.4), legB: leg(-0.4) };
  } else {
    const b: Part[] = [
      { g: sph(0.5, 1), c: '#7d818c', p: [0, 0.55, 0], s: [0.4, 0.4, 0.95] }, { g: sph(0.3, 1), c: '#9a9eaa', p: [0, 0.5, 0.4], s: [0.9, 0.9, 1] },
      { g: sph(0.2, 1), c: '#8a8e9a', p: [0, 0.68, 0.72], s: [0.9, 0.85, 1.2] }, { g: box(0.13, 0.12, 0.3), c: '#6c707c', p: [0, 0.62, 0.95] }, { g: sph(0.035, 0), c: '#16171c', p: [0, 0.65, 1.1] },
      { g: sph(0.03, 0), c: '#ffd23a', p: [0.08, 0.74, 0.82] }, { g: sph(0.03, 0), c: '#ffd23a', p: [-0.08, 0.74, 0.82] },
      { g: cone(0.06, 0.18, 4), c: '#3a3d48', p: [0.1, 0.9, 0.66] }, { g: cone(0.06, 0.18, 4), c: '#3a3d48', p: [-0.1, 0.9, 0.66] },
      { g: cyl(0.04, 0.08, 0.6, 5), c: '#6c707c', p: [0, 0.6, -0.6], r: [-1.1, 0, 0] },
    ];
    const leg = (z: number) => merge([-1, 1].map((s) => ({ g: cyl(0.04, 0.055, 0.5, 5), c: '#4a4d58', p: [s * 0.13, -0.25, z] as V3 })));
    g = { body: merge(b), legF: leg(0.38), legB: leg(-0.36) };
  }
  animalCache.set(key, g);
  return g;
}

export function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
