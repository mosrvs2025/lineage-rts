import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { canAfford, pay } from './econ';
import { nearestFree, rebuildBlocked } from './grid';
import { investigateCheck, startInvestigation, startTeaching, teachCheck } from './discovery';
import type { Check } from './discovery';
import type { Hit } from './query';
import { targetAt } from './query';
import { hasDisc, isExplored, popCap, popCount, queuedCount } from './rules';
import type { BuildingKind, DiscoveryId, Res, Unit, UnitKind, World } from './types';
import { nearestNode, setOrder } from './units';
import { MEADOW, OUTPOST_COST, OUTPOST_REQUIRE } from './world';
import { bCenter, buildingById, dist, emit, log, nodeById, unitById } from './util';

const mine = (w: World, ids: number[]) => ids.map((i) => unitById(w, i)).filter((u): u is Unit => !!u && u.owner === 0 && u.hp > 0);

/** Spread a group around a destination so units do not pile up. */
function spread(i: number, n: number, x: number, y: number) {
  if (n <= 1) return { x, y };
  const cols = Math.ceil(Math.sqrt(n));
  return { x: x + ((i % cols) - (cols - 1) / 2) * 0.9, y: y + (Math.floor(i / cols) - (n / cols - 1) / 2) * 0.9 };
}

export function cmdMove(w: World, ids: number[], x: number, y: number, attack = false) {
  const us = mine(w, ids);
  us.forEach((u, i) => {
    const s = spread(i, us.length, x, y);
    const p = nearestFree(w, s.x, s.y);
    setOrder(u, attack ? { t: 'amove', x: p.x, y: p.y } : { t: 'move', x: p.x, y: p.y });
  });
}
export function cmdStop(w: World, ids: number[]) { for (const u of mine(w, ids)) setOrder(u, { t: 'idle' }); }
export function cmdHold(w: World, ids: number[]) { for (const u of mine(w, ids)) setOrder(u, { t: 'hold' }); }
export function cmdRetreat(w: World, ids: number[]) {
  const h = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth');
  if (!h) return;
  const c = bCenter(h);
  mine(w, ids).forEach((u, i) => {
    const s = spread(i, ids.length, c.x, c.y + 3);
    const p = nearestFree(w, s.x, s.y);
    setOrder(u, { t: 'move', x: p.x, y: p.y });
  });
}
export function cmdAttack(w: World, ids: number[], target: number) {
  const t = unitById(w, target) ?? buildingById(w, target);
  if (t && t.owner === 1) w.truceUntil = 0;
  for (const u of mine(w, ids)) if (UNITS[u.kind].dmg > 0) setOrder(u, { t: 'attack', target });
}
export function cmdGather(w: World, ids: number[], nodeId: number) {
  const n = nodeById(w, nodeId); if (!n) return;
  for (const u of mine(w, ids)) {
    if (u.kind === 'gatherer' || (u.kind === 'hunter' && n.res === 'food')) setOrder(u, { t: 'gather', node: nodeId });
    else cmdMove(w, [u.id], n.x + 0.5, n.y + 0.5);
  }
}
export function cmdBuildSite(w: World, ids: number[], bId: number) {
  for (const u of mine(w, ids)) {
    if (u.kind === 'gatherer') setOrder(u, { t: 'build', b: bId });
    else { const b = buildingById(w, bId); if (b) cmdMove(w, [u.id], bCenter(b).x, bCenter(b).y); }
  }
}

/** Resolve a tap/click on the world into the most sensible order. */
export function cmdContext(w: World, ids: number[], x: number, y: number, hit: Hit | undefined = targetAt(w, x, y, 0.4)) {
  if (hit?.type === 'unit' && hit.unit.owner !== 0) { cmdAttack(w, ids, hit.unit.id); return 'attack'; }
  if (hit?.type === 'building' && hit.building.owner === 1) { cmdAttack(w, ids, hit.building.id); return 'attack'; }
  if (hit?.type === 'node') { cmdGather(w, ids, hit.node.id); return 'gather'; }
  if (hit?.type === 'building' && hit.building.owner === 0 && !hit.building.done) { cmdBuildSite(w, ids, hit.building.id); return 'build'; }
  cmdMove(w, ids, x, y); return 'move';
}

