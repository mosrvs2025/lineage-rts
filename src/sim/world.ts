import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { findPath, isBlocked, rebuildBlocked, nearestFree } from './grid';
import type { Building, BuildingKind, Owner, ResNode, Species, Unit, UnitKind, World } from './types';
import { FIGHTERS } from './rules';
import { MAPS } from '../data/maps';
import { SPECIES } from '../data/species';
import { bCenter, rand, reindex } from './util';
import { generateTerrain } from './mapgen';
import type { MapDef } from '../data/maps';

export const SAVE_VERSION = 1;
/** Where the Far Meadow victory outpost goes on this map. */
export const meadowOf = (w: World) => w.landmarks.find((l) => l.id === 'meadow') ?? { x: 66, y: 8 };
export const OUTPOST_REQUIRE = 60; // provisions that must be in stock to claim the Far Meadow
export const OUTPOST_COST = 35;    // provisions spent on the outpost

const NAMES = ['Ara', 'Bek', 'Cor', 'Dun', 'Eda', 'Fen', 'Gar', 'Hul', 'Ima', 'Jor', 'Kes', 'Lor', 'Mar', 'Nem', 'Ora',
  'Pek', 'Quo', 'Rul', 'Sef', 'Tam', 'Uma', 'Vek', 'Wen', 'Yar', 'Zul', 'Brin', 'Dova', 'Hesk', 'Ilo', 'Kuro'];

export function makeUnit(w: World, kind: UnitKind, owner: Owner, x: number, y: number): Unit {
  const d = UNITS[kind];
  let maxHp = d.hp;
  const sp: Species = owner === 0 ? w.species : w.rivalSpecies;
  const hb = owner !== 2 ? SPECIES[sp].hp : undefined;
  if (hb && hb.kinds.includes(kind)) maxHp = Math.round(maxHp * hb.mult);
  if (owner === 0 && w.techs?.leather && FIGHTERS.includes(kind)) maxHp = Math.round(maxHp * 1.2);
  const u: Unit = {
    id: w.nextId++, kind, owner,
    name: owner === 2 ? d.name : NAMES[Math.floor(rand(w) * NAMES.length)],
    x, y, ox: x, oy: y, hp: maxHp, maxHp,
    order: { t: 'idle' }, path: null, pcd: 0, ptx: 0, pty: 0, cd: 0,
    carry: { res: null, n: 0 }, work: 0, tgt: -1, home: { x, y }, role: 'none',
    gen: w.gen, born: w.time, ability: 0, buff: 0, kills: 0,
  };
  w.units.push(u); w._u?.set(u.id, u);
  return u;
}

export function makeBuilding(w: World, kind: BuildingKind, owner: Owner, tx: number, ty: number, done: boolean): Building {
  const d = BUILDINGS[kind];
  const b: Building = {
    id: w.nextId++, kind, owner, x: tx, y: ty, w: d.w, h: d.h,
    hp: done ? d.hp : Math.max(1, d.hp * 0.1), maxHp: d.hp, progress: done ? 1 : 0, done,
    queue: [], tick: 0, tier: 0,
  };
  w.buildings.push(b); w._b?.set(b.id, b);
  return b;
}

export function makeNode(w: World, kind: ResNode['kind'], tx: number, ty: number, amount?: number): ResNode {
  const def = {
    tree: { res: 'wood' as const, amt: 80, regen: 0 },
    bush: { res: 'food' as const, amt: 100, regen: 0.5 },
    rock: { res: 'stone' as const, amt: 220, regen: 0 },
    carcass: { res: 'food' as const, amt: 70, regen: 0 },
    fish: { res: 'food' as const, amt: 60, regen: 0.35 },
  }[kind];
  const n: ResNode = { id: w.nextId++, kind, res: def.res, x: tx, y: ty, amount: amount ?? def.amt, max: amount ?? def.amt, regen: def.regen };
  w.nodes.push(n); w._n?.set(n.id, n);
  return n;
}

/** Free spot just outside a building, for spawning units. */
export function spawnSpot(w: World, b: Building): { x: number; y: number } {
  const c = bCenter(b), pref = nearestFree(w, c.x, b.y + b.h + 0.6, 6);
  // prefer a spot units can actually walk away from (not a sealed ledge behind the building)
  const home = w.buildings.find((o) => o.owner === b.owner && o.kind === 'hearth' && o.done && o !== b);
  if (!home) return pref;
  const goal = nearestFree(w, home.x + 1.5, home.y + home.h + 0.8, 6);
  const ok = (p: { x: number; y: number }) => !!findPath(w, p.x, p.y, goal.x, goal.y, undefined, false);
  if (ok(pref)) return pref;
  const ring: { x: number; y: number }[] = [];
  for (let x = b.x - 1; x <= b.x + b.w; x++) ring.push({ x: x + 0.5, y: b.y - 0.5 }, { x: x + 0.5, y: b.y + b.h + 0.5 });
  for (let y = b.y; y < b.y + b.h; y++) ring.push({ x: b.x - 0.5, y: y + 0.5 }, { x: b.x + b.w + 0.5, y: y + 0.5 });
  ring.sort((p, q) => Math.hypot(p.x - pref.x, p.y - pref.y) - Math.hypot(q.x - pref.x, q.y - pref.y));
  for (const p of ring) if (!isBlocked(w, Math.floor(p.x), Math.floor(p.y)) && ok(p)) return p;
  return pref;
}

