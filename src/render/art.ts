/** Procedural art: organic terrain bake, plus pre-rendered sprites for trees, bushes, rocks and buildings. No image assets. */
import type { BuildingKind, World } from '../sim/types';

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
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ------------------------------------------------------------------ terrain
export const TERRAIN_PX = 32; // baked pixels per tile

export function bakeTerrain(w: World): HTMLCanvasElement {
  const R = 12, T = TERRAIN_PX, W = w.W, H = w.H;
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
  const warp = (fx: number, fy: number) => [fx + (fbm(fx * 1.3, fy * 1.3, 3, 11) - 0.5) * 1.1, fy + (fbm(fx * 1.3 + 9, fy * 1.3 + 5, 3, 21) - 0.5) * 1.1];
  const mtnHeight = (fx: number, fy: number) => { const [wx, wy] = warp(fx, fy); return sstep(0.25, 0.9, sample(mtn, wx, wy)) * (0.65 + 0.7 * fbm(fx * 2.2, fy * 2.2, 4, 3)); };

  const fc = document.createElement('canvas'); fc.width = W * R; fc.height = H * R;
  const fctx = fc.getContext('2d')!; const img = fctx.createImageData(fc.width, fc.height);
  const GD: RGB = [58, 104, 42], GL: RGB = [124, 170, 66], GY: RGB = [150, 168, 72], GF: RGB = [44, 84, 40];
  const SAND: RGB = [214, 197, 146], WET: RGB = [150, 136, 98];
  const D1: RGB = [24, 80, 128], D2: RGB = [44, 120, 168], D3: RGB = [104, 178, 196];
  const R1: RGB = [58, 58, 66], R2: RGB = [112, 112, 120];
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
    if (m > 0.22) {
      const ht = mtnHeight(fx, fy);
      const light = (mtnHeight(fx - 0.07, fy - 0.07) - mtnHeight(fx + 0.07, fy + 0.07)) * 2.6;
      let rock = mix(R1, R2, Math.max(0, Math.min(1, 0.35 + ht * 0.45 + light + (n2 - 0.5) * 0.4)));
      rock = mix(rock, [236, 240, 247], sstep(0.92, 1.12, ht + (n - 0.5) * 0.4) * 0.9);
      col = mix(col, mix(GF, R1, 0.5), sstep(0.2, 0.42, m) * 0.7);
      col = mix(col, rock, sstep(0.38, 0.58, m));
    }
    if (wa > 0.28) {
      const sandAmt = sstep(0.30, 0.40, wa);
      col = mix(col, mix(SAND, [col[0] + 40, col[1] + 30, col[2] + 10], n2 * 0.4), sandAmt);
      col = mix(col, WET, sstep(0.43, 0.49, wa) * 0.9);
      const depth = sstep(0.5, 1, wa);
      let wc = mix(mix(D3, D2, sstep(0, 0.45, depth)), D1, sstep(0.45, 1, depth));
      const caus = fbm(fx * 5 + 3, fy * 5, 3, 31);
      wc = mix(wc, [wc[0] + 40, wc[1] + 44, wc[2] + 36], sstep(0.55, 0.8, caus) * 0.5);
      if (fo > 0.05) wc = mix(wc, mix(SAND, D3, 0.35 + n2 * 0.25), Math.min(1, fo * 0.9));
      col = mix(col, wc, sstep(0.49, 0.53, wa));
      const foam = Math.exp(-(((wa - 0.505) / 0.022) ** 2)) * (0.35 + 0.5 * fbm(fx * 7, fy * 7, 2, 2));
      col = mix(col, [245, 250, 252], Math.min(0.75, foam));
    }
    const o = (py * fc.width + px) * 4;
    img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
  }
  fctx.putImageData(img, 0, 0);

  const c = document.createElement('canvas'); c.width = W * T; c.height = H * T;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(fc, 0, 0, c.width, c.height);

  // ---- hand-placed detail: grass, flowers, reeds, pebbles
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
      g.strokeStyle = dark ? 'rgba(34,70,28,.55)' : 'rgba(172,206,98,.6)'; g.lineWidth = 1.2; g.beginPath();
      for (let b = -1; b <= 1; b++) { g.moveTo(bx + b * 1.6, by); g.lineTo(bx + b * 2.8 + (r() - 0.5) * 2, by - 4 - r() * 4); }
      g.stroke();
    }
    if (r() < 0.1) { const cols = ['#fff6d0', '#ffd84a', '#d99bff', '#ff9ab0']; g.fillStyle = cols[Math.floor(r() * cols.length)]; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x * T + r() * T, y * T + r() * T, 1.5, 0, 6.3); g.fill(); } }
    if (r() < 0.07) { g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x * T + r() * T + 1, y * T + r() * T + 1.5, 3.2, 2, 0, 0, 6.3); g.fill(); g.fillStyle = '#a6a49a'; g.beginPath(); g.ellipse(x * T + r() * T, y * T + r() * T, 3, 2, 0, 0, 6.3); g.fill(); }
    if (nearW && r() < 0.6) {
      const side = tileWater(x - 1, y) ? 0 : tileWater(x + 1, y) ? 1 : 0.5;
      for (let k = 0; k < 4; k++) {
        const bx = x * T + side * T + (r() - 0.5) * 8, by = y * T + r() * T;
        g.strokeStyle = '#4c6a2a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + (r() - 0.5) * 4, by - 9 - r() * 6); g.stroke();
        if (r() < 0.5) { g.strokeStyle = '#6b4a2a'; g.lineWidth = 2.6; g.beginPath(); g.moveTo(bx, by - 12); g.lineTo(bx, by - 16); g.stroke(); }
      }
    }
  }
  // mountain peaks (sorted back-to-front)
  const peaks: { x: number; y: number; s: number }[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mtn[y * W + x]) continue;
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    const v = hash2(x, y, 77);
    if (!edge && v < 0.18) continue;
    peaks.push({ x: x * T + T * (0.15 + r() * 0.7), y: y * T + T * (0.6 + r() * 0.4), s: edge ? 0.9 + r() * 0.5 : 0.8 + fbm(x * 0.9, y * 0.9, 2, 5) * 1.5 + v * 0.5 });
  }
  peaks.sort((a, b) => a.y - b.y);
  for (const p of peaks) {
    const bw = T * 0.62 * p.s, ht = T * 1.15 * p.s, apex = { x: p.x + (r() - 0.5) * 4, y: p.y - ht };
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(p.x + 5, p.y + 1, bw * 0.95, 4, 0, 0, 6.3); g.fill();
    let gr = g.createLinearGradient(p.x - bw, 0, apex.x, 0); gr.addColorStop(0, '#8a8a94'); gr.addColorStop(1, '#c9cad2');
    g.fillStyle = gr; g.beginPath(); g.moveTo(p.x - bw, p.y); g.lineTo(apex.x, apex.y); g.lineTo(apex.x + 1, p.y); g.closePath(); g.fill();
    gr = g.createLinearGradient(apex.x, 0, p.x + bw, 0); gr.addColorStop(0, '#6a6a76'); gr.addColorStop(1, '#42424e');
    g.fillStyle = gr; g.beginPath(); g.moveTo(apex.x, apex.y); g.lineTo(p.x + bw, p.y); g.lineTo(apex.x + 1, p.y); g.closePath(); g.fill();
    g.fillStyle = '#f4f7fb'; g.beginPath(); g.moveTo(apex.x, apex.y); g.lineTo(apex.x - bw * 0.3, apex.y + ht * 0.3); g.lineTo(apex.x - bw * 0.08, apex.y + ht * 0.22); g.lineTo(apex.x + bw * 0.1, apex.y + ht * 0.34); g.lineTo(apex.x + bw * 0.3, apex.y + ht * 0.28); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,30,40,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(apex.x, apex.y + ht * 0.3); g.lineTo(apex.x + bw * 0.1, p.y - 2); g.stroke();
  }
  return c;
}

