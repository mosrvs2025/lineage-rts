import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { rebuildBlocked, nearestFree } from './grid';
import type { Building, BuildingKind, Owner, ResNode, Species, Unit, UnitKind, World } from './types';
import { FIGHTERS } from './rules';
import { MAPS } from '../data/maps';
import { SPECIES } from '../data/species';
import { bCenter, rand, reindex } from './util';

export const SAVE_VERSION = 1;
export const MEADOW = { x: 66, y: 8 };
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
  }[kind];
  const n: ResNode = { id: w.nextId++, kind, res: def.res, x: tx, y: ty, amount: amount ?? def.amt, max: amount ?? def.amt, regen: def.regen };
  w.nodes.push(n); w._n?.set(n.id, n);
  return n;
}

/** Free spot just outside a building, for spawning units. */
export function spawnSpot(w: World, b: Building): { x: number; y: number } {
  const c = bCenter(b);
  return nearestFree(w, c.x, b.y + b.h + 0.6, 6);
}

export function createWorld(species: Species, seed = 1337, mapId = 'valley', rival?: Species): World {
  const W = 72, H = 48;
  const M = MAPS[mapId] ?? MAPS.valley;
  const w: World = {
    v: SAVE_VERSION, seed, rng: seed, tick: 0, time: 0, gen: 1, species,
    rivalSpecies: rival && rival !== species ? rival : SPECIES[species].rival, map: M.id,
    W, H, terrain: [], nextId: 1, units: [], buildings: [], nodes: [],
    res: { ...M.start, knowledge: 5, provisions: 0 },
    stats: { food: 0, meat: 0, kills: 0, lost: 0, spoiled: 0 },
    disc: { cooking: 'hidden', preservation: 'hidden', portable: 'hidden', heat: 'hidden' },
    techs: {},
    activities: [], explored: '0'.repeat(W * H),
    landmarks: [
      { id: 'cave', name: 'Ember Cave', x: 18, y: 8, visited: false },
      { id: 'meadow', name: 'Far Meadow', x: MEADOW.x, y: MEADOW.y, visited: false },
    ],
    ai: { supply: 30, nextSpawn: 20, nextRaid: 210, raids: 0, lastRaidMsg: -999 },
    winter: { ...M.winter },
    trait: 'founder', lineage: [], done: {}, status: 'playing', endMsg: '',
    truceUntil: 0, hungerT: 0, log: [],
  };
  reindex(w);

  // ---- terrain
  const grid: string[][] = Array.from({ length: H }, () => Array(W).fill('.'));
  const riverX = (y: number) => 35 + Math.round(Math.sin(y * M.river.freq + M.river.phase) * M.river.amp);
  for (let y = 0; y < H; y++) {
    const cx = riverX(y);
    const ford = M.fords.some(([a, b]) => y >= a && y <= b);
    for (let x = cx - 1; x <= cx + 1; x++) grid[y][x] = ford ? '=' : '~';
  }
  const ridge = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (grid[y]?.[x] === '.') grid[y][x] = '^';
  };
  for (let x = 0; x < W; x++) { grid[0][x] = '^'; grid[H - 1][x] = '^'; }
  for (let y = 0; y < H; y++) { grid[y][0] = '^'; grid[y][W - 1] = '^'; }
  for (const [x0, y0, x1, y1] of M.ridges) ridge(x0, y0, x1, y1);
  w.terrain = grid.map((r) => r.join(''));

  // ---- starting settlement
  makeBuilding(w, 'hearth', 0, 9, 22, true);
  makeBuilding(w, 'shelter', 0, 5, 18, true);
  makeBuilding(w, 'shelter', 0, 5, 27, true);
  // rival clan: home camp + the pass outpost
  makeBuilding(w, 'hearth', 1, 55, 35, true);
  makeBuilding(w, 'shelter', 1, 51, 32, true);
  makeBuilding(w, 'shelter', 1, 60, 32, true);
  makeBuilding(w, 'watch', 1, 43, 22, true);

  // ---- resources
  const used = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const nearStart = (x: number, y: number) => Math.hypot(x - 10.5, y - 23.5) < 5.5 || Math.hypot(x - 56.5, y - 36.5) < 5;
  const okTile = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
    if (w.terrain[y][x] !== '.' || used.has(key(x, y)) || nearStart(x, y)) return false;
    for (const l of w.landmarks) if (Math.hypot(x - l.x, y - l.y) < 2.5) return false;
    if (Math.abs(x - 43) < 4 && y >= 20 && y <= 26) return false; // keep the pass open
    return true;
  };
  const cluster = (cx: number, cy: number, r: number, p: number, kind: ResNode['kind']) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      if (!okTile(x, y) || rand(w) > p) continue;
      used.add(key(x, y)); makeNode(w, kind, x, y);
    }
  };
  M.trees.forEach(([x, y, r]) => cluster(x, y, r, M.treeP, 'tree'));
  M.rocks.forEach(([x, y, r]) => cluster(x, y, r, 0.8, 'rock'));
  for (const [x, y] of M.bushes) if (okTile(x, y)) { used.add(key(x, y)); makeNode(w, 'bush', x, y); }

  rebuildBlocked(w);

  // ---- people
  const hs = nearestFree(w, 10.5, 26.6);
  const leader = makeUnit(w, 'leader', 0, hs.x, hs.y);
  leader.name = SPECIES[species].leader;
  w.lineage.push({ name: leader.name, gen: 1, trait: 'Founder' });
  for (let i = 0; i < 5; i++) makeUnit(w, 'gatherer', 0, hs.x - 2 + i, hs.y + 0.8);
  makeUnit(w, 'hunter', 0, hs.x + 2.5, hs.y - 0.5);
  makeUnit(w, 'scout', 0, hs.x - 2.5, hs.y - 0.5);

  // ---- rival garrison at the pass + a few at home
  const rh = nearestFree(w, 57, 39);
  for (let i = 0; i < 3; i++) { const g = makeUnit(w, 'guard', 1, 44.5 + (i % 2), 24 + i * 0.8); g.role = 'garrison'; g.home = { x: g.x, y: g.y }; }
  { const h = makeUnit(w, 'hunter', 1, 44.5, 22.2); h.role = 'garrison'; h.home = { x: h.x, y: h.y }; }
  for (let i = 0; i < 2; i++) makeUnit(w, 'raider', 1, rh.x + i, rh.y);

  // ---- wildlife
  for (const [x, y, n] of M.deer) {
    for (let i = 0; i < n; i++) { const p = nearestFree(w, x + i * 1.3, y + (i % 2)); makeUnit(w, 'deer', 2, p.x, p.y); }
  }
  for (const [x, y, n] of M.wolves) {
    for (let i = 0; i < n; i++) { const p = nearestFree(w, x + i, y); const u = makeUnit(w, 'wolf', 2, p.x, p.y); u.home = { x, y }; }
  }
  rebuildBlocked(w);
  for (const u of w.units) { const p = nearestFree(w, u.x, u.y); u.x = u.ox = p.x; u.y = u.oy = p.y; if (u.role === 'garrison') u.home = { x: u.x, y: u.y }; }
  w.units.filter((u) => u.kind === 'wolf').forEach((u) => (u.home = { x: u.x, y: u.y }));
  return w;
}
