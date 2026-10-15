/** Map terrain generators. '.' land · '~' deep water · '=' shallows (walkable) · '^' mountain · 'L' lake (water in summer, ice you can walk on in winter). */
import type { MapDef } from '../data/maps';

type G = string[][];
const inb = (g: G, x: number, y: number) => y >= 0 && y < g.length && x >= 0 && x < g[0].length;

function hash(x: number, y: number, s: number) { let n = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
function noise(x: number, y: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** A wobbly ellipse: the edge is perturbed by noise so shores and islands look natural. */
function blob(g: G, ch: string, cx: number, cy: number, rx: number, ry: number, seed = 1, wobble = 0.22, only?: string) {
  for (let y = Math.floor(cy - ry * 1.4); y <= Math.ceil(cy + ry * 1.4); y++) for (let x = Math.floor(cx - rx * 1.4); x <= Math.ceil(cx + rx * 1.4); x++) {
    if (!inb(g, x, y) || (only && g[y][x] !== only)) continue;
    const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
    const wob = 1 + (noise(x * 0.35, y * 0.35, seed) - 0.5) * 2 * wobble;
    if (d <= wob) g[y][x] = ch;
  }
}

/** A thick, slightly meandering line from point to point. */
function carve(g: G, pts: [number, number][], width: number, ch = '.', seed = 3, only?: string) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, r = width / 2 + (noise(x * 0.4, y * 0.4, seed) - 0.5) * 1.1;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const px = Math.floor(x) + dx, py = Math.floor(y) + dy;
        if (inb(g, px, py) && Math.hypot(px + 0.5 - x, py + 0.5 - y) <= r && (!only || g[py][px] === only)) g[py][px] = ch;
      }
    }
  }
}
function rect(g: G, ch: string, x0: number, y0: number, x1: number, y1: number, only?: string) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(g, x, y) && (!only || g[y][x] === only)) g[y][x] = ch;
}
function border(g: G, ch: string) {
  const H = g.length, W = g[0].length;
  for (let x = 0; x < W; x++) { g[0][x] = ch; g[H - 1][x] = ch; }
  for (let y = 0; y < H; y++) { g[y][0] = ch; g[y][W - 1] = ch; }
}

function valley(g: G, M: MapDef) {
  const V = M.valley!, W = g[0].length, H = g.length;
  const riverX = (y: number) => 35 + Math.round(Math.sin(y * V.river.freq + V.river.phase) * V.river.amp);
  for (let y = 0; y < H; y++) {
    const cx = riverX(y), ford = V.fords.some(([a, b]) => y >= a && y <= b);
    for (let x = cx - 1; x <= cx + 1; x++) g[y][x] = ford ? '=' : '~';
  }
  border(g, '^');
  for (const [x0, y0, x1, y1] of V.ridges) rect(g, '^', x0, y0, x1, y1, '.');
  void W;
}

/** Glasswater: a huge lake in the middle; land ring with a northern and southern shore, each pinched by a narrow gap. */
function lake(g: G) {
  blob(g, 'L', 36, 24, 17.5, 11.2, 5, 0.1);
  border(g, '^');
  rect(g, '^', 15, 1, 57, 7, '.');                 // northern rampart: the lake's top edge pinches the north shore lane
  rect(g, '^', 15, 40, 57, 46, '.');               // southern rampart
  blob(g, '^', 29, 8.5, 3.4, 1.8, 8, 0.25, '.');   // jagged teeth narrow the lanes further
  blob(g, '^', 44, 8.5, 3.4, 1.8, 9, 0.25, '.');
  blob(g, '^', 30, 39, 3.4, 1.8, 10, 0.25, '.');
  blob(g, '^', 43, 39, 3.4, 1.8, 11, 0.25, '.');
  blob(g, '^', 56, 24, 2.6, 7, 12, 0.3, '.');      // an eastern spur between the shore routes
  blob(g, '^', 14, 24, 2.4, 6, 13, 0.3, '.');      // a western spur
  for (const [x, y, rx, ry] of [[5, 22, 2.5, 3], [28, 6, 2, 1.6], [46, 41, 2.5, 2], [62, 28, 2, 2.6], [20, 38, 2, 1.8]] as const) blob(g, '^', x, y, rx, ry, 20 + x, 0.3, '.');
}