// ------------------------------------------------------------------ small sprite helpers
function mk(w: number, hgt: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = hgt; return [c, c.getContext('2d')!];
}
function lg(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const gr = g.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr;
}
function rg(g: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, stops: [number, string][]) {
  const gr = g.createRadialGradient(x, y, r0, x, y, r1); for (const [o, c] of stops) gr.addColorStop(o, c); return gr;
}
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, c0: string, c1: string) {
  g.fillStyle = rg(g, x - r * 0.35, y - r * 0.4, r * 0.1, r * 1.05, [[0, c0], [1, c1]]);
  g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
}
function ground(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  g.fillStyle = rg(g, cx, cy, ry * 0.3, ry * 1.1, [[0, 'rgba(120,92,56,.75)'], [1, 'rgba(120,92,56,0)']]);
  g.save(); g.translate(cx, cy); g.scale(rx / ry, 1); g.translate(-cx, -cy); g.beginPath(); g.arc(cx, cy, ry * 1.1, 0, 6.3); g.fill(); g.restore();
}
function shadow(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, a = 0.3) {
  g.fillStyle = `rgba(10,14,6,${a})`; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, 6.3); g.fill();
}

// ------------------------------------------------------------------ nature sprites (128px canvases, base at bottom centre)
export interface Sprite { c: HTMLCanvasElement; ax: number; ay: number } // anchor in sprite px
function treeOak(autumn: number, v: number): Sprite {
  const [c, g] = mk(128, 150);
  shadow(g, 70, 132, 40, 12);
  g.fillStyle = lg(g, 58, 0, 74, 0, [[0, '#4b3320'], [1, '#6a4a2e']]); g.beginPath(); g.moveTo(58, 134); g.lineTo(62, 84); g.lineTo(70, 84); g.lineTo(76, 134); g.fill();
  const pal = [['#7bbf4a', '#2f6a2a'], ['#e9a23a', '#9a4a1c'], ['#d96a2c', '#7a2c18'], ['#b6c24a', '#5a6a1e']][autumn];
  const pts: [number, number, number][] = [[46, 80, 28], [84, 78, 30], [64, 58, 34], [40, 56, 22], [90, 54, 22], [64, 36, 26]];
  for (const [x, y, r] of pts) blob(g, x + (v % 3) * 1.5, y, r, pal[0], pal[1]);
  g.fillStyle = 'rgba(255,255,220,.18)'; for (const [x, y, r] of pts.slice(2)) { g.beginPath(); g.arc(x - r * 0.3, y - r * 0.4, r * 0.4, 0, 6.3); g.fill(); }
  g.fillStyle = 'rgba(0,0,0,.14)'; g.beginPath(); g.ellipse(70, 92, 34, 14, 0, 0, 6.3); g.fill();
  return { c, ax: 64, ay: 132 };
}
function treePine(v: number): Sprite {
  const [c, g] = mk(128, 160);
  shadow(g, 66, 142, 30, 10);
  g.fillStyle = '#5a3d25'; g.fillRect(60, 120, 10, 22);
  for (let i = 0; i < 4; i++) {
    const y = 120 - i * 26, wd = 46 - i * 8 + (v % 2) * 2;
    g.fillStyle = lg(g, 64 - wd, 0, 64 + wd, 0, [[0, '#2d6a3c'], [0.55, '#2a5a35'], [1, '#17402a']]);
    g.beginPath(); g.moveTo(64, y - 40); g.lineTo(64 + wd, y + 4); g.lineTo(64 - wd, y + 4); g.closePath(); g.fill();
    g.fillStyle = 'rgba(160,220,150,.22)'; g.beginPath(); g.moveTo(64, y - 40); g.lineTo(64 - wd * 0.6, y - 8); g.lineTo(64 - wd * 0.15, y - 12); g.closePath(); g.fill();
  }
  return { c, ax: 64, ay: 142 };
}
function treeBirch(): Sprite {
  const [c, g] = mk(128, 150);
  shadow(g, 66, 134, 30, 10);
  g.fillStyle = '#e8e4d8'; g.beginPath(); g.moveTo(58, 134); g.lineTo(61, 70); g.lineTo(69, 70); g.lineTo(72, 134); g.fill();
  g.fillStyle = '#3a3a34'; for (let i = 0; i < 6; i++) g.fillRect(60 + (i % 2) * 6, 78 + i * 9, 5, 2);
  for (const [x, y, r] of [[48, 66, 20], [82, 64, 22], [64, 46, 28], [44, 40, 16], [86, 40, 16], [64, 22, 20]] as [number, number, number][]) blob(g, x, y, r, '#f3d86a', '#b88a1e');
  return { c, ax: 64, ay: 134 };
}
function snowCaps(base: Sprite): Sprite {
  const [c, g] = mk(base.c.width, base.c.height);
  g.drawImage(base.c, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#f2f7ff'; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-out';
  // erase the lower 55% progressively so only upper surfaces keep snow
  const gr = g.createLinearGradient(0, base.ay * 0.2, 0, base.ay * 0.85); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  return { c, ax: base.ax, ay: base.ay };
}
function bush(full: boolean): Sprite {
  const [c, g] = mk(96, 80);
  shadow(g, 50, 62, 32, 9);
  for (const [x, y, r] of [[32, 46, 16], [62, 46, 17], [47, 34, 19], [47, 52, 13]] as [number, number, number][]) blob(g, x, y, r, '#6fb04a', '#2e6a2c');
  if (full) for (let i = 0; i < 11; i++) { const a = i * 2.4, rr = 8 + (i % 4) * 5; const x = 47 + Math.cos(a) * rr * 1.3, y = 40 + Math.sin(a) * rr * 0.9; g.fillStyle = '#d83a3a'; g.beginPath(); g.arc(x, y, 3.4, 0, 6.3); g.fill(); g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(x - 1, y - 1, 1, 0, 6.3); g.fill(); }
  return { c, ax: 48, ay: 62 };
}
function rock(v: number): Sprite {
  const [c, g] = mk(96, 80);
  shadow(g, 50, 62, 34, 10);
  const defs = [[[30, 56, 18, 14], [58, 56, 22, 18], [44, 44, 16, 14]], [[36, 56, 24, 18], [64, 58, 14, 10]], [[28, 56, 14, 12], [50, 56, 20, 22], [70, 58, 13, 10]]][v % 3];
  for (const [x, y, rx, ry] of defs) {
    g.fillStyle = lg(g, x - rx, y - ry, x + rx, y + ry, [[0, '#b5b6bf'], [0.5, '#80828c'], [1, '#52545e']]);
    g.beginPath(); g.moveTo(x - rx, y); g.lineTo(x - rx * 0.6, y - ry); g.lineTo(x + rx * 0.3, y - ry * 1.15); g.lineTo(x + rx, y - ry * 0.3); g.lineTo(x + rx * 0.8, y); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x - rx * 0.6, y - ry); g.lineTo(x + rx * 0.3, y - ry * 1.15); g.lineTo(x, y - ry * 0.5); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,30,40,.5)'; g.lineWidth = 1.2; g.stroke();
  }
  return { c, ax: 48, ay: 62 };
}

