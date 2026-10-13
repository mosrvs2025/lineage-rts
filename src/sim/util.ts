import type { Building, Pt, ResNode, Unit, World } from './types';

export function rand(w: World): number {
  // mulberry32 with serializable state
  w.rng = (w.rng + 0x6d2b79f5) | 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randRange = (w: World, a: number, b: number) => a + rand(w) * (b - a);
export const pick = <T,>(w: World, arr: T[]): T => arr[Math.floor(rand(w) * arr.length)];
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export function log(w: World, text: string, kind: 'info' | 'good' | 'bad' = 'info') {
  w.log.push({ t: w.time, text, kind });
  if (w.log.length > 40) w.log.shift();
}

export function unitById(w: World, id: number): Unit | undefined { return w._u?.get(id); }
export function buildingById(w: World, id: number): Building | undefined { return w._b?.get(id); }
export function nodeById(w: World, id: number): ResNode | undefined { return w._n?.get(id); }

export function bCenter(b: Building): Pt { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }
export const bRadius = (b: Building) => Math.max(b.w, b.h) / 2;

export function reindex(w: World) {
  w._u = new Map(w.units.map((u) => [u.id, u]));
  w._b = new Map(w.buildings.map((b) => [b.id, b]));
  w._n = new Map(w.nodes.map((n) => [n.id, n]));
}

export function tileOf(v: number) { return Math.floor(v); }
export function terrainAt(w: World, tx: number, ty: number): string {
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return '^';
  return w.terrain[ty][tx];
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function isWinter(w: World) { return w.time >= w.winter.start && w.time < w.winter.end; }