export function cmdRally(w: World, leaderId: number): Check {
  const l = unitById(w, leaderId);
  if (!l || l.kind !== 'leader') return { ok: false, reason: 'Select the clan leader.' };
  if (l.ability > 0) return { ok: false, reason: `Rally ready in ${Math.ceil(l.ability)}s.` };
  l.ability = 45;
  for (const u of w.units) if (u.owner === 0 && dist(u.x, u.y, l.x, l.y) < 6.5) { u.buff = 8; u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.2); }
  log(w, `${l.name} rallies the clan!`, 'good');
  emit(w, { k: 'rally', x: l.x, y: l.y, owner: 0 });
  return { ok: true, reason: '' };
}

// ------------------------------------------------------------ construction
export function placeCheck(w: World, kind: BuildingKind, tx: number, ty: number): Check {
  const d = BUILDINGS[kind];
  if (!d.buildable) return { ok: false, reason: 'Cannot be built.' };
  if (d.requires && !hasDisc(w, d.requires as DiscoveryId)) return { ok: false, reason: 'Requires a discovery.' };
  const cost = { ...d.cost };
  const outpost = isOutpostSite(w, kind, tx, ty);
  if (outpost) {
    if (w.gen < 2) return { ok: false, reason: 'The first generation is not ready for the far journey.' };
    if (w.res.provisions < OUTPOST_REQUIRE) return { ok: false, reason: `An outpost needs ${OUTPOST_REQUIRE} provisions (have ${Math.floor(w.res.provisions)}). Smoke more food.` };
  }
  if (!canAfford(w, cost)) {
    const miss = (Object.keys(cost) as Res[]).find((k) => w.res[k] < (cost[k] ?? 0));
    return { ok: false, reason: `Not enough ${miss}.` };
  }
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
    if (x < 1 || y < 1 || x >= w.W - 1 || y >= w.H - 1) return { ok: false, reason: 'Out of bounds.' };
    const c = w.terrain[y][x];
    if (c === '~' || c === '^') return { ok: false, reason: 'Cannot build on water or rock.' };
    if (c === '=') return { ok: false, reason: 'Cannot build in the ford.' };
    if (!isExplored(w, x, y)) return { ok: false, reason: 'Explore this ground first.' };
    if (w._blocked![y * w.W + x]) return { ok: false, reason: 'Something is in the way.' };
  }
  for (const n of w.nodes) if (n.kind === 'carcass' && n.x >= tx && n.x < tx + d.w && n.y >= ty && n.y < ty + d.h) return { ok: false, reason: 'Something is in the way.' };
  for (const b of w.buildings) {
    if (b.owner === 1 && dist(bCenter(b).x, bCenter(b).y, tx + d.w / 2, ty + d.h / 2) < 8) return { ok: false, reason: 'Too close to the rival clan.' };
  }
  return { ok: true, reason: '' };
}

export function isOutpostSite(w: World, kind: BuildingKind, tx: number, ty: number) {
  return kind === 'watch' && dist(tx + 1, ty + 1, MEADOW.x + 0.5, MEADOW.y + 0.5) < 6 && !w.buildings.some((b) => b.outpost);
}

export function cmdPlace(w: World, kind: BuildingKind, tx: number, ty: number, builderIds: number[]): Check & { id?: number } {
  const c = placeCheck(w, kind, tx, ty);
  if (!c.ok) return c;
  const d = BUILDINGS[kind];
  const outpost = isOutpostSite(w, kind, tx, ty);
  pay(w, d.cost);
  if (outpost) w.res.provisions -= OUTPOST_COST;
  const b = {
    id: w.nextId++, kind, owner: 0 as const, x: tx, y: ty, w: d.w, h: d.h,
    hp: Math.max(1, d.hp * 0.1), maxHp: d.hp, progress: 0, done: false, queue: [], tick: 0, outpost,
  };
  w.buildings.push(b); w._b?.set(b.id, b);
  rebuildBlocked(w);
  for (const u of w.units) {
    if (u.x >= tx - 0.3 && u.x <= tx + d.w + 0.3 && u.y >= ty - 0.3 && u.y <= ty + d.h + 0.3) {
      const p = nearestFree(w, u.x, u.y); u.x = u.ox = p.x; u.y = u.oy = p.y; u.path = null;
    }
  }
  let builders = mine(w, builderIds).filter((u) => u.kind === 'gatherer');
  if (!builders.length) {
    const cx = tx + d.w / 2, cy = ty + d.h / 2;
    const cand = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer').sort((a, z) => dist(a.x, a.y, cx, cy) - dist(z.x, z.y, cx, cy));
    builders = cand.slice(0, 1);
  }
  for (const u of builders) setOrder(u, { t: 'build', b: b.id });
  if (outpost) log(w, 'Expedition outpost site claimed at the Far Meadow!', 'good');
  return { ok: true, reason: '', id: b.id };
}