export function createWorld(species: Species, seed = 1337, mapId = 'valley', rival?: Species): World {
  const W = 72, H = 48;
  const M = MAPS[mapId] ?? MAPS.valley;
  const w: World = {
    v: SAVE_VERSION, seed, rng: seed, tick: 0, time: 0, gen: 1, species,
    rivalSpecies: rival && rival !== species ? rival : SPECIES[species].rival, map: M.id, pass: { x: M.pass.x + 0.5, y: M.pass.y + 1.5 },
    W, H, terrain: [], nextId: 1, units: [], buildings: [], nodes: [],
    res: { ...M.start, knowledge: 5, provisions: 0 },
    stats: { food: 0, meat: 0, kills: 0, lost: 0, spoiled: 0 },
    disc: { cooking: 'hidden', preservation: 'hidden', portable: 'hidden', heat: 'hidden' },
    techs: {},
    activities: [], explored: '0'.repeat(W * H),
    landmarks: [
      { id: 'cave', name: 'Ember Cave', x: M.cave.x, y: M.cave.y, visited: false },
      { id: 'meadow', name: 'Far Meadow', x: M.meadow.x, y: M.meadow.y, visited: false },
    ],
    ai: { supply: 30, nextSpawn: 20, nextRaid: 210, raids: 0, lastRaidMsg: -999 },
    winter: { ...M.winter },
    trait: 'founder', lineage: [], done: {}, status: 'playing', endMsg: '',
    truceUntil: 0, hungerT: 0, log: [],
  };
  reindex(w);

  // ---- terrain
  w.terrain = generateTerrain(M, W, H);

  // ---- starting settlement
  const P = M.player, R = M.rival;
  makeBuilding(w, 'hearth', 0, P.x, P.y, true);
  makeBuilding(w, 'shelter', 0, P.x - 4, P.y - 4, true);
  makeBuilding(w, 'shelter', 0, P.x - 4, P.y + 5, true);
  // rival clan: home camp + the forward post
  makeBuilding(w, 'hearth', 1, R.x, R.y, true);
  makeBuilding(w, 'shelter', 1, R.x - 4, R.y - 3, true);
  makeBuilding(w, 'shelter', 1, R.x + 5, R.y - 3, true);
  makeBuilding(w, 'watch', 1, M.pass.x, M.pass.y, true);

  // ---- resources
  const used = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  // routes between camps and landmarks stay clear of resources, so a forest never seals a canyon or a causeway
  const reserved = new Set<string>();
  if (!M.hand) reserveRoutes(w, M, reserved);
  const nearStart = (x: number, y: number) => Math.hypot(x - (P.x + 1.5), y - (P.y + 1.5)) < 5.5 || Math.hypot(x - (R.x + 1.5), y - (R.y + 1.5)) < 5;
  const okTile = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
    if (w.terrain[y][x] !== '.' || used.has(key(x, y)) || reserved.has(key(x, y)) || nearStart(x, y)) return false;
    for (const l of w.landmarks) if (Math.hypot(x - l.x, y - l.y) < 2.5) return false;
    if (Math.hypot(x - M.pass.x, y - M.pass.y) < 4) return false;                       // keep the forward post open
    if (M.gen === 'valley' && Math.abs(x - 43) < 4 && y >= 20 && y <= 26) return false; // keep the pass open
    return true;
  };
  const cluster = (cx: number, cy: number, r: number, p: number, kind: ResNode['kind']) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      if (!okTile(x, y) || rand(w) > p) continue;
      used.add(key(x, y)); makeNode(w, kind, x, y);
    }
  };
  if (M.hand) {
    M.hand.trees.forEach(([x, y, r]) => cluster(x, y, r, M.hand!.treeP, 'tree'));
    M.hand.rocks.forEach(([x, y, r]) => cluster(x, y, r, 0.8, 'rock'));
    for (const [x, y] of M.hand.bushes) if (okTile(x, y)) { used.add(key(x, y)); makeNode(w, 'bush', x, y); }
  } else scatter(w, M, okTile, cluster, used);

  rebuildBlocked(w);

  // ---- people
  const hs = nearestFree(w, P.x + 1.5, P.y + 4.6);
  const leader = makeUnit(w, 'leader', 0, hs.x, hs.y);
  leader.name = SPECIES[species].leader;
  w.lineage.push({ name: leader.name, gen: 1, trait: 'Founder' });
  for (let i = 0; i < 5; i++) makeUnit(w, 'gatherer', 0, hs.x - 2 + i, hs.y + 0.8);
  makeUnit(w, 'hunter', 0, hs.x + 2.5, hs.y - 0.5);
  makeUnit(w, 'scout', 0, hs.x - 2.5, hs.y - 0.5);

  // ---- rival garrison at the forward post + a few at home
  const rh = nearestFree(w, R.x + 2, R.y + 4);
  const px = M.pass.x + 1.5, py = M.pass.y + 2;
  for (let i = 0; i < 3; i++) { const g = makeUnit(w, 'guard', 1, px + (i % 2), py + i * 0.8); g.role = 'garrison'; g.home = { x: g.x, y: g.y }; }
  { const h = makeUnit(w, 'hunter', 1, px, py - 1.8); h.role = 'garrison'; h.home = { x: h.x, y: h.y }; }
  for (let i = 0; i < 2; i++) makeUnit(w, 'raider', 1, rh.x + i, rh.y);

  // ---- wildlife
  if (M.hand) {
    for (const [x, y, n] of M.hand.deer) for (let i = 0; i < n; i++) { const p = nearestFree(w, x + i * 1.3, y + (i % 2)); makeUnit(w, 'deer', 2, p.x, p.y); }
    for (const [x, y, n] of M.hand.wolves) for (let i = 0; i < n; i++) { const p = nearestFree(w, x + i, y); const u = makeUnit(w, 'wolf', 2, p.x, p.y); u.home = { x, y }; }
  }
  rebuildBlocked(w);
  for (const u of w.units) { const p = nearestFree(w, u.x, u.y); u.x = u.ox = p.x; u.y = u.oy = p.y; if (u.role === 'garrison') u.home = { x: u.x, y: u.y }; }
  w.units.filter((u) => u.kind === 'wolf' || u.kind === 'mammoth').forEach((u) => (u.home = { x: u.x, y: u.y }));
  return w;
}

