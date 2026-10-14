import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { tierBonus, visionOf } from './rules';
import type { World } from './types';

export function ensureFog(w: World) {
  if (!w._vis) w._vis = new Uint8Array(w.W * w.H);
  if (!w._exp) {
    w._exp = new Uint8Array(w.W * w.H);
    for (let i = 0; i < w.explored.length && i < w._exp.length; i++) if (w.explored[i] === '1') w._exp[i] = 1;
  }
}

export function updateFog(w: World) {
  ensureFog(w);
  const vis = w._vis!, exp = w._exp!;
  vis.fill(0);
  const reveal = (cx: number, cy: number, r: number) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w.W - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(w.H - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) { vis[y * w.W + x] = 2; exp[y * w.W + x] = 1; }
    }
  };
  for (const u of w.units) if (u.owner === 0) reveal(u.x, u.y, visionOf(w, u, UNITS[u.kind].vision));
  for (const b of w.buildings) if (b.owner === 0) reveal(b.x + b.w / 2, b.y + b.h / 2, BUILDINGS[b.kind].vision + (b.done ? tierBonus(b, 'vision') : -2));
}

export function packExplored(w: World) {
  ensureFog(w);
  let s = '';
  const e = w._exp!;
  for (let i = 0; i < e.length; i++) s += e[i] ? '1' : '0';
  w.explored = s;
}