// ------------------------------------------------------------------ buildings (64px per tile)
const U = 64;
export const BUILD_PAD = { l: 20, r: 28, t: 64, b: 24 };
const TEAM = { 0: '#27b7c6', 1: '#d84a36', 2: '#999' } as const;

function pennant(g: CanvasRenderingContext2D, x: number, y: number, col: string, len = 26) {
  g.strokeStyle = '#5a3d25'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y + len); g.lineTo(x, y); g.stroke();
  g.fillStyle = col; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 20, y + 5); g.lineTo(x, y + 11); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
}
function log(g: CanvasRenderingContext2D, x: number, y: number, len: number, r: number) {
  g.fillStyle = lg(g, 0, y - r, 0, y + r, [[0, '#a87a4a'], [0.5, '#7a5230'], [1, '#4e3320']]);
  g.beginPath(); g.roundRect(x, y - r, len, r * 2, r); g.fill();
  g.fillStyle = '#c9a070'; g.beginPath(); g.ellipse(x + len - r * 0.4, y, r * 0.55, r, 0, 0, 6.3); g.fill();
  g.strokeStyle = '#6a4526'; g.lineWidth = 1; g.beginPath(); g.ellipse(x + len - r * 0.4, y, r * 0.3, r * 0.55, 0, 0, 6.3); g.stroke();
}
function standingStone(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number) {
  shadow(g, x + hh * 0.25, y + 3, w * 0.9, 5, 0.3);
  g.fillStyle = lg(g, x - w, 0, x + w, 0, [[0, '#b9bbc2'], [0.6, '#8b8d97'], [1, '#5a5c68']]);
  g.beginPath(); g.moveTo(x - w, y); g.lineTo(x - w * 0.8, y - hh * 0.85); g.lineTo(x - w * 0.1, y - hh); g.lineTo(x + w * 0.8, y - hh * 0.8); g.lineTo(x + w, y); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(25,25,35,.5)'; g.lineWidth = 1.2; g.stroke();
}

