/** Procedural terrain: noise fields -> ground texture (canvas) + height grid for the 3D mesh. No image assets. */
import type { World } from '../sim/types';

// ------------------------------------------------------------------ noise
function h(ix: number, iy: number, s = 0) {
  let n = (ix * 374761393 + iy * 668265263 + s * 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export const hash2 = (x: number, y: number, s = 0) => h(x, y, s);
function vnoise(x: number, y: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy, s), b = h(ix + 1, iy, s), c = h(ix, iy + 1, s), d = h(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 4, s = 0) {
  let a = 0.5, f = 1, t = 0, n = 0;
  for (let i = 0; i < oct; i++) { t += a * vnoise(x * f, y * f, s + i * 7); n += a; a *= 0.5; f *= 2; }
  return t / n;
}
export const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ------------------------------------------------------------------ shared fields
export const TERRAIN_PX = 32;   // ground-texture pixels per tile
export const HEIGHT_RES = 4;    // height samples per tile
export const WATER_LEVEL = -0.25;

function makeFields(w: World) {
  const W = w.W, H = w.H;
  const water = new Float32Array(W * H), ford = new Float32Array(W * H), mtn = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = w.terrain[y][x], i = y * W + x;
    if (c === '~') water[i] = 1; else if (c === '=') ford[i] = 1; else if (c === '^') mtn[i] = 1;
  }
  const sample = (a: Float32Array, fx: number, fy: number) => {
    const x = Math.max(0, Math.min(W - 1.001, fx - 0.5)), y = Math.max(0, Math.min(H - 1.001, fy - 0.5));
    const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
    const a0 = a[iy * W + ix], b0 = a[iy * W + ix + 1], c0 = a[(iy + 1) * W + ix], d0 = a[(iy + 1) * W + ix + 1];
    return a0 + (b0 - a0) * u + (c0 - a0) * v + (a0 - b0 - c0 + d0) * u * v;
  };
  const warp = (fx: number, fy: number): [number, number] => [fx + (fbm(fx * 1.3, fy * 1.3, 3, 11) - 0.5) * 1.1, fy + (fbm(fx * 1.3 + 9, fy * 1.3 + 5, 3, 21) - 0.5) * 1.1];
  /** mountain elevation in world units (0 on flat ground) */
  const mtnH = (fx: number, fy: number) => {
    const [wx, wy] = warp(fx, fy);
    const m = sstep(0.28, 0.85, sample(mtn, wx, wy));
    return m * (1.3 + 3.4 * fbm(fx * 0.42 + 7, fy * 0.42, 3, 3));
  };
  const height = (fx: number, fy: number) => {
    const [wx, wy] = warp(fx, fy);
    const fo = sample(ford, wx, wy);
    const wTot = Math.min(1, sample(water, wx, wy) + fo * 0.58);
    const deep = sstep(0.40, 0.62, wTot);
    let bed = -0.55 * deep;
    bed = bed + (-0.30 - bed) * fo * deep; // fords are shallow sandbars
    const land = (fbm(fx * 0.3, fy * 0.3, 2, 61) - 0.5) * 0.14;
    return land * (1 - sstep(0.2, 0.5, wTot)) + bed + mtnH(fx, fy);
  };
  return { water, ford, mtn, sample, warp, mtnH, height };
}

/** Heights on a (W*4+1) x (H*4+1) grid, row-major from the north-west corner. */
export function buildHeightGrid(w: World): Float32Array {
  const f = makeFields(w), R = HEIGHT_RES, GW = w.W * R + 1, GH = w.H * R + 1;
  const g = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) g[j * GW + i] = f.height(i / R, j / R);
  return g;
}