/** The Isles: everything is water except islands joined by shallow causeways. */
function isles(g: G) {
  for (const row of g) row.fill('~');
  blob(g, '.', 11, 24, 12, 15.5, 31, 0.2);          // home island
  blob(g, '.', 61, 25, 12, 15.5, 32, 0.2);          // rival island
  blob(g, '.', 36, 24, 7.5, 6.5, 33, 0.25);         // central isle
  blob(g, '.', 36, 8.5, 10, 4.2, 34, 0.25);         // north isle
  blob(g, '.', 36, 41, 10, 4.2, 35, 0.25);          // south isle (the cave)
  blob(g, '.', 64, 7, 6.5, 4.6, 36, 0.25);          // far meadow isle
  blob(g, '.', 8, 3.5, 4, 2.4, 37, 0.3);            // little islets with spare timber
  blob(g, '.', 66, 44, 4.5, 2.8, 38, 0.3);
  const cz: [number, number][][] = [
    [[22, 24], [30, 24]], [[42, 24], [50, 24]],       // east–west across the centre
    [[36, 18], [36, 12]], [[36, 30], [36, 37]],       // centre to north / south isles
    [[44, 8.5], [58, 7.5]],                             // north isle to the meadow isle
    [[19, 11], [28, 8]], [[19, 38], [28, 41]],         // home island to north / south isles
    [[66, 20], [64, 11]], [[52, 36], [44, 40]],        // rival island to meadow isle / south isle
    [[12, 9], [9, 5]], [[63, 40], [66, 43]],           // small bridges to the islets
  ];
  for (const seg of cz) carve(g, seg, 3, '=', 41, '~');
}

/** Mammoth Canyon: solid rock with winding canyons, a central basin and dead-end pockets. */
function canyon(g: G) {
  for (const row of g) row.fill('^');
  blob(g, '.', 10, 38, 8.5, 7.5, 51, 0.15);         // home pocket
  blob(g, '.', 61, 10.5, 8.5, 7.5, 52, 0.15);       // rival pocket
  blob(g, '.', 36, 24, 11, 8.5, 53, 0.2);           // the mammoth basin
  blob(g, '.', 8, 8, 4.8, 4.2, 54, 0.2);            // cave pocket
  blob(g, '.', 66, 40, 5.4, 5, 55, 0.2);            // meadow pocket
  const lanes: [number, number][][] = [
    [[16, 38], [22, 36], [26, 31], [30, 27]],                          // home -> basin (south lane)
    [[8, 32], [6, 22], [9, 13], [16, 9], [26, 10], [31, 18]],          // home -> basin (long west lane, passes the cave)
    [[42, 21], [48, 17], [54, 13]],                                    // basin -> rival (north lane)
    [[40, 30], [48, 32], [56, 28], [61, 21], [61, 17]],                // basin -> rival (south-east lane)
    [[36, 31], [40, 39], [52, 43], [60, 42]],                          // basin -> meadow
    [[10, 13], [8, 11]],                                                // into the cave pocket
  ];
  lanes.forEach((l, i) => carve(g, l, i === 4 ? 3.2 : 4.2, '.', 60 + i));
  for (const [x, y, rx, ry] of [[33, 21, 1.6, 1.4], [40, 27, 1.4, 1.6], [36, 26.5, 1.1, 1]] as const) blob(g, '^', x, y, rx, ry, 70 + x, 0.3, '.');   // pillars in the basin
}

/** Build the terrain grid for a map, then guarantee clear ground around camps and landmarks. */
export function generateTerrain(M: MapDef, W: number, H: number): string[] {
  const g: G = Array.from({ length: H }, () => Array(W).fill('.'));
  if (M.gen === 'valley') valley(g, M);
  else if (M.gen === 'lake') lake(g);
  else if (M.gen === 'isles') isles(g);
  else canyon(g);
  const clear = (p: { x: number; y: number }, r: number) => blob(g, '.', p.x + 0.5, p.y + 0.5, r, r, 77, 0.12);
  if (M.gen !== 'valley') { clear(M.player, 6); clear(M.rival, 6); clear(M.cave, 2.6); clear(M.meadow, 3.2); clear(M.pass, 2.4); }
  return g.map((r) => r.join(''));
}
