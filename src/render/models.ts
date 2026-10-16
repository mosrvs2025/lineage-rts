/** Low-poly 3D models built from Blender-sculpted meshes and primitives, plus the materials/shader patches they share. */
import * as THREE from 'three';
import { SPECIES } from '../data/species';
import type { Species } from '../sim/types';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingKind, UnitKind } from '../sim/types';
import { blenderGeo } from './blenderMeshes';

// ------------------------------------------------------------------ shared shader state (fog of war, snow, wind)
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;
export const shared = {
  fogMap: { value: blank as THREE.Texture },
  mapSize: { value: new THREE.Vector2(72, 48) },
  snow: { value: 0 },
  time: { value: 0 },
  wear: { value: blank as THREE.Texture },
  cloud: { value: 0.8 },
};

/** Patch a standard material: fog-of-war darkening, winter snow on upward faces, optional wind sway on instanced meshes. */
export function enhance<T extends THREE.MeshStandardMaterial>(m: T, o: { sway?: boolean | number; snow?: number; wear?: boolean } = {}): T {
  const amp = typeof o.sway === 'number' ? o.sway : 1;
  const snow = o.snow ?? 0;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFogMap = shared.fogMap; sh.uniforms.uMapSize = shared.mapSize; sh.uniforms.uSnow = shared.snow; sh.uniforms.uTime = shared.time; sh.uniforms.uWear = shared.wear; sh.uniforms.uCloud = shared.cloud;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;\nvarying float vWNy;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${o.sway ? `#ifdef USE_INSTANCING
        float sw = sin(uTime * 1.4 + instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.6) * 0.04;
        transformed.x += sw * max(transformed.y, 0.0) * max(transformed.y, 0.0) * 0.45 * ${amp.toFixed(2)};
        transformed.z += sw * 0.6 * max(transformed.y, 0.0) * max(transformed.y, 0.0) * 0.45 * ${amp.toFixed(2)};
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
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;\nvarying float vWNy;\nuniform sampler2D uFogMap;\nuniform vec2 uMapSize;\nuniform float uSnow;\nuniform float uTime;\nuniform sampler2D uWear;\nuniform float uCloud;\nfloat fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float notBlue = step(diffuseColor.b, diffuseColor.g * 1.25 + 0.04);
        ${o.wear ? `float wv = texture2D(uWear, vFogWorld.xz / uMapSize).r;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + vec3(0.2, 0.15, 0.09), smoothstep(0.05, 0.5, wv) * 0.9);` : ''}
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), uSnow * smoothstep(0.35, 0.85, vWNy) * notBlue * ${snow.toFixed(2)});`)
      .replace('#include <dithering_fragment>', `vec2 cq = vFogWorld.xz * 0.055 + vec2(uTime * 0.035, uTime * 0.014);
        float cs = smoothstep(0.52, 0.78, fn(cq) * 0.65 + fn(cq * 2.4 + 3.0) * 0.35);
        gl_FragColor.rgb *= 1.0 - cs * 0.42 * uCloud;
        float fa = texture2D(uFogMap, vFogWorld.xz / uMapSize).a;
        if (fa > 0.001) {
          vec2 q = vFogWorld.xz * 0.28 + vec2(uTime * 0.045, uTime * 0.02);
          float cl = fn(q) * 0.55 + fn(q * 2.1 + 5.0) * 0.3 + fn(q * 4.3 - uTime * 0.05) * 0.15;
          float deep = smoothstep(0.55, 1.0, fa);
          vec3 mist = mix(vec3(0.05, 0.07, 0.12), vec3(0.30, 0.37, 0.48), cl);
          vec3 fc = mix(vec3(0.025, 0.035, 0.06), mist, 0.85 * (1.0 - deep * 0.35) * smoothstep(0.1, 0.9, cl + 0.25));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fa);
        }
        #include <dithering_fragment>`);
  };
  m.customProgramCacheKey = () => `enh${o.sway ? amp : 0}${snow}${o.wear ? 'w' : ''}`;
  return m;
}

/** Soft radial contact shadow shared by trees, buildings and units. */
const blobTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  if (!g) return null;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
})();
export const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

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
export function buildingParts(kind: BuildingKind, owner: 0 | 1, w: number, h: number, tier = 0): Part[] {
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
    case 'field': {
      P.push({ g: box(1.88, 0.08, 1.88), c: '#4e3924', p: [0, 0.04, 0] });
      for (let r = 0; r < 4; r++) {
        const z = -0.66 + r * 0.44;
        P.push({ g: box(1.66, 0.09, 0.22), c: shade('#5c432a', 0.9 + (r % 2) * 0.12), p: [0, 0.09, z] });
        for (let c = 0; c < 6; c++) {
          const x = -0.65 + c * 0.26, h1 = 0.34 + ((r + c) % 3) * 0.08;
          P.push(
            { g: cyl(0.02, 0.03, h1, 5), c: '#6a9e3a', p: [x, 0.12 + h1 / 2, z] },
            { g: sph(0.065, 0), c: (r + c) % 2 ? '#d8b44a' : '#82b446', p: [x, 0.14 + h1, z], s: [0.8, 1.4, 0.8] },
          );
        }
      }
      for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) P.push({ g: cyl(0.035, 0.04, 0.42, 5), c: '#6a4a2c', p: [sx, 0.21, sz] });
      P.push(...banner(0.88, -0.88, 1.15, team));
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
  if (tier > 0) tierParts(kind, tier, team, P);
  void w; void h;
  return P;
}