/** Mark the tiles along walkable routes between the camps and landmarks (plus a margin) as reserved. */
function reserveRoutes(w: World, M: MapDef, reserved: Set<string>) {
  const W = w.W, H = w.H, walk = (x: number, y: number) => { const c = w.terrain[y]?.[x]; return c === '.' || c === '='; };
  const nearest = (p: { x: number; y: number }): [number, number] => {
    for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy; if (walk(x, y)) return [x, y]; }
    return [Math.floor(p.x), Math.floor(p.y)];
  };
  const route = (a: [number, number], b: [number, number]) => {
    const prev = new Map<number, number>(), q = [a[1] * W + a[0]]; prev.set(q[0], -1);
    for (let i = 0; i < q.length; i++) {
      const cur = q[i], cx = cur % W, cy = (cur / W) | 0;
      if (cx === b[0] && cy === b[1]) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || prev.has(k) || !walk(nx, ny)) continue;
        prev.set(k, cur); q.push(k);
      }
    }
    const out: [number, number][] = []; let k: number | undefined = b[1] * W + b[0];
    if (!prev.has(k)) return out;
    while (k !== undefined && k >= 0) { out.push([k % W, (k / W) | 0]); k = prev.get(k); }
    return out;
  };
  const ps = nearest({ x: M.player.x + 1, y: M.player.y + 4 }), rs = nearest({ x: M.rival.x + 1, y: M.rival.y + 4 });
  for (const t of [rs, nearest(M.meadow), nearest(M.cave), nearest(M.stage), nearest(M.pass)]) for (const [x, y] of route(ps, t)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add(`${x + dx},${y + dy}`);
  for (const [x, y] of route(rs, nearest(M.meadow))) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) reserved.add(`${x + dx},${y + dy}`);
}

