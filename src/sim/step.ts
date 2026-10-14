import { activitiesTick, cluesTick } from './discovery';
import { aiSecond } from './ai';
import { economySecond, trainingTick } from './econ';
import { nearestFree, rebuildBlocked } from './grid';
import { ensureFog, updateFog } from './fog';
import { checkEnd, updateObjectives } from './objectives';
import type { World } from './types';
import { carcassAt, DT, separate, updateUnit } from './units';
import { emit, log, rand, reindex } from './util';
import { makeUnit } from './world';

export const TICKS_PER_SEC = Math.round(1 / DT);

function regrow(w: World) {
  for (const n of w.nodes) if (n.regen && n.amount < n.max) n.amount = Math.min(n.max, n.amount + n.regen);
}

function cleanup(w: World) {
  let changed = false;
  for (const u of [...w.units]) {
    if (u.hp > 0) continue;
    w.units.splice(w.units.indexOf(u), 1);
    emit(w, { k: 'death', x: u.x, y: u.y, owner: u.owner, kind: u.kind });
    if (u.kind === 'deer') carcassAt(w, u);
    if (u.owner === 0) { w.stats.lost++; log(w, `${u.name} the ${u.kind} has fallen.`, 'bad'); }
    else if (u.owner === 1) w.stats.kills++;
  }
  for (const b of [...w.buildings]) {
    if (b.hp > 0) continue;
    w.buildings.splice(w.buildings.indexOf(b), 1); changed = true;
    if (b.owner === 0) log(w, `Your ${b.kind} was destroyed!`, 'bad');
    else {
      w.res.wood += 20; w.res.stone += 10;
      log(w, `Rival ${b.kind} destroyed — you salvage 20 wood and 10 stone.`, 'good');
    }
  }
  if (changed) rebuildBlocked(w);
}

function wildlifeRespawn(w: World) {
  // keep the valley supplied with game so food never becomes impossible
  const herd = w.units.filter((u) => u.kind === 'deer');
  if (herd.length >= 8 || herd.length === 0) return;
  const src = herd[Math.floor(rand(w) * herd.length)];
  const p = nearestFree(w, src.home.x + (rand(w) - 0.5) * 6, src.home.y + (rand(w) - 0.5) * 6);
  const d = makeUnit(w, 'deer', 2, p.x, p.y);
  d.home = { x: src.home.x, y: src.home.y };
}

/** Advance the simulation by one fixed tick (DT seconds). */
export function step(w: World) {
  if (w.status !== 'playing') return;
  ensureFog(w);
  reindex(w);
  w._fx ??= [];
  w.tick++; w.time += DT;
  for (const u of w.units) updateUnit(w, u);
  separate(w);
  trainingTick(w);
  activitiesTick(w);
  // projectile / hit effects
  for (const f of w._fx) f.t -= DT;
  w._fx = w._fx.filter((f) => f.t > 0);
  if (w.tick % TICKS_PER_SEC === 0) {
    economySecond(w);
    aiSecond(w);
    regrow(w);
    updateObjectives(w);
    cluesTick(w);
    if (w.tick % (TICKS_PER_SEC * 20) === 0) wildlifeRespawn(w);
  }
  if (w.tick % 4 === 0) updateFog(w);
  if (w.tick % 200 === 0) w._carc?.clear();
  cleanup(w);
  if (w.tick % 10 === 0) checkEnd(w);
}