/** Extra geometry that makes upgraded buildings visibly grander. */
function tierParts(kind: BuildingKind, tier: number, team: string, P: Part[]) {
  const post = (x: number, z: number, hh: number, r = 0.07): Part => ({ g: cyl(r, r * 1.2, hh, 6), c: '#5a3d25', p: [x, hh / 2, z] });
  switch (kind) {
    case 'hearth': {
      for (let i = 0; i < 18; i++) { const a = (i / 18) * 6.283; P.push({ g: rock(0.26), c: shade('#b4b8c0', 0.8 + (i % 3) * 0.1), p: [Math.cos(a) * 1.55, 0.2, Math.sin(a) * 1.55], s: [1, 0.9, 1] }); }
      // Blender-sculpted ancestral spirit totem
      P.push({ g: blenderGeo('totem_hearth'), c: '#7a5230', p: [1.75, 0, 0.6] });
      [[0.5, '#c23a2a'], [1.0, '#e8dcc0'], [1.5, '#2a2a30'], [2.0, team]].forEach(([y, c]) => P.push({ g: box(0.36, 0.24, 0.34), c: c as string, p: [1.75, y as number, 0.6] }, { g: cone(0.08, 0.2, 4), c: '#d8c890', p: [1.75, (y as number) + 0.02, 0.8], r: [Math.PI / 2, 0, 0] }));
      P.push({ g: cone(0.3, 0.5, 4), c: '#c23a2a', p: [1.75, 2.85, 0.6], r: [0, Math.PI / 4, 0] });
      if (tier > 1) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(post(sx * 1.25, sz * 1.25, 2.7, 0.1));
        P.push({ g: cone(1, 0.8, 4), c: '#b98a5a', p: [0, 3.1, 0], r: [0, Math.PI / 4, 0], s: [1.6, 1, 1.6] });
        for (const s of [-1, 1]) P.push({ g: cone(0.05, 0.6, 4), c: '#e8dcc0', p: [s * 0.45, 3.75, 0], r: [0, 0, s * 0.5] });
        P.push({ g: box(2.6, 0.12, 0.12), c: '#7a5230', p: [0, 2.7, 1.25] }, { g: box(2.6, 0.12, 0.12), c: '#7a5230', p: [0, 2.7, -1.25] });
        [[-0.9, '#c23a2a'], [0, team], [0.9, '#c23a2a']].forEach(([x, c]) => P.push({ g: box(0.4, 0.8, 0.04), c: c as string, p: [x as number, 2.2, 1.25] }));
      }
      break;
    }
    case 'shelter': {
      P.push({ g: box(1.7, 0.7, 1.15), c: '#7a5a3a', p: [1.2, 0.35, 0.1] }, { g: cone(1, 0.95, 4), c: '#b98a5a', p: [1.2, 1.15, 0.1], r: [0, Math.PI / 4, 0], s: [1.35, 1, 0.95] });
      P.push({ g: box(0.4, 0.55, 0.05), c: '#20150e', p: [1.2, 0.28, 0.7] });
      for (let i = 0; i < 6; i++) { const a = i * 1.05; P.push({ g: rock(0.2), c: '#9a9ca6', p: [Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0] }); }
      break;
    }
    case 'stockpile': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.push(post(sx * 0.95, sz * 0.95, 1.5, 0.06));
      P.push({ g: box(2.3, 0.1, 2.3), c: '#c9a85a', p: [0, 1.55, 0], r: [0.15, 0, 0] }, { g: box(2.3, 0.07, 0.1), c: '#8a6a30', p: [0, 1.75, -0.2], r: [0.15, 0, 0] });
      P.push({ g: cyl(0.28, 0.26, 0.5, 9), c: '#9a6f44', p: [-0.55, 0.25, 0.85] }, { g: cyl(0.28, 0.26, 0.5, 9), c: '#8a5f38', p: [0.0, 0.25, 0.9] });
      break;
    }
    case 'toolshelter': {
      P.push({ g: box(0.8, 0.5, 0.5), c: '#7a7c86', p: [-0.7, 0.25, 0.9] }, { g: box(0.5, 0.12, 0.34), c: '#b0b2bc', p: [-0.7, 0.55, 0.9] });
      for (let i = 0; i < 5; i++) P.push({ g: cyl(0.02, 0.02, 0.7, 4), c: '#a78858', p: [0.4 + i * 0.1, 0.4, 0.95], r: [0.2, 0, 0.1] }, { g: cone(0.04, 0.12, 4), c: '#d8d8e0', p: [0.45 + i * 0.1, 0.78, 1.0], r: [0.2, 0, 0.1] });
      if (tier > 1) { for (const s of [-1, 1]) P.push(post(s * 0.5, -0.9, 1.9, 0.06)); P.push({ g: box(1.3, 0.1, 0.1), c: '#7a5230', p: [0, 1.9, -0.9] }, { g: cone(0.08, 0.4, 5), c: '#c23a2a', p: [0, 2.15, -0.9] }); }
      break;
    }
    case 'lodge': {
      for (const s of [-1, 1]) {
        P.push({ g: cone(0.06, 1.1, 5), c: '#e8dcc0', p: [s * 0.55, 1.6, 0.85], r: [0.3, 0, s * -0.5] });
        P.push({ g: cyl(0.05, 0.06, 1.4, 5), c: '#5a3d25', p: [s * 1.5, 0.7, 1.0] }, { g: sph(0.16, 0), c: '#ece8dc', p: [s * 1.5, 1.5, 1.0] });
        P.push({ g: box(0.5, 0.9, 0.04), c: '#c23a2a', p: [s * 1.1, 1.15, 0.82] });
      }
      for (let i = 0; i < 7; i++) P.push({ g: cone(0.07, 0.62, 5), c: '#a87a4a', p: [-1.2 + i * 0.4, 0.3, 1.25] });
      break;
    }
    case 'circle': {
      P.push(post(-0.35, 0, 2.3, 0.2), post(0.35, 0, 2.3, 0.2), { g: box(1.2, 0.3, 0.45), c: '#a2a4ae', p: [0, 2.4, 0] });
      for (let i = 0; i < 4; i++) P.push({ g: box(0.04, 0.02, 0.2), c: '#c23a2a', p: [-0.15 + (i % 2) * 0.3, 0.8 + i * 0.28, 0.2] });
      break;
    }
    case 'rack': {
      P.push({ g: box(2.1, 1.1, 1.1), c: '#5a4030', p: [0, 0.55, 0.0] }, { g: cone(1, 0.7, 4), c: '#8b6a3a', p: [0, 1.45, 0], r: [0, Math.PI / 4, 0], s: [1.55, 1, 0.9] });
      P.push({ g: cyl(0.12, 0.14, 0.8, 6), c: '#4a4a52', p: [0.6, 1.7, 0.1] }, { g: box(0.5, 0.7, 0.05), c: '#20150e', p: [0, 0.35, 0.56] });
      break;
    }
    case 'field': {
      for (const s of [-1, 1]) P.push({ g: box(1.96, 0.18, 0.1), c: '#9a9ca6', p: [0, 0.09, s * 0.93] }, { g: box(0.1, 0.18, 1.96), c: '#9a9ca6', p: [s * 0.93, 0.09, 0] });
      P.push({ g: box(1.72, 0.06, 0.14), c: '#3a86b8', p: [0, 0.11, 0] });
      break;
    }
    case 'watch': {
      for (const s of [-1, 1]) P.push({ g: box(1.8, 0.62, 0.07), c: '#9a6f44', p: [0, 3.35, s * 0.9] }, { g: box(0.07, 0.62, 1.8), c: '#9a6f44', p: [s * 0.9, 3.35, 0] });
      for (let i = 0; i < 6; i++) P.push({ g: cone(0.06, 0.28, 5), c: '#d6c08a', p: [-0.8 + i * 0.32, 3.8, 0.9] });
      P.push({ g: box(0.5, 0.9, 0.04), c: '#c23a2a', p: [0, 2.4, 0.95] });
      if (tier > 1) {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; P.push({ g: rock(0.3), c: shade('#9a9ca6', 0.8 + (i % 3) * 0.1), p: [Math.cos(a) * 1.15, 0.2, Math.sin(a) * 1.15] }); }
        P.push({ g: box(0.6, 0.06, 0.6), c: '#2b2622', p: [0.7, 3.12, 0.7] });
      }
      break;
    }
    case 'palisade': {
      for (let i = 0; i < 4; i++) P.push({ g: cone(0.05, 0.35, 5), c: '#d6c08a', p: [-0.36 + i * 0.24, 1.78, 0] });
      P.push({ g: box(1.0, 0.07, 0.07), c: '#d6c08a', p: [0, 1.1, 0.13] });
      break;
    }
    default: break;
  }
}

