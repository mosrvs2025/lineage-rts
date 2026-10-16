import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { SPECIES } from '../data/species';
import { isWarm, isSupplied, popCap, popCount, supplyCenters, supplyRange, hasDisc, hasTech, tierBonus, anyTier } from './rules';
import { nearestFree } from './grid';
import type { World } from './types';
import { autoWork, DT, setOrder } from './units';
import { spawnSpot, makeUnit } from './world';
import { bCenter, emit, isWinter, log } from './util';

/** Runs once per simulated second. */
export function economySecond(w: World) {
  const winter = isWinter(w);
  const owners = w.buildings.filter((b) => b.owner === 0 && b.done);
  for (const b of owners) {
    if (b.kind === 'hearth') w.res.knowledge += 0.25;
    if (b.kind === 'circle') w.res.knowledge += 0.5;
    w.res.knowledge += tierBonus(b, 'knowledge');
  }
  const mine = w.units.filter((u) => u.owner === 0);

  // an unfinished site with nobody working on it recruits the nearest free gatherer
  for (const b of w.buildings) {
    if (b.owner !== 0 || b.done) continue;
    if (mine.some((u) => u.order.t === 'build' && u.order.b === b.id)) { b.waited = 0; continue; }
    b.waited = (b.waited ?? 0) + 1;
    if (b.waited < 6) continue;
    const c = bCenter(b);
    const free = mine.filter((u) => u.kind === 'gatherer' && u.order.t !== 'build' && u.order.t !== 'research' && !u.carry.n).sort((p, q) => Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y))[0]
      ?? mine.filter((u) => u.kind === 'gatherer' && u.order.t !== 'build' && u.order.t !== 'research')[0];
    if (free) { setOrder(free, { t: 'build', b: b.id }); b.waited = 0; }
  }

  // hunger: each clan member eats; winter makes everyone hungrier
  w.hungerT += mine.length * (winter ? 1 / 8 : 1 / 12);
  while (w.hungerT >= 1) {
    w.hungerT -= 1;
    if (w.res.food >= 1) w.res.food -= 1;
    else if (w.res.provisions >= 1) w.res.provisions -= 1;
    else { w._starving = true; w.hungerT = 0; break; }
  }
  if (w.res.food >= 1 || w.res.provisions >= 1) w._starving = false;
  w.res.food = Math.max(0, w.res.food);

  // winter spoilage: loose food rots, smoked provisions do not; pottery vessels protect stores
  if (winter && w.res.food > 30) {
    const loss = (w.res.food - 30) * 0.012 * (anyTier(w, 'stockpile', 1) ? 0.55 : 1) * (hasDisc(w, 'pottery') ? 0.4 : 1);
    w.res.food -= loss; w.stats.spoiled += loss;
  }

  // smoking racks
  if (hasDisc(w, 'preservation')) {
    const potBonus = hasDisc(w, 'pottery') ? 2 : 0;
    for (const b of owners) {
      if (b.kind !== 'rack') continue;
      b.tick += 1;
      if (b.tick >= 6 && w.res.food >= 6 && w.res.provisions < 300) {
        b.tick = 0; w.res.food -= 6; w.res.provisions += (b.tier >= 1 ? 9 : 6) + potBonus;
      }
    }
  }

  // cultivated crop fields
  if (hasDisc(w, 'farming')) {
    const irr = hasDisc(w, 'irrigation');
    for (const b of owners) {
      if (b.kind !== 'field') continue;
      b.tick += 1;
      if (b.tick >= 5) {
        b.tick = 0;
        let harvest = b.tier >= 1 ? 6 : 4;
        if (irr) harvest = Math.round(harvest * 1.6);
        else if (winter) harvest = Math.round(harvest * 0.5);
        w.res.food += harvest; w.stats.food += harvest;
        emit(w, { k: 'deliver', x: bCenter(b).x, y: bCenter(b).y, owner: 0, res: 'food', n: harvest });
      }
    }
  }

  // hunger, cold and exposure
  const centers = supplyCenters(w), sRange = supplyRange(w);
  let exposed = 0;
  for (const u of mine) {
    const warm = isWarm(w, u.x, u.y);
    if (warm && u.hp < u.maxHp && !w._starving) u.hp = Math.min(u.maxHp, u.hp + 0.4);
    if (w._starving && u.hp > u.maxHp * 0.4) u.hp -= 0.25;
    if (winter && !warm) {
      const resist = SPECIES[w.species].cold * (hasTech(w, 'hardy') ? 0.6 : 1);
      if (u.hp > u.maxHp * 0.15) u.hp -= 0.6 * resist;
    }
    if (!isSupplied(centers, u.x, u.y, sRange)) exposed++;
  }
  if (exposed) {
    const upkeep = (w.trait === 'logistics' ? 0.7 : 1) * (hasDisc(w, 'boats') ? 0.65 : 1) * exposed / 5;
    if (w.res.provisions >= upkeep) w.res.provisions -= upkeep;
    else {
      w.res.provisions = 0;
      for (const u of mine) if (!isSupplied(centers, u.x, u.y, sRange)) u.hp -= 0.9;
      if (w.tick % 200 === 0) log(w, 'Expedition is out of provisions beyond supply range — retreat or smoke more food!', 'bad');
    }
  }
}

/** Per-tick: training queues. */
export function trainingTick(w: World) {
  for (const b of w.buildings) {
    if (b.owner !== 0 || !b.done || !b.queue.length) continue;
    const q = b.queue[0];
    q.t -= DT;
    if (q.t > 0) continue;
    if (popCount(w) >= popCap(w)) { q.t = 0; continue; }
    b.queue.shift();
    const p = spawnSpot(w, b);
    const u = makeUnit(w, q.kind, 0, p.x, p.y);
    const q2 = nearestFree(w, p.x, p.y); u.x = u.ox = q2.x; u.y = u.oy = q2.y;
    const rp = b.rally;
    let node: (typeof w.nodes)[number] | undefined, nd = 1.2;
    if (rp) for (const n of w.nodes) { const d = Math.hypot(n.x + 0.5 - rp.x, n.y + 0.5 - rp.y); if (n.amount >= 1 && d < nd) { nd = d; node = n; } }
    if (node && (q.kind === 'gatherer' || (q.kind === 'hunter' && node.res === 'food'))) setOrder(u, { t: 'gather', node: node.id });
    else if (rp) { const f = nearestFree(w, rp.x, rp.y); setOrder(u, { t: 'move', x: f.x, y: f.y }); }
    else if (q.kind === 'gatherer' || q.kind === 'hunter') autoWork(w, u);
    else setOrder(u, { t: 'idle' });
    log(w, `${u.name} the ${UNITS[q.kind].name.toLowerCase()} joins the clan.`, 'good');
    emit(w, { k: 'spawn', x: u.x, y: u.y, owner: 0, kind: q.kind });
  }
}

export function canAfford(w: World, cost: Partial<Record<'food' | 'wood' | 'stone' | 'knowledge' | 'provisions', number>>) {
  for (const k of Object.keys(cost) as (keyof typeof cost)[]) if (w.res[k] < (cost[k] ?? 0) - 1e-9) return false;
  return true;
}
export function pay(w: World, cost: Partial<Record<'food' | 'wood' | 'stone' | 'knowledge' | 'provisions', number>>) {
  for (const k of Object.keys(cost) as (keyof typeof cost)[]) w.res[k] -= cost[k] ?? 0;
}
export const buildingName = (k: keyof typeof BUILDINGS) => BUILDINGS[k].name;
