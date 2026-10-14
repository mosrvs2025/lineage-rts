import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { isWarm, isSupplied, popCap, popCount, supplyCenters, hasDisc, hasTech, tierBonus, anyTier } from './rules';
import { nearestFree } from './grid';
import type { World } from './types';
import { autoWork, DT, setOrder } from './units';
import { spawnSpot, makeUnit } from './world';
import { emit, isWinter, log } from './util';

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

  // winter spoilage: loose food rots, smoked provisions do not
  if (winter && w.res.food > 30) {
    const loss = (w.res.food - 30) * 0.012 * (anyTier(w, 'stockpile', 1) ? 0.55 : 1);
    w.res.food -= loss; w.stats.spoiled += loss;
  }

  // smoking racks
  if (hasDisc(w, 'preservation')) {
    for (const b of owners) {
      if (b.kind !== 'rack') continue;
      b.tick += 1;
      if (b.tick >= 6 && w.res.food >= 6 && w.res.provisions < 300) {
        b.tick = 0; w.res.food -= 6; w.res.provisions += b.tier >= 1 ? 9 : 6;
      }
    }
  }

  // hunger, cold and exposure
  const centers = supplyCenters(w);
  let exposed = 0;
  for (const u of mine) {
    const warm = isWarm(w, u.x, u.y);
    if (warm && u.hp < u.maxHp && !w._starving) u.hp = Math.min(u.maxHp, u.hp + 0.4);
    if (w._starving && u.hp > u.maxHp * 0.4) u.hp -= 0.25;
    if (winter && !warm) {
      const resist = (w.species === 'neanderthal' ? 0.65 : 1) * (hasTech(w, 'hardy') ? 0.6 : 1);
      if (u.hp > u.maxHp * 0.15) u.hp -= 0.6 * resist;
    }
    if (!isSupplied(centers, u.x, u.y)) exposed++;
  }
  if (exposed) {
    const upkeep = (w.trait === 'logistics' ? 0.7 : 1) * exposed / 5;
    if (w.res.provisions >= upkeep) w.res.provisions -= upkeep;
    else {
      w.res.provisions = 0;
      for (const u of mine) if (!isSupplied(centers, u.x, u.y)) u.hp -= 0.9;
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
    if (q.kind === 'gatherer' || q.kind === 'hunter') autoWork(w, u);
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