export interface BuildingModel { group: THREE.Group; flames: THREE.Object3D[]; emitters: THREE.Vector3[]; lightAt?: THREE.Vector3 }
function flame(scale: number, x: number, y: number, z: number): THREE.Object3D {
  const g = new THREE.Group(); g.position.set(x, y, z);
  const o = new THREE.Mesh(cone(0.3 * scale, 0.8 * scale, 7), MAT.flame); o.position.y = 0.4 * scale; g.add(o);
  const c = new THREE.Mesh(cone(0.16 * scale, 0.5 * scale, 6), MAT.flameCore); c.position.y = 0.25 * scale; g.add(c);
  return g;
}
export function buildBuilding(kind: BuildingKind, owner: 0 | 1, w: number, h: number, tier = 0): BuildingModel {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(merge(buildingParts(kind, owner, w, h, tier)), MAT.prop);
  mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  const m: BuildingModel = { group, flames: [], emitters: [] };
  if (kind === 'hearth') { const f = flame(1.15, 0, 0.1, 0); group.add(f); m.flames.push(f); m.emitters.push(new THREE.Vector3(0, 1.0, 0)); m.lightAt = new THREE.Vector3(0, 1.1, 0); }
  if (kind === 'circle') { const f = flame(0.55, 0, 0.1, 0); group.add(f); m.flames.push(f); m.lightAt = new THREE.Vector3(0, 0.8, 0); }
  if (kind === 'watch' && tier > 1) { const f = flame(0.45, 0.7, 3.12, 0.7); group.add(f); m.flames.push(f); m.lightAt = new THREE.Vector3(0.7, 3.5, 0.7); }
  if (kind === 'hearth' && tier > 0) { const f = flame(0.5, 1.75, 2.9, 0.6); group.add(f); m.flames.push(f); }
  if (kind === 'rack') { const f = flame(0.3, 0, 0.06, 0); group.add(f); m.flames.push(f); m.emitters.push(new THREE.Vector3(0, 0.9, 0)); }
  return m;
}

