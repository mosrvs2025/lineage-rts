import { UNITS } from '../data/units';
import type { Building, ResNode, Unit, World } from './types';
import { isExplored, isVisible } from './rules';
import { bCenter } from './util';

export type Hit =
  | { type: 'unit'; unit: Unit }
  | { type: 'building'; building: Building }
  | { type: 'node'; node: ResNode };

/** Hit-test the world at a point. `tol` is extra radius in tiles (larger for touch). */
export function entityAt(w: World, x: number, y: number, tol = 0.2): Hit | undefined {
  let best: Hit | undefined, bd = Infinity;
  for (const u of w.units) {
    if (u.hp <= 0) continue;
    if (u.owner !== 0 && !isVisible(w, u.x, u.y)) continue;
    const d = Math.hypot(u.x - x, u.y - y) - UNITS[u.kind].radius;
    if (d < tol && d < bd) { bd = d; best = { type: 'unit', unit: u }; }
  }
  if (best) return best;
  for (const b of w.buildings) {
    if (b.owner !== 0 && !isExplored(w, b.x + b.w / 2, b.y + b.h / 2)) continue;
    if (x >= b.x - tol * 0.5 && x <= b.x + b.w + tol * 0.5 && y >= b.y - tol * 0.5 && y <= b.y + b.h + tol * 0.5) {
      const c = bCenter(b); const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; best = { type: 'building', building: b }; }
    }
  }
  if (best) return best;
  for (const n of w.nodes) {
    if (!isExplored(w, n.x, n.y)) continue;
    const d = Math.hypot(n.x + 0.5 - x, n.y + 0.5 - y) - 0.5;
    if (d < tol && d < bd) { bd = d; best = { type: 'node', node: n }; }
  }
  return best;
}

/** What would an order target at this point? Enemies, resource nodes and own construction sites; never your own units. */
export function targetAt(w: World, x: number, y: number, tol = 0.4): Hit | undefined {
  let best: Hit | undefined, bd = Infinity;
  const consider = (hit: Hit, d: number) => { if (d < tol && d < bd) { bd = d; best = hit; } };
  for (const u of w.units) {
    if (u.hp <= 0 || u.owner === 0 || !isVisible(w, u.x, u.y)) continue;
    consider({ type: 'unit', unit: u }, Math.hypot(u.x - x, u.y - y) - UNITS[u.kind].radius - 0.2);
  }
  if (best) return best;
  for (const b of w.buildings) {
    if (b.owner === 0 ? b.done : !isExplored(w, b.x + b.w / 2, b.y + b.h / 2)) continue;
    if (x >= b.x - tol * 0.5 && x <= b.x + b.w + tol * 0.5 && y >= b.y - tol * 0.5 && y <= b.y + b.h + tol * 0.5) {
      const c = bCenter(b); consider({ type: 'building', building: b }, Math.hypot(c.x - x, c.y - y) * 0.2);
    }
  }
  if (best) return best;
  for (const n of w.nodes) {
    if (!isExplored(w, n.x, n.y)) continue;
    consider({ type: 'node', node: n }, Math.hypot(n.x + 0.5 - x, n.y + 0.5 - y) - 0.5);
  }
  return best;
}

export function unitsInRect(w: World, x0: number, y0: number, x1: number, y1: number): Unit[] {
  const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
  return w.units.filter((u) => u.owner === 0 && u.hp > 0 && u.x >= lx && u.x <= hx && u.y >= ly && u.y <= hy);
}