export function cmdCancelSite(w: World, bId: number) {
  const b = buildingById(w, bId);
  if (!b || b.owner !== 0 || b.done) return;
  const d = BUILDINGS[b.kind];
  for (const k of Object.keys(d.cost) as Res[]) w.res[k] += Math.floor((d.cost[k] ?? 0) * 0.75);
  if (b.outpost) w.res.provisions += OUTPOST_COST;
  w.buildings.splice(w.buildings.indexOf(b), 1); w._b?.delete(b.id);
  rebuildBlocked(w);
}

// ------------------------------------------------------------ training etc.
export function trainCheck(w: World, bId: number, kind: UnitKind): Check {
  const b = buildingById(w, bId), d = UNITS[kind];
  if (!b || b.owner !== 0 || !b.done) return { ok: false, reason: 'Building not ready.' };
  if (!BUILDINGS[b.kind].trains.includes(kind)) return { ok: false, reason: 'Cannot train here.' };
  if (d.needs && !w.buildings.some((x) => x.owner === 0 && x.kind === d.needs && x.done)) return { ok: false, reason: `Needs a ${BUILDINGS[d.needs as BuildingKind].name}.` };
  if (b.queue.length >= 5) return { ok: false, reason: 'Queue is full.' };
  if (popCount(w) + queuedCount(w) >= popCap(w)) return { ok: false, reason: 'Population limit — build shelters.' };
  if (!canAfford(w, d.cost)) return { ok: false, reason: 'Not enough resources.' };
  return { ok: true, reason: '' };
}
export function cmdTrain(w: World, bId: number, kind: UnitKind): Check {
  const c = trainCheck(w, bId, kind); if (!c.ok) return c;
  const b = buildingById(w, bId)!;
  pay(w, UNITS[kind].cost);
  b.queue.push({ kind, t: UNITS[kind].time });
  return c;
}
export const cmdInvestigate = (w: World, id: DiscoveryId) => startInvestigation(w, id);
export const cmdTeach = (w: World, id: DiscoveryId) => startTeaching(w, id);
export { investigateCheck, teachCheck };

/** Move a gatherer onto a job (food/wood/stone), preferring idle ones. */
export function cmdJob(w: World, res: Res): Check {
  const gs = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer' && u.order.t !== 'build' && u.order.t !== 'research');
  if (!gs.length) return { ok: false, reason: 'No free gatherers.' };
  const jobOf = (u: Unit) => (u.order.t === 'gather' ? nodeById(w, u.order.node)?.res ?? null : null);
  const cand = gs.filter((u) => jobOf(u) !== res).sort((a, z) => (jobOf(a) === null ? -1 : 0) - (jobOf(z) === null ? -1 : 0));
  const u = cand[0]; if (!u) return { ok: false, reason: 'Everyone is already on this job.' };
  const n = nearestNode(w, u.x, u.y, res);
  if (!n) return { ok: false, reason: `No ${res} source discovered nearby.` };
  setOrder(u, { t: 'gather', node: n.id }); u.carry = { res: null, n: 0, meat: false };
  return { ok: true, reason: '' };
}
export function jobCounts(w: World) {
  const c = { food: 0, wood: 0, stone: 0, idle: 0, build: 0 };
  for (const u of w.units) {
    if (u.owner !== 0 || u.kind !== 'gatherer') continue;
    if (u.order.t === 'gather') { const n = nodeById(w, u.order.node); if (n) c[n.res]++; else c.idle++; }
    else if (u.order.t === 'build' || u.order.t === 'research') c.build++;
    else c.idle++;
  }
  return c;
}

export function cmdGift(w: World): Check {
  if (w.res.food < 40) return { ok: false, reason: 'A gift needs 40 food.' };
  if (w.time < w.truceUntil) return { ok: false, reason: 'The rival clan already accepts your peace.' };
  w.res.food -= 40;
  w.truceUntil = w.time + 180;
  log(w, 'The rival clan accepts your gift. The pass is open for three minutes.', 'good');
  return { ok: true, reason: '' };
}