// ------------------------------------------------------------------ people (skinned, one draw call per person)
const TUNIC: Record<string, string[]> = {
  gatherer: ['#c29a62', '#b58a56', '#a8845a', '#c9a76e'], stalker: ['#5a6a4a', '#4e5e40', '#667454', '#485638'], scout: ['#d8c590', '#cdb97e', '#bda875', '#d9cb9c'], hunter: ['#7f9a50', '#6f8a46', '#8aa05a', '#6b7f48'],
  guard: ['#92683f', '#85603a', '#9a7048', '#7a5634'], raider: ['#5a4644', '#4a3a38', '#64504c', '#3e3030'], leader: ['#a44a32', '#9a3f2c', '#b0553a', '#8e3a28'],
  elder: ['#e4dccb', '#d8d0bc', '#ece5d4', '#cfc6b0'], slinger: ['#6c8a58', '#5f7d4e', '#7a9462', '#557244'],
  brute: ['#5a4634', '#4d3b2c', '#664f3a', '#43342a'], champion: ['#8e2f26', '#7f2820', '#9c372c', '#6e231c'],
};

/** Bone rest positions in model space (feet at y=0, facing +z). */
export const BONES: [string, string | null, number, number, number][] = [
  ['root', null, 0, 0, 0], ['hips', 'root', 0, 0.46, 0], ['spine', 'hips', 0, 0.54, 0], ['head', 'spine', 0, 0.84, 0],
  ['shL', 'spine', -0.21, 0.76, 0], ['elL', 'shL', -0.21, 0.52, 0], ['handL', 'elL', -0.21, 0.3, 0],
  ['shR', 'spine', 0.21, 0.76, 0], ['elR', 'shR', 0.21, 0.52, 0], ['handR', 'elR', 0.21, 0.3, 0],
  ['hipL', 'hips', -0.1, 0.44, 0], ['kneeL', 'hipL', -0.1, 0.22, 0], ['hipR', 'hips', 0.1, 0.44, 0], ['kneeR', 'hipR', 0.1, 0.22, 0],
];
const BONE_IDX: Record<string, number> = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

export function makeSkeleton() {
  const bones = BONES.map(([name]) => { const b = new THREE.Bone(); b.name = name; return b; });
  BONES.forEach(([, parent, x, y, z], i) => {
    if (!parent) { bones[i].position.set(x, y, z); return; }
    const pi = BONE_IDX[parent], pp = BONES[pi];
    bones[i].position.set(x - pp[2], y - pp[3], z - pp[4]); bones[pi].add(bones[i]);
  });
  bones[0].updateMatrixWorld(true);
  return { bones, skeleton: new THREE.Skeleton(bones) };
}

interface SPart extends Part { b: string }
function mergeSkinned(parts: SPart[]): THREE.BufferGeometry {
  const list = parts.map((pt) => {
    const g = pt.g.index ? pt.g.toNonIndexed() : pt.g.clone();
    tmp.position.set(...(pt.p ?? [0, 0, 0])); tmp.rotation.set(...(pt.r ?? [0, 0, 0])); tmp.scale.set(...(pt.s ?? [1, 1, 1])); tmp.updateMatrix();
    g.applyMatrix4(tmp.matrix);
    const col = new THREE.Color(pt.c as THREE.ColorRepresentation), n = g.attributes.position.count, arr = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const bi = BONE_IDX[pt.b] ?? 0;
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; si[i * 4] = bi; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.deleteAttribute('uv');
    return g;
  });
  return mergeGeometries(list, false)!;
}