// ------------------------------------------------------------------ ground texture
export function bakeTerrain(w: World): HTMLCanvasElement {
  const R = 12, T = TERRAIN_PX, W = w.W, H = w.H;
  const { water, ford, mtn, sample, warp, mtnH } = makeFields(w);
  const fc = document.createElement('canvas'); fc.width = W * R; fc.height = H * R;
  const fctx = fc.getContext('2d')!; const img = fctx.createImageData(fc.width, fc.height);
  const GD: RGB = [58, 104, 42], GL: RGB = [124, 170, 66], GY: RGB = [150, 168, 72], GF: RGB = [44, 84, 40];
  const SAND: RGB = [214, 197, 146], WET: RGB = [150, 136, 98];
  const D1: RGB = [24, 80, 128], D2: RGB = [44, 120, 168], D3: RGB = [104, 178, 196];
  const R1: RGB = [74, 72, 80], R2: RGB = [138, 136, 144];
  for (let py = 0; py < fc.height; py++) for (let px = 0; px < fc.width; px++) {
    const fx = (px + 0.5) / R, fy = (py + 0.5) / R;
    const n = fbm(fx * 0.7, fy * 0.7, 4, 1), n2 = fbm(fx * 3, fy * 3, 3, 5), n3 = fbm(fx * 0.35, fy * 0.35, 3, 9);
    let col = mix(mix(GD, GL, sstep(0.3, 0.7, n)), GY, sstep(0.55, 0.8, n3) * 0.6);
    col = mix(col, GF, sstep(0.6, 0.85, fbm(fx * 0.5 + 40, fy * 0.5, 3, 14)) * 0.3);
    col = mix(col, [col[0] * 0.9, col[1] * 0.92, col[2] * 0.9], n2 * 0.6);
    const [wx, wy] = warp(fx, fy);
    const wa = Math.min(1, sample(water, wx, wy) + sample(ford, wx, wy) * 0.58);
    const fo = sample(ford, wx, wy);
    const m = sample(mtn, wx, wy);
    if (m > 0.2) {
      const ht = mtnH(fx, fy) / 4.6;
      let rock = mix(R1, R2, Math.max(0, Math.min(1, 0.2 + ht * 0.7 + (n2 - 0.5) * 0.5)));
      rock = mix(rock, [226, 232, 242], sstep(0.55, 0.78, ht + (n - 0.5) * 0.25) * 0.92);
      col = mix(col, mix(GF, R1, 0.5), sstep(0.2, 0.42, m) * 0.7);
      col = mix(col, rock, sstep(0.34, 0.56, m));
    }
    if (wa > 0.28) {
      const sandAmt = sstep(0.30, 0.40, wa);
      col = mix(col, mix(SAND, [col[0] + 40, col[1] + 30, col[2] + 10], n2 * 0.4), sandAmt);
      col = mix(col, WET, sstep(0.43, 0.49, wa) * 0.9);
      const depth = sstep(0.5, 1, wa);
      let wc = mix(mix(D3, D2, sstep(0, 0.45, depth)), D1, sstep(0.45, 1, depth));
      if (fo > 0.05) wc = mix(wc, mix(SAND, D3, 0.35 + n2 * 0.25), Math.min(1, fo * 0.9));
      col = mix(col, wc, sstep(0.49, 0.53, wa));
      const foam = Math.exp(-(((wa - 0.505) / 0.022) ** 2)) * (0.35 + 0.5 * fbm(fx * 7, fy * 7, 2, 2));
      col = mix(col, [245, 250, 252], Math.min(0.6, foam));
    }
    const o = (py * fc.width + px) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  fctx.putImageData(img, 0, 0);

  const c = document.createElement('canvas'); c.width = W * T; c.height = H * T;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(fc, 0, 0, c.width, c.height);

  // hand-placed detail: grass tufts, flowers, pebbles, reeds
  const r = rng(w.seed ^ 0x9e3779b9);
  const tileWater = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && water[y * W + x] > 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (water[i] || ford[i] || mtn[i]) {
      if (ford[i] && r() < 0.8) { g.fillStyle = 'rgba(120,100,70,.35)'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x * T + r() * T, y * T + r() * T, 1 + r() * 2, 1 + r(), 0, 0, 6.3); g.fill(); } }
      continue;
    }
    const nearW = tileWater(x - 1, y) || tileWater(x + 1, y) || tileWater(x, y - 1) || tileWater(x, y + 1);
    const nt = 3 + Math.floor(r() * 4);
    for (let k = 0; k < nt; k++) {
      const bx = x * T + r() * T, by = y * T + 4 + r() * (T - 4), dark = r() < 0.5;
      g.strokeStyle = dark ? 'rgba(34,70,28,.5)' : 'rgba(172,206,98,.55)'; g.lineWidth = 1.2; g.beginPath();
      for (let b = -1; b <= 1; b++) { g.moveTo(bx + b * 1.6, by); g.lineTo(bx + b * 2.8 + (r() - 0.5) * 2, by - 4 - r() * 4); }
      g.stroke();
    }
    if (r() < 0.1) { const cols = ['#fff6d0', '#ffd84a', '#d99bff', '#ff9ab0']; g.fillStyle = cols[Math.floor(r() * cols.length)]; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x * T + r() * T, y * T + r() * T, 1.5, 0, 6.3); g.fill(); } }
    if (r() < 0.07) { g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x * T + r() * T + 1, y * T + r() * T + 1.5, 3.2, 2, 0, 0, 6.3); g.fill(); g.fillStyle = '#a6a49a'; g.beginPath(); g.ellipse(x * T + r() * T, y * T + r() * T, 3, 2, 0, 0, 6.3); g.fill(); }
    if (nearW && r() < 0.5) {
      const side = tileWater(x - 1, y) ? 0 : tileWater(x + 1, y) ? 1 : 0.5;
      for (let k = 0; k < 3; k++) {
        const bx = x * T + side * T + (r() - 0.5) * 8, by = y * T + r() * T;
        g.strokeStyle = '#4c6a2a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (r() - 0.5) * 4, by - 7 - r() * 4); g.stroke();
      }
    }
  }
  return c;
}