/** Procedural resource and wildlife placement for maps without a hand-authored layout. */
function scatter(w: World, M: MapDef, okTile: (x: number, y: number) => boolean, cluster: (cx: number, cy: number, r: number, p: number, kind: ResNode['kind']) => void, used: Set<string>) {
  const A = M.auto!, W = w.W, H = w.H, P = M.player, R = M.rival;
  const land: [number, number][] = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if (w.terrain[y][x] === '.') land.push([x, y]);
  const pick = (ok: (x: number, y: number) => boolean, tries = 400): [number, number] | null => {
    for (let t = 0; t < tries; t++) { const [x, y] = land[Math.floor(rand(w) * land.length)]; if (ok(x, y)) return [x, y]; }
    return null;
  };
  const dP = (x: number, y: number) => Math.hypot(x - P.x, y - P.y), dR = (x: number, y: number) => Math.hypot(x - R.x, y - R.y);
  const centres: [number, number][] = [];
  const apart = (x: number, y: number, d: number) => centres.every(([a, b]) => Math.hypot(a - x, b - y) >= d);
  const nearRock = (x: number, y: number) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (w.terrain[y + dy]?.[x + dx] === '^') return true; return false; };
  // a fair start: timber, stone and berries close to home
  for (const [lo, hi] of [[7, 14], [9, 16]]) { const s = pick((x, y) => dP(x, y) >= lo && dP(x, y) <= hi && okTile(x, y) && apart(x, y, 6)); if (s) { centres.push(s); cluster(s[0], s[1], 3.2, 0.66, 'tree'); } }
  { const s = pick((x, y) => dP(x, y) >= 7 && dP(x, y) <= 15 && okTile(x, y) && apart(x, y, 4)); if (s) { centres.push(s); cluster(s[0], s[1], 1.8, 0.85, 'rock'); } }
  for (let i = 0; i < (A.homeBushes ?? 7); i++) { const s = pick((x, y) => dP(x, y) >= 5 && dP(x, y) <= 14 && okTile(x, y)); if (s) { used.add(`${s[0]},${s[1]}`); makeNode(w, 'bush', s[0], s[1]); } }
  // the rest of the map
  for (let i = 0; i < A.trees; i++) { const s = pick((x, y) => okTile(x, y) && apart(x, y, 7)); if (s) { centres.push(s); cluster(s[0], s[1], 2.2 + rand(w) * 2, 0.62, 'tree'); } }
  for (let i = 0; i < A.rocks; i++) { const s = pick((x, y) => okTile(x, y) && nearRock(x, y) && apart(x, y, 5), 600) ?? pick((x, y) => okTile(x, y) && apart(x, y, 5)); if (s) { centres.push(s); cluster(s[0], s[1], 1.3 + rand(w) * 1.2, 0.8, 'rock'); } }
  for (let i = 0; i < A.bushes; i++) { const s = pick((x, y) => okTile(x, y)); if (s) { used.add(`${s[0]},${s[1]}`); makeNode(w, 'bush', s[0], s[1]); } }
  rebuildBlocked(w);
  const place = (kind: UnitKind, x: number, y: number) => { const p = nearestFree(w, x, y); const u = makeUnit(w, kind, 2, p.x, p.y); u.home = { x: p.x, y: p.y }; return u; };
  for (let i = 0; i < (A.homeDeer ?? 0); i++) { const s = pick((x, y) => dP(x, y) >= 9 && dP(x, y) <= 20 && Math.hypot(x - P.x, y - P.y) > 0); if (s) for (let k = 0; k < 3; k++) { const p = nearestFree(w, s[0] + k * 1.2, s[1] + (k % 2)); place('deer', p.x, p.y); } }
  for (let i = 0; i < A.deer; i++) { const s = pick((x, y) => dP(x, y) >= 11 && dR(x, y) >= 9); if (s) for (let k = 0; k < 3; k++) place('deer', s[0] + k * 1.2, s[1] + (k % 2)); }
  for (let i = 0; i < A.wolves; i++) { const s = pick((x, y) => dP(x, y) >= 22 && dR(x, y) >= 10); if (s) for (let k = 0; k < 2; k++) place('wolf', s[0] + k, s[1]); }
  // mammoths graze the middle of the map, a few wander the lanes
  for (let i = 0; i < (A.mammoths ?? 0); i++) { const clear = (x: number, y: number) => !w.nodes.some((n) => n.kind === 'tree' && Math.hypot(n.x - x, n.y - y) < 3.4); const s = pick((x, y) => clear(x, y) && (i < 3 ? Math.hypot(x - W / 2, y - H / 2) < 8 : dP(x, y) >= 16 && dR(x, y) >= 12), 800); if (s) place('mammoth', s[0], s[1]); }
  // fishing spots: coastal water next to walkable ground (fish cannot be fenced off, they are food that never runs out)
  if (A.fish) {
    const coast: [number, number][] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = w.terrain[y][x]; if (c !== '~' && c !== 'L') continue;
      let shore = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.terrain[y + dy]?.[x + dx] === '.') shore = true;
      if (shore) coast.push([x, y]);
    }
    const spots: [number, number][] = [];
    const take = (ok: (x: number, y: number) => boolean) => {
      for (let t = 0; t < 300; t++) { const [x, y] = coast[Math.floor(rand(w) * coast.length)] ?? [0, 0]; if (ok(x, y) && spots.every(([a, b]) => Math.hypot(a - x, b - y) >= 4)) { spots.push([x, y]); makeNode(w, 'fish', x, y); return; } }
    };
    for (let i = 0; i < Math.min(4, A.fish); i++) take((x, y) => dP(x, y) < 16);
    for (let i = 4; i < A.fish; i++) take(() => true);
  }
}