export interface PersonGeo { body: THREE.BufferGeometry; toolAxe: THREE.BufferGeometry; toolPick: THREE.BufferGeometry; toolHammer: THREE.BufferGeometry; torch: THREE.BufferGeometry; bow: THREE.BufferGeometry; spear: THREE.BufferGeometry }
const personCache = new Map<string, PersonGeo>();
export function personGeo(kind: UnitKind, species: Species, owner: 0 | 1, gen: number, variant = 0, customBanner?: string): PersonGeo {
  const v = variant & 3, bCol = owner === 0 && customBanner ? customBanner : '';
  const key = `${kind}${species}${owner}${gen >= 3 ? 3 : gen >= 2 ? 2 : 1}${v}${bCol}`;
  const hit = personCache.get(key); if (hit) return hit;
  const sd = SPECIES[species], neo = sd.heavyBrow, deni = species === 'denisovan';
  const team = owner === 0 ? (bCol || (gen >= 3 ? '#e8bd63' : gen >= 2 ? '#38d39c' : '#27b7c6')) : '#d84a36';
  const skin = sd.skin[v % 3], hair = sd.hair[v], tun = (TUNIC[kind] ?? TUNIC.gatherer)[v];
  const P: SPart[] = [];
  const add = (b: string, g: THREE.BufferGeometry, c: string, p?: V3, r?: V3, s?: V3) => P.push({ b, g, c, p, r, s });
  const bw = species === 'neanderthal' ? 1.12 : deni ? 1.06 : 1;

  // Blender-sculpted anatomical torso + tunic + belt + fur trim
  const torsoKey = species === 'neanderthal' ? 'torso_neanderthal' : deni ? 'torso_denisovan' : 'torso_human';
  add('spine', blenderGeo(torsoKey), tun);
  add('hips', cyl(0.165 * bw, 0.185 * bw, 0.11, 10), '#3a2a1c', [0, 0.48, 0]);                    // leather belt
  add('hips', sph(0.036, 0), '#e8bd63', [0, 0.48, 0.115 * bw], undefined, [1.2, 0.8, 0.6]);         // bronze/gold belt clasp
  add('spine', box(0.08, 0.44, 0.025), team, [0.03, 0.66, 0.135 * bw], [0, 0, 0.48]);               // clan sash
  add('spine', cyl(0.21 * bw, 0.22 * bw, 0.08, 10), shade(tun, 0.78) as unknown as string, [0, 0.81, 0]); // shoulder mantle collar

  // Tapered anatomical legs, calves, leg wraps & boots
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? 'L' : 'R';
    add(`hip${side}`, cyl(0.072 * bw, 0.058 * bw, 0.23, 8), shade('#6a4a30', 0.9) as unknown as string, [sx * 0.1, 0.33, 0]);
    add(`knee${side}`, cyl(0.056 * bw, 0.046 * bw, 0.20, 8), '#5a3e28', [sx * 0.1, 0.125, 0]);
    add(`knee${side}`, box(0.115 * bw, 0.055, 0.195), '#2e2218', [sx * 0.1, 0.026, 0.035]);
    add(`knee${side}`, cyl(0.062 * bw, 0.058 * bw, 0.035, 8), '#d4c3a2', [sx * 0.1, 0.205, 0]);      // hide leg wrap
  }

  // Blender-sculpted cranium with species brow ridge, cheekbones, jaw & expressive eyes
  const headKey = species === 'neanderthal' ? 'head_neanderthal' : deni ? 'head_denisovan' : 'head_human';
  const hr = species === 'neanderthal' ? 0.17 : deni ? 0.162 : 0.155;
  add('head', blenderGeo(headKey), skin);
  add('head', sph(hr * 1.06, 1), hair, [0, 0.965, -0.03], undefined, [1.02, 0.88, 1.04]);           // hair crown
  for (const sx of [-1, 1]) {
    add('head', cone(0.038, 0.22, 5), hair, [sx * 0.135, 0.84, -0.02], [0.1, 0, sx * 0.12]);        // braided side locks
    add('head', sph(0.028, 0), '#f4efe6', [sx * 0.064, 0.926, 0.142], undefined, [1.1, 0.8, 0.7]);  // sclera
    add('head', sph(0.019, 0), '#16100c', [sx * 0.063, 0.926, 0.154]);                              // pupil/iris
    add('head', box(0.055, 0.018, 0.02), hair, [sx * 0.064, 0.955, 0.152], [0, 0, sx * -0.1]);      // eyebrow
    add('head', sph(0.032, 0), skin, [sx * 0.155, 0.92, 0], undefined, [0.45, 0.85, 0.7]);          // ear
  }
  if (v === 2 || kind === 'leader') add('head', cone(0.065, 0.26, 6), hair, [0, 0.84, -0.15], [0.2, 0, 0]);
  add('head', cyl(hr * 1.03, hr * 1.04, 0.048, 12), team, [0, 0.955, 0.005]);                       // clan headband
  if (neo) {
    add('head', sph(0.11, 1), '#3a2418', [0, 0.825, 0.105], undefined, [1.15, 0.85, 0.95]);         // full beard
    add('head', cone(0.085, 0.16, 5), '#3a2418', [0, 0.75, 0.12], [Math.PI - 0.15, 0, 0]);
  } else if (v === 1) {
    add('head', sph(0.09, 1), hair, [0, 0.83, 0.11], undefined, [1.1, 0.65, 0.85]);
  }
  if (deni) {
    for (const sx of [-1, 1]) add('head', box(0.032, 0.018, 0.02), '#d84e28', [sx * 0.09, 0.895, 0.148], [0, sx * 0.2, 0]); // ochre cheek paint
    add('head', box(0.16, 0.022, 0.022), '#ede2c8', [0, 0.98, 0.155]);                                                      // carved bone brow-bar
    for (let i = 0; i < 5; i++) add('spine', cone(0.016, 0.055, 4), i % 2 ? '#ede2c8' : '#d84e28', [-0.08 + i * 0.04, 0.78 - Math.abs(i - 2) * 0.012, 0.145], [Math.PI - 0.3, 0, 0]); // tooth & ochre necklace
  }

  // Tapered anatomical arms, deltoids & hands
  const armCol = tun, hand = skin;
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? 'L' : 'R';
    add(`sh${side}`, sph(0.078 * bw, 1), shade(tun, 0.86) as unknown as string, [sx * 0.21, 0.765, 0], undefined, [1.05, 0.95, 1.0]);
    add(`sh${side}`, cyl(0.056 * bw, 0.046 * bw, 0.24, 7), armCol, [sx * 0.21, 0.64, 0]);
    add(`el${side}`, cyl(0.046 * bw, 0.038 * bw, 0.22, 7), skin, [sx * 0.21, 0.41, 0]);
    add(`el${side}`, cyl(0.044 * bw, 0.042 * bw, 0.05, 7), '#4a3520', [sx * 0.21, 0.35, 0]);        // leather bracer
    add(`el${side}`, sph(0.052, 0), hand, [sx * 0.21, 0.29, 0]);
  }

  // Role-specific regalia & armor
  if (kind === 'guard') {
    add('spine', cyl(0.22, 0.25, 0.14, 10), '#d8cfc0', [0, 0.78, 0]);
    add('spine', box(0.12, 0.12, 0.03), '#a89a84', [0, 0.71, 0.145]);
    add('elL', cyl(0.28, 0.28, 0.045, 14), team, [-0.34, 0.45, 0.1], [0, 0, Math.PI / 2]);          // painted round shield
    add('elL', cyl(0.29, 0.29, 0.03, 14), '#6a4a2c', [-0.335, 0.45, 0.1], [0, 0, Math.PI / 2]);     // shield rim
    add('elL', sph(0.085, 0), '#e8bd63', [-0.365, 0.45, 0.1], undefined, [0.5, 1, 1]);              // shield boss
  }
  if (kind === 'elder') {
    add('hips', cyl(0.18, 0.29, 0.48, 10), tun, [0, 0.28, 0]);                                      // ceremonial robe
    add('spine', box(0.36, 0.07, 0.26), '#8a6a3c', [0, 0.5, 0]);
    add('head', cone(0.095, 0.32, 6), '#f4f1ea', [0, 0.75, 0.14], [Math.PI - 0.1, 0, 0]);           // flowing white beard
    add('head', sph(0.13, 1), '#e8e4da', [0, 1.0, -0.04], undefined, [1, 0.75, 1]);
    add('spine', cyl(0.22, 0.26, 0.14, 10), '#7a5a8a', [0, 0.82, 0]);                               // shaman shawl
    add('spine', sph(0.048, 0), '#7fd0c0', [0, 0.74, 0.145]);                                       // spirit talisman
  }
  if (kind === 'slinger') {
    add('head', cyl(hr * 1.06, hr * 1.06, 0.055, 10), '#b8452e', [0, 0.965, 0]);
    add('spine', box(0.32, 0.08, 0.16), '#7a5a30', [0.0, 0.66, 0.02], [0, 0, 0.55]);                // leather bandolier
    add('hips', sph(0.095, 0), '#8a6a3c', [0.19, 0.44, 0.09]); add('hips', sph(0.04, 0), '#9a9ca6', [0.19, 0.51, 0.13]);
    add('spine', box(0.26, 0.26, 0.11), '#5f4a2c', [0, 0.66, -0.15]);
  }
  if (kind === 'brute') {
    for (const sx of [-1, 1]) add('spine', sph(0.18, 1), '#3a2c22', [sx * 0.2, 0.82, 0.0], undefined, [1.2, 0.85, 1.1]); // thick fur mantle
    for (let i = 0; i < 6; i++) add('spine', cone(0.045, 0.18, 4), '#ede2c8', [-0.22 + i * 0.088, 0.75, 0.16], [Math.PI - 0.3, 0, 0]); // fang collar
    add('spine', sph(0.24, 1), '#4a392b', [0, 0.64, -0.12], undefined, [1.1, 1.2, 0.6]);
    add('hips', cyl(0.21, 0.25, 0.22, 10), '#4a392b', [0, 0.38, 0]);
  }
  if (kind === 'stalker') {
    add('spine', box(0.36, 0.34, 0.04), '#7a5a3a', [0, 0.64, -0.14], [0.08, 0, 0]);                 // hide hunting cloak
    for (let i = 0; i < 3; i++) add('spine', cyl(0.012, 0.012, 0.74, 4), '#8a6a40', [-0.11 + i * 0.05, 0.86, -0.18], [0.25, 0, 0.12]);
    add('head', cone(0.032, 0.24, 4), '#38d39c', [0.1, 1.09, -0.04], [0, 0, -0.38]);
  }
  if (kind === 'champion') {
    add('spine', cyl(0.23, 0.26, 0.16, 10), '#c9a85a', [0, 0.81, 0]);                               // bronze-bone gorget
    for (const sx of [-1, 1]) add(sx < 0 ? 'shL' : 'shR', sph(0.13, 1), '#d8cfc0', [sx * 0.22, 0.78, 0], undefined, [1.15, 0.75, 1.1]);
    add('spine', cyl(0.20, 0.22, 0.18, 10), '#d8cfc0', [0, 0.66, 0.01]);
    add('head', cyl(hr * 1.12, hr * 1.16, 0.14, 12), '#d8cfc0', [0, 0.99, 0]);
    for (let i = 0; i < 5; i++) add('head', cone(0.032, 0.27 - Math.abs(i - 2) * 0.03, 4), '#c23a2a', [0, 1.13 + (i === 2 ? 0.04 : 0), -0.14 + i * 0.07], [0.2 * (i - 2), 0, 0]);
    add('spine', box(0.38, 0.68, 0.03), team, [0, 0.5, -0.16], [0.1, 0, 0]);
  }
  if (kind === 'raider') { add('spine', cyl(0.22, 0.25, 0.11, 8), '#2a2a30', [0, 0.8, 0]); add('head', box(0.22, 0.04, 0.03), '#c23a2a', [0, 0.91, 0.155]); add('spine', box(0.06, 0.2, 0.02), '#c23a2a', [-0.1, 0.7, 0.14], [0, 0, 0.3]); }
  if (kind === 'hunter') { add('spine', cyl(0.05, 0.06, 0.42, 6), '#6a4526', [-0.1, 0.72, -0.17], [0.2, 0, 0.15]); add('spine', cone(0.04, 0.1, 4), '#e6dcc4', [-0.14, 0.95, -0.19]); add('spine', box(0.03, 0.2, 0.02), '#8a8a8a', [0.12, 0.74, -0.14]); }
  if (kind === 'scout') { add('head', cone(0.025, 0.28, 4), '#e8d8a0', [-0.1, 1.12, -0.02], [0, 0, 0.45]); add('spine', box(0.3, 0.1, 0.1), '#8a6a3c', [0, 0.52, -0.15]); }
  if (kind === 'leader') {
    add('spine', box(0.42, 0.72, 0.03), team, [0, 0.5, -0.15], [0.12, 0, 0]);                       // chieftain cape
    for (const sx of [-1, 1]) add('spine', sph(0.14, 1), '#5a4028', [sx * 0.19, 0.83, -0.02], undefined, [1.2, 0.7, 1.1]); // fur mantle
    add('head', blenderGeo('crown_leader'), '#f0e5cc');                                              // Blender-sculpted antler/ivory crown
    add('head', sph(0.032, 0), '#e8bd63', [0, 0.965, 0.172]);                                       // golden crown gem
    add('spine', sph(0.042, 0), '#e8bd63', [0, 0.76, 0.145]);                                       // chieftain medallion
  }
  if (kind === 'gatherer' && v === 3) add('spine', box(0.42 * bw, 0.1, 0.1), '#8a6a3c', [0, 0.58, -0.15]);
  // hand-held weapons (authored along -y from the hand, so thrusting along the arm points the weapon forward)
  const hands: Record<string, Part[]> = {
    guard: [{ g: cyl(0.022, 0.022, 1.6, 6), c: '#8b6a40', p: [0, -0.45, 0.0] }, { g: cyl(0.03, 0.03, 0.08, 6), c: '#5a3d25', p: [0, -1.22, 0] }, { g: cone(0.055, 0.25, 6), c: '#d0d4dc', p: [0, -1.38, 0], r: [Math.PI, 0, 0] }],
    leader: [{ g: cyl(0.024, 0.024, 1.65, 6), c: '#8b6a40', p: [0, -0.45, 0.0] }, { g: cone(0.06, 0.26, 6), c: '#f0e2a8', p: [0, -1.4, 0], r: [Math.PI, 0, 0] }, { g: box(0.07, 0.12, 0.07), c: team, p: [0, -1.14, 0] }, { g: sph(0.038, 0), c: '#e8bd63', p: [0, -1.24, 0] }],
    raider: [{ g: cyl(0.025, 0.025, 0.7, 5), c: '#6a4526', p: [0, -0.22, 0] }, { g: rock(0.15), c: '#80828c', p: [0, -0.6, 0], s: [0.8, 1.1, 0.8] }],
    scout: [{ g: cyl(0.018, 0.018, 1.45, 5), c: '#a78858', p: [0, -0.42, 0] }, { g: cone(0.035, 0.16, 5), c: '#c7c9d0', p: [0, -1.2, 0], r: [Math.PI, 0, 0] }],
    elder: [{ g: cyl(0.025, 0.03, 1.5, 6), c: '#6a4526', p: [0, -0.4, 0] }, { g: sph(0.095, 1), c: '#7fd0c0', p: [0, -1.18, 0] }, { g: box(0.22, 0.035, 0.035), c: '#e8bd63', p: [0, -1.02, 0] }],
    slinger: [{ g: cyl(0.01, 0.01, 0.6, 4), c: '#cbb98a', p: [0, -0.3, 0] }, { g: sph(0.055, 0), c: '#9a9ca6', p: [0, -0.62, 0] }],
    brute: [{ g: cyl(0.042, 0.052, 0.82, 6), c: '#6a4526', p: [0, -0.25, 0] }, { g: sph(0.21, 1), c: '#7a6a58', p: [0, -0.7, 0], s: [1, 1.2, 1] }, { g: cone(0.045, 0.14, 4), c: '#ede2c8', p: [0.19, -0.68, 0], r: [0, 0, -1.4] }, { g: cone(0.045, 0.14, 4), c: '#ede2c8', p: [-0.19, -0.68, 0], r: [0, 0, 1.4] }],
    stalker: [{ g: cyl(0.016, 0.016, 1.18, 5), c: '#a07a48', p: [0, -0.36, 0] }, { g: cone(0.038, 0.18, 5), c: '#3a3a40', p: [0, -1.0, 0], r: [Math.PI, 0, 0] }],
    champion: [{ g: cyl(0.026, 0.026, 1.82, 6), c: '#8b6a40', p: [0, -0.5, 0.0] }, { g: cone(0.07, 0.32, 6), c: '#f2ead2', p: [0, -1.56, 0], r: [Math.PI, 0, 0] }, { g: box(0.08, 0.14, 0.08), c: team, p: [0, -1.3, 0] }, { g: box(0.16, 0.05, 0.05), c: '#e8bd63', p: [0, -1.38, 0] }],
  };
  const g: PersonGeo = {
    body: mergeSkinned(P),
    spear: merge(hands[kind] ?? [{ g: box(0.01, 0.01, 0.01), c: '#000', p: [0, 0, 0] }]),
    bow: merge([{ g: new THREE.TorusGeometry(0.42, 0.018, 5, 16, Math.PI), c: '#6a4526', p: [0, 0, 0.05], r: [0, Math.PI / 2, Math.PI / 2] }, { g: cyl(0.004, 0.004, 0.84, 3), c: '#eeeeee', p: [0, 0, 0.05] }]),
    toolAxe: merge([{ g: cyl(0.022, 0.022, 0.66, 5), c: '#7a5230', p: [0, -0.2, 0] }, { g: box(0.05, 0.14, 0.22), c: '#a5a7b0', p: [0, -0.5, 0.08] }]),
    toolPick: merge([{ g: cyl(0.022, 0.022, 0.66, 5), c: '#7a5230', p: [0, -0.2, 0] }, { g: box(0.05, 0.06, 0.44), c: '#8b8d97', p: [0, -0.5, 0] }]),
    toolHammer: merge([{ g: cyl(0.022, 0.022, 0.5, 5), c: '#7a5230', p: [0, -0.12, 0] }, { g: box(0.11, 0.11, 0.24), c: '#8b8d97', p: [0, -0.4, 0] }]),
    torch: merge([{ g: cyl(0.02, 0.03, 0.55, 5), c: '#6a4526', p: [0, 0.1, 0] }]),
  };
  personCache.set(key, g);
  return g;
}