export function buildingSprite(kind: BuildingKind, owner: 0 | 1, wt: number, ht: number): Sprite {
  const P = BUILD_PAD, W = wt * U, Hh = ht * U;
  const [c, g] = mk(W + P.l + P.r, Hh + P.t + P.b);
  g.translate(P.l, P.t);
  const team = TEAM[owner];
  const cx = W / 2, cy = Hh / 2;
  if (kind !== 'palisade') ground(g, cx, cy + 6, W * 0.58, Hh * 0.5);
  switch (kind) {
    case 'hearth': {
      shadow(g, cx + 6, cy + 8, 74, 56, 0.2);
      for (const a of [0.5, 2.6, 4.7]) { g.save(); g.translate(cx + Math.cos(a) * 66, cy + 6 + Math.sin(a) * 54); g.rotate(a + 1.5); log(g, -22, 0, 44, 7); g.restore(); }
      g.fillStyle = '#2b2622'; g.beginPath(); g.ellipse(cx, cy + 4, 46, 36, 0, 0, 6.3); g.fill();
      for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.283; const sx = cx + Math.cos(a) * 46, sy = cy + 4 + Math.sin(a) * 36; blob(g, sx, sy, 10 + (i % 3) * 1.5, '#c4c5cc', '#6c6e7a'); }
      g.fillStyle = rg(g, cx, cy + 4, 4, 34, [[0, '#6a2a10'], [0.6, '#2a1a12'], [1, '#1a1410']]); g.beginPath(); g.ellipse(cx, cy + 4, 34, 26, 0, 0, 6.3); g.fill();
      g.strokeStyle = '#5a3d25'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 70, cy - 28); g.lineTo(cx - 70, cy + 16); g.moveTo(cx + 70, cy - 28); g.lineTo(cx + 70, cy + 16); g.stroke();
      pennant(g, 14, 6, team, 34);
      break;
    }
    case 'shelter': {
      shadow(g, cx + 16, Hh - 8, 52, 14, 0.28);
      g.fillStyle = lg(g, 0, 0, W, 0, [[0, '#d2a874'], [0.5, '#b9885a'], [1, '#7f5a38']]);
      g.beginPath(); g.moveTo(cx, -26); g.lineTo(W - 6, Hh - 12); g.quadraticCurveTo(cx, Hh + 2, 6, Hh - 12); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(70,45,25,.55)'; g.lineWidth = 1.6;
      for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(cx, -26); g.quadraticCurveTo(cx + (i - 2.5) * 18, Hh * 0.5, 6 + (W - 12) * (i / 5), Hh - 6); g.stroke(); }
      g.fillStyle = '#20150e'; g.beginPath(); g.moveTo(cx - 14, Hh - 6); g.quadraticCurveTo(cx, 40, cx + 14, Hh - 6); g.closePath(); g.fill();
      g.strokeStyle = '#5a3d25'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 3, -26); g.lineTo(cx - 8, -40); g.moveTo(cx + 3, -26); g.lineTo(cx + 8, -40); g.stroke();
      pennant(g, cx + 8, -58, team, 22);
      break;
    }
    case 'stockpile': {
      shadow(g, cx + 6, cy + 18, 54, 18, 0.28);
      for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) log(g, 14 + i * 28 + r * 14, Hh - 20 - r * 13, 52, 7);
      blob(g, W - 22, Hh - 28, 13, '#c4a07a', '#7a5a3a'); blob(g, W - 38, Hh - 18, 10, '#b89468', '#6f5033');
      for (const [x, y, s] of [[22, 30, 11], [44, 38, 9]] as [number, number, number][]) blob(g, x, y, s, '#aeb0b8', '#60626e');
      break;
    }
    case 'toolshelter': {
      shadow(g, cx + 14, Hh - 6, 52, 12, 0.28);
      g.strokeStyle = '#5a3d25'; g.lineWidth = 5; g.beginPath(); g.moveTo(14, Hh - 6); g.lineTo(14, 36); g.moveTo(W - 14, Hh - 6); g.lineTo(W - 14, 36); g.stroke();
      g.fillStyle = lg(g, 0, 0, 0, 60, [[0, '#d7b56a'], [1, '#a07a38']]); g.beginPath(); g.moveTo(-4, 46); g.lineTo(18, -6); g.lineTo(W + 4, -6); g.lineTo(W - 4, 50); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(90,60,20,.5)'; g.lineWidth = 1.4; for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(-2 + i * 20, 46 - i * 3); g.lineTo(20 + i * 18, -6); g.stroke(); }
      g.fillStyle = lg(g, 0, 70, 0, 100, [[0, '#9a9ca6'], [1, '#5a5c68']]); g.beginPath(); g.roundRect(26, 84, 76, 26, 6); g.fill();
      g.strokeStyle = '#5a3d25'; g.lineWidth = 4; g.beginPath(); g.moveTo(40, 96); g.lineTo(74, 80); g.stroke(); g.fillStyle = '#8b8d97'; g.beginPath(); g.moveTo(70, 76); g.lineTo(88, 74); g.lineTo(76, 88); g.fill();
      pennant(g, W - 10, -14, team, 22);
      break;
    }
    case 'lodge': {
      shadow(g, cx + 14, Hh - 4, 90, 16, 0.28);
      g.fillStyle = lg(g, 0, 0, 0, Hh, [[0, '#d2ad66'], [0.55, '#b08a46'], [1, '#6e5028']]);
      g.beginPath(); g.moveTo(-6, Hh - 6); g.lineTo(10, 6); g.quadraticCurveTo(cx, -22, W - 10, 6); g.lineTo(W + 6, Hh - 6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(80,55,20,.5)'; g.lineWidth = 1.4; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(8 + i * 15, 4); g.lineTo(i * 16 - 4, Hh - 8); g.stroke(); }
      g.fillStyle = '#4e3a22'; g.beginPath(); g.moveTo(cx - 20, Hh - 6); g.lineTo(cx - 14, 52); g.lineTo(cx + 14, 52); g.lineTo(cx + 20, Hh - 6); g.fill();
      g.fillStyle = '#20150e'; g.beginPath(); g.moveTo(cx - 12, Hh - 6); g.lineTo(cx - 9, 58); g.lineTo(cx + 9, 58); g.lineTo(cx + 12, Hh - 6); g.fill();
      g.strokeStyle = '#e6dcc4'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 22, 26); g.lineTo(cx - 8, 6); g.moveTo(cx - 18, 24); g.lineTo(cx - 14, 14); g.moveTo(cx + 22, 26); g.lineTo(cx + 8, 6); g.moveTo(cx + 18, 24); g.lineTo(cx + 14, 14); g.stroke();
      pennant(g, W - 8, -12, team, 24);
      break;
    }
    case 'circle': {
      shadow(g, cx + 6, cy + 10, 82, 62, 0.14);
      for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.283 + 0.3; standingStone(g, cx + Math.cos(a) * 76, cy + 18 + Math.sin(a) * 58, 12 + (i % 3) * 2, 42 + (i % 4) * 5); }
      g.fillStyle = '#2b2622'; g.beginPath(); g.ellipse(cx, cy + 14, 22, 15, 0, 0, 6.3); g.fill();
      for (let i = 0; i < 8; i++) { const a = i * 0.8; blob(g, cx + Math.cos(a) * 22, cy + 14 + Math.sin(a) * 15, 5, '#b9bbc2', '#6c6e7a'); }
      pennant(g, cx, cy - 22, team, 30);
      break;
    }
    case 'rack': {
      shadow(g, cx + 12, Hh - 10, 48, 11, 0.26);
      g.strokeStyle = '#5a3d25'; g.lineWidth = 5; g.beginPath(); g.moveTo(22, Hh - 8); g.lineTo(40, 22); g.moveTo(W - 22, Hh - 8); g.lineTo(W - 40, 22); g.moveTo(34, 26); g.lineTo(W - 34, 26); g.stroke();
      for (let i = 0; i < 6; i++) { const x = 40 + i * 9; g.fillStyle = lg(g, x, 0, x + 6, 0, [[0, '#a8452e'], [1, '#6a2a1c']]); g.beginPath(); g.moveTo(x, 28); g.quadraticCurveTo(x - 3, 54, x + 1, 76 - (i % 3) * 5); g.quadraticCurveTo(x + 7, 56, x + 6, 28); g.fill(); }
      g.fillStyle = '#2b2622'; g.beginPath(); g.ellipse(cx, Hh - 12, 26, 9, 0, 0, 6.3); g.fill();
      g.fillStyle = '#ff9a2e'; g.beginPath(); g.ellipse(cx, Hh - 13, 12, 4, 0, 0, 6.3); g.fill();
      break;
    }
    case 'watch': {
      shadow(g, cx + 40, Hh - 2, 56, 10, 0.3);
      g.fillStyle = 'rgba(10,14,6,.2)'; g.beginPath(); g.moveTo(cx - 16, Hh - 4); g.lineTo(cx + 78, Hh + 12); g.lineTo(cx + 62, Hh + 14); g.lineTo(cx + 10, Hh - 2); g.fill();
      g.strokeStyle = '#6a4526'; g.lineWidth = 6; g.beginPath(); g.moveTo(20, Hh - 6); g.lineTo(40, -30); g.moveTo(W - 20, Hh - 6); g.lineTo(W - 40, -30); g.stroke();
      g.lineWidth = 3.5; g.beginPath(); g.moveTo(26, Hh - 40); g.lineTo(W - 26, Hh - 70); g.moveTo(W - 26, Hh - 40); g.lineTo(26, Hh - 70); g.moveTo(18, 70); g.lineTo(W - 18, 70); g.stroke();
      g.fillStyle = lg(g, 0, -40, 0, -10, [[0, '#a87a4a'], [1, '#6a4526']]); g.beginPath(); g.roundRect(24, -42, W - 48, 26, 4); g.fill();
      g.strokeStyle = '#4e3320'; g.lineWidth = 3; for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(26 + i * 18, -42); g.lineTo(26 + i * 18, -62); g.stroke(); }
      g.beginPath(); g.moveTo(24, -62); g.lineTo(W - 24, -62); g.stroke();
      pennant(g, cx, -84, team, 28);
      break;
    }
    case 'palisade': {
      shadow(g, cx + 8, Hh - 4, 28, 6, 0.3);
      for (let i = 0; i < 4; i++) {
        const x = 6 + i * 13;
        g.fillStyle = lg(g, x, 0, x + 12, 0, [[0, '#a87a4a'], [0.6, '#7a5230'], [1, '#4e3320']]);
        g.beginPath(); g.moveTo(x, Hh - 2); g.lineTo(x, 12); g.lineTo(x + 6, -6); g.lineTo(x + 12, 12); g.lineTo(x + 12, Hh - 2); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(30,18,8,.5)'; g.lineWidth = 1; g.stroke();
      }
      g.strokeStyle = '#d6c08a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(4, 30); g.lineTo(W - 4, 30); g.stroke();
      break;
    }
  }
  return { c, ax: P.l, ay: P.t };
}

// ------------------------------------------------------------------ registry
export class Art {
  trees: Sprite[] = []; treeSnow: Sprite[] = [];
  bushFull = bush(true); bushEmpty = bush(false);
  rocks = [rock(0), rock(1), rock(2)];
  private b = new Map<string, Sprite>();
  constructor() {
    this.trees = [treeOak(0, 0), treeOak(1, 1), treePine(0), treeBirch(), treeOak(2, 2), treePine(1), treeOak(0, 3), treeOak(3, 4)];
    this.treeSnow = this.trees.map(snowCaps);
  }
  building(kind: BuildingKind, owner: 0 | 1, w: number, h: number) {
    const k = `${kind}${owner}`; let s = this.b.get(k);
    if (!s) { s = buildingSprite(kind, owner, w, h); this.b.set(k, s); }
    return s;
  }
}
