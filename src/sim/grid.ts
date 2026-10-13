import type { Pt, World } from './types';
import { clamp } from './util';

export interface Rect { x: number; y: number; w: number; h: number }

export function rebuildBlocked(w: World) {
  const b = new Uint8Array(w.W * w.H);
  for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
    const c = w.terrain[y][x];
    if (c === '~' || c === '^') b[y * w.W + x] = 1;
  }
  for (const n of w.nodes) if (n.kind !== 'carcass') b[n.y * w.W + n.x] = 1;
  for (const bd of w.buildings) {
    for (let y = bd.y; y < bd.y + bd.h; y++) for (let x = bd.x; x < bd.x + bd.w; x++) {
      if (x >= 0 && y >= 0 && x < w.W && y < w.H) b[y * w.W + x] = 1;
    }
  }
  w._blocked = b;
}

export function isBlocked(w: World, tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= w.W || ty >= w.H) return true;
  return w._blocked![ty * w.W + tx] === 1;
}

/** Nearest walkable tile center to a world position (spiral search). */
export function nearestFree(w: World, x: number, y: number, maxR = 12): Pt {
  const cx = clamp(Math.floor(x), 0, w.W - 1), cy = clamp(Math.floor(y), 0, w.H - 1);
  if (!isBlocked(w, cx, cy)) return { x: clamp(x, 0.5, w.W - 0.5), y: clamp(y, 0.5, w.H - 0.5) };
  for (let r = 1; r <= maxR; r++) {
    let best: Pt | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = cx + dx, ty = cy + dy;
      if (isBlocked(w, tx, ty)) continue;
      const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
      if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
    }
    if (best) return best;
  }
  return { x: cx + 0.5, y: cy + 0.5 };
}

class Heap {
  a: number[] = []; // pairs flattened: f, idx
  push(f: number, i: number) {
    const a = this.a; a.push(f, i);
    let n = a.length / 2 - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (a[p * 2] <= a[n * 2]) break;
      [a[p * 2], a[n * 2]] = [a[n * 2], a[p * 2]];
      [a[p * 2 + 1], a[n * 2 + 1]] = [a[n * 2 + 1], a[p * 2 + 1]];
      n = p;
    }
  }
  pop(): number {
    const a = this.a; const top = a[1];
    const lf = a.pop()!, li = a.pop()!;
    const len = a.length / 2;
    if (len > 0) {
      a[0] = lf; a[1] = li;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1, r = l + 1; let m = n;
        if (l < len && a[l * 2] < a[m * 2]) m = l;
        if (r < len && a[r * 2] < a[m * 2]) m = r;
        if (m === n) break;
        [a[m * 2], a[n * 2]] = [a[n * 2], a[m * 2]];
        [a[m * 2 + 1], a[n * 2 + 1]] = [a[n * 2 + 1], a[m * 2 + 1]];
        n = m;
      }
    }
    return top;
  }
  get size() { return this.a.length / 2; }
}

function lineClear(w: World, a: Pt, b: Pt, allow?: Rect): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 0.01) return true;
  const steps = Math.ceil(d / 0.2);
  const nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d; // perpendicular, so the path keeps clear of corners
  for (let i = 1; i <= steps; i++) {
    for (const off of [0, 0.28, -0.28]) {
      const x = a.x + ((b.x - a.x) * i) / steps + nx * off, y = a.y + ((b.y - a.y) * i) / steps + ny * off;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (allow && tx >= allow.x && tx < allow.x + allow.w && ty >= allow.y && ty < allow.y + allow.h) continue;
      if (isBlocked(w, tx, ty)) return false;
    }
  }
  return true;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A* over the tile grid. `allow` marks a rectangle of otherwise-blocked tiles that may be entered (a target footprint). */
export function findPath(w: World, sx: number, sy: number, gx: number, gy: number, allow?: Rect, smooth = true): Pt[] | null {
  const W = w.W, H = w.H;
  const inAllow = (x: number, y: number) => !!allow && x >= allow.x && x < allow.x + allow.w && y >= allow.y && y < allow.y + allow.h;
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (!w._blocked![y * W + x] || inAllow(x, y));
  const stx = clamp(Math.floor(sx), 0, W - 1), sty = clamp(Math.floor(sy), 0, H - 1);
  const gtx = clamp(Math.floor(gx), 0, W - 1), gty = clamp(Math.floor(gy), 0, H - 1);
  const start = sty * W + stx, goal = gty * W + gtx;
  if (start === goal) return [{ x: gx, y: gy }];
  if (!walk(gtx, gty)) return null;
  const g = new Float32Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const heap = new Heap();
  g[start] = 0; heap.push(0, start);
  const hfn = (x: number, y: number) => {
    const dx = Math.abs(x - gtx), dy = Math.abs(y - gty);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) { found = true; break; }
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!walk(nx, ny)) continue;
      if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + (dx && dy ? Math.SQRT2 : 1);
      if (ng < g[ni]) { g[ni] = ng; from[ni] = cur; heap.push(ng + hfn(nx, ny), ni); }
    }
  }
  if (!found) return null;
  const tiles: Pt[] = [];
  for (let c = goal; c !== start && c !== -1; c = from[c]) tiles.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
  tiles.reverse();
  // last waypoint is the exact target when it lies on a walkable tile
  if (tiles.length) tiles[tiles.length - 1] = { x: gx, y: gy };
  if (!smooth) return tiles;
  // string-pull: skip waypoints with clear line of sight
  const out: Pt[] = [];
  let anchor: Pt = { x: sx, y: sy };
  let i = 0;
  while (i < tiles.length) {
    let j = i;
    while (j + 1 < tiles.length && lineClear(w, anchor, tiles[j + 1], allow)) j++;
    out.push(tiles[j]); anchor = tiles[j]; i = j + 1;
  }
  return out;
}