export interface AnimalGeo { body: THREE.BufferGeometry; legF: THREE.BufferGeometry; legB: THREE.BufferGeometry }
const animalCache = new Map<string, AnimalGeo>();
export function animalGeo(kind: 'deer' | 'wolf' | 'mammoth', variant: number): AnimalGeo {
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
  } else if (kind === 'mammoth') {
    const fur = '#6a4a30', dark = '#4a3220', pale = '#8a6a48', b: Part[] = [
      { g: sph(0.7, 1), c: fur, p: [0, 1.15, 0], s: [0.85, 0.78, 1.25] },                    // barrel body
      { g: sph(0.55, 1), c: pale, p: [0, 1.55, 0.35], s: [0.9, 0.95, 0.9] },                  // humped shoulders
      { g: sph(0.62, 1), c: dark, p: [0, 1.0, -0.55], s: [0.85, 0.75, 0.9] },                 // rump
      { g: sph(0.46, 1), c: fur, p: [0, 1.3, 1.05], s: [0.95, 1.0, 1.0] },                    // head
      { g: sph(0.3, 1), c: pale, p: [0, 1.75, 0.9], s: [1, 0.8, 1] },                         // topknot
      { g: cyl(0.12, 0.2, 1.0, 7), c: dark, p: [0, 0.85, 1.45], r: [0.35, 0, 0] },           // trunk
      { g: cyl(0.08, 0.12, 0.5, 6), c: dark, p: [0, 0.35, 1.68], r: [-0.6, 0, 0] },
      { g: sph(0.05, 0), c: '#1a1008', p: [0.3, 1.38, 1.38] }, { g: sph(0.05, 0), c: '#1a1008', p: [-0.3, 1.38, 1.38] },
      { g: sph(0.26, 1), c: dark, p: [0.52, 1.22, 0.95], s: [0.35, 1, 0.8] }, { g: sph(0.26, 1), c: dark, p: [-0.52, 1.22, 0.95], s: [0.35, 1, 0.8] },   // ears
      { g: cyl(0.04, 0.09, 1.1, 6), c: '#efe6cc', p: [0.34, 0.95, 1.55], r: [0.9, 0, -0.35] }, { g: cyl(0.04, 0.09, 1.1, 6), c: '#efe6cc', p: [-0.34, 0.95, 1.55], r: [0.9, 0, 0.35] },   // tusks
      { g: cone(0.05, 0.3, 4), c: '#efe6cc', p: [0.62, 1.3, 1.95], r: [1.5, 0, -0.5] }, { g: cone(0.05, 0.3, 4), c: '#efe6cc', p: [-0.62, 1.3, 1.95], r: [1.5, 0, 0.5] },
      { g: cyl(0.03, 0.05, 0.55, 5), c: dark, p: [0, 1.0, -1.0], r: [-0.5, 0, 0] },        // tail
    ];
    for (let i = 0; i < 14; i++) b.push({ g: cone(0.07, 0.5 + (i % 3) * 0.12, 4), c: i % 2 ? dark : fur, p: [((i % 7) - 3) * 0.2, 0.55, ((i * 37) % 9 - 4) * 0.2], r: [Math.PI, 0, 0] });   // shaggy fringe
    const leg = (z: number) => merge([-1, 1].map((s) => ({ g: cyl(0.17, 0.2, 0.9, 7), c: fur, p: [s * 0.4, -0.45, z] as V3 })));
    g = { body: merge(b), legF: leg(0.55), legB: leg(-0.6) };
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
