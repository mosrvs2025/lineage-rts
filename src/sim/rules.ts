import { BUILDINGS } from '../data/buildings';
import type { Building, DiscoveryId, Owner, Pt, Unit, World } from './types';
import { bCenter } from './util';

export const SUPPLY_RANGE = 34;

export const hasDisc = (w: World, id: DiscoveryId) => w.disc[id] === 'known' || w.disc[id] === 'preserved';

export function hostile(w: World, a: Owner, b: Owner): boolean {
  if (a === b) return false;
  if (a === 2 || b === 2) return true;
  return w.time >= w.truceUntil;
}

export function popCount(w: World, owner: Owner = 0) { return w.units.filter((u) => u.owner === owner).length; }
export function queuedCount(w: World) {
  let n = 0; for (const b of w.buildings) if (b.owner === 0) n += b.queue.length; return n;
}
export function popCap(w: World) {
  let c = 0; for (const b of w.buildings) if (b.owner === 0 && b.done) c += BUILDINGS[b.kind].pop; return c;
}

export function gatherRate(w: World, u: Unit, res: 'food' | 'wood' | 'stone', carcass: boolean): number {
  let r = res === 'food' ? (carcass ? 1.2 : 0.7) : res === 'wood' ? 0.65 : 0.5;
  if (u.owner === 0) {
    if (w.species === 'human') r *= 1.1;
    if (w.trait === 'logistics') r *= 1.15;
    if (res !== 'food' && w.buildings.some((b) => b.owner === 0 && b.kind === 'toolshelter' && b.done)) r *= 1.15;
    if (w._starving) r *= 0.7;
  }
  return r;
}

export function foodMult(w: World) { return hasDisc(w, 'cooking') ? 1.25 : 1; }

export function nearestDropoff(w: World, u: Unit): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const b of w.buildings) {
    if (b.owner !== u.owner || !b.done || !BUILDINGS[b.kind].dropoff) continue;
    const c = bCenter(b); const d = Math.hypot(c.x - u.x, c.y - u.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function isWarm(w: World, x: number, y: number): boolean {
  for (const b of w.buildings) {
    if (b.owner !== 0 || !b.done) continue;
    const r = BUILDINGS[b.kind].warmth; if (!r) continue;
    const c = bCenter(b);
    if (Math.hypot(c.x - x, c.y - y) <= r + Math.max(b.w, b.h) / 2) return true;
  }
  return false;
}

export function supplyCenters(w: World): Pt[] {
  return w.buildings.filter((b) => b.owner === 0 && b.done && (b.kind === 'hearth' || b.kind === 'watch')).map(bCenter);
}
export function isSupplied(centers: Pt[], x: number, y: number) {
  for (const c of centers) if (Math.hypot(c.x - x, c.y - y) <= SUPPLY_RANGE) return true;
  return false;
}

export function visionOf(w: World, u: Unit, base: number) {
  let v = base;
  if (u.owner === 0 && w.trait === 'recon') v += 2;
  return v;
}

export function isVisible(w: World, x: number, y: number) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return false;
  return !!w._vis && w._vis[ty * w.W + tx] === 2;
}
export function isExplored(w: World, x: number, y: number) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return false;
  return !!w._exp && w._exp[ty * w.W + tx] > 0;
}
