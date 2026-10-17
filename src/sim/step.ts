import { DISCOVERIES } from '../data/discoveries';
import { campaignSecond } from '../data/campaign';
import { activitiesTick, cluesTick } from './discovery';
import { aiSecond } from './ai';
import { economySecond, trainingTick } from './econ';
import { nearestFree, rebuildBlocked } from './grid';
import { ensureFog, updateFog } from './fog';
import { checkEnd, updateObjectives } from './objectives';
import { hasDisc } from './rules';
import type { DiscoveryId, World } from './types';
import { carcassAt, DT, separate, updateUnit } from './units';
import { emit, isWinter, log, rand, reindex } from './util';
import { makeUnit } from './world';
import { creditKill, eldersSecond, upgradesTick } from './upgrades';

export const TICKS_PER_SEC = Math.round(1 / DT);

function regrow(w: World) {
  const farmMult = hasDisc(w, 'irrigation') ? 2.5 : hasDisc(w, 'farming') ? 2 : 1;
  for (const n of w.nodes) {
    if (n.regen && n.amount < n.max) {
      const r = n.kind === 'bush' ? n.regen * farmMult : n.regen;
      n.amount = Math.min(n.max, n.amount + r);
    }
  }
}

function cleanup(w: World) {
  let changed = false;
  for (const u of [...w.units]) {
    if (u.hp > 0) continue;
    w.units.splice(w.units.indexOf(u), 1);
    emit(w, { k: 'death', x: u.x, y: u.y, owner: u.owner, kind: u.kind });
    if (u.kind === 'deer') carcassAt(w, u);
    if (u.kind === 'mammoth') carcassAt(w, u, 260);
    creditKill(w, u);
    if (u.owner === 0) {
      w.stats.lost++;
      log(w, `${u.name} the ${u.kind} has fallen.`, 'bad');
      if (w.specialists) {
        for (const [id, uid] of Object.entries(w.specialists) as [DiscoveryId, number][]) {
          if (uid === u.id && w.disc[id] === 'known') {
            delete w.specialists[id];
            w.activities = w.activities.filter((a) => !(a.kind === 'teach' && a.disc === id));
            w.disc[id] = 'faded';
            log(w, `${u.name} fell before teaching ${DISCOVERIES[id].name} — the knowledge fades to remembered clues!`, 'bad');
          }
        }
      }
    }
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

/** Lake maps: the ice forms in winter (walkable) and breaks up in spring. */
function seasons(w: World) {
  w._lake ??= w.terrain.some((r) => r.includes('L'));
  if (!w._lake) return;
  const frozen = isWinter(w);
  if (!!w._frozen === frozen) return;
  w._frozen = frozen;
  if (!frozen) {
    // the thaw: anyone still out on the ice scrambles ashore
    for (const u of w.units) if (w.terrain[Math.floor(u.y)]?.[Math.floor(u.x)] === 'L') {
      const p = nearestShore(w, u.x, u.y); u.x = u.ox = p.x; u.y = u.oy = p.y; u.hp -= u.maxHp * 0.15; u.order = { t: 'idle' };
    }
    log(w, 'Spring thaw: the ice breaks up. The lake is water again.', 'info');
  } else log(w, 'The lake has frozen solid. You can cross the ice, and so can the rival!', 'info');
  rebuildBlocked(w);
  for (const u of w.units) u.path = null;
  emit(w, { k: 'freeze', x: w.W / 2, y: w.H / 2, owner: 0, n: frozen ? 1 : 0 });
}
function nearestShore(w: World, x: number, y: number) {
  let best = { x, y }, bd = Infinity;
  for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
    const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy, c = w.terrain[ty]?.[tx];
    if (c !== '.' && c !== '=') continue;
    const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = { x: tx + 0.5, y: ty + 0.5 }; }
  }
  return best;
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
  upgradesTick(w);
  activitiesTick(w);
  // projectile / hit effects
  for (const f of w._fx) f.t -= DT;
  w._fx = w._fx.filter((f) => f.t > 0);
  if (w.tick % TICKS_PER_SEC === 0) {
    economySecond(w);
    eldersSecond(w);
    aiSecond(w);
    regrow(w);
    updateObjectives(w);
    cluesTick(w);
    if (w.campaignId) campaignSecond(w);
    if (w.tick % (TICKS_PER_SEC * 20) === 0) wildlifeRespawn(w);
  }
  if (w.tick % 20 === 0) seasons(w);
  if (w.tick % 4 === 0) updateFog(w);
  if (w.tick % 200 === 0) w._carc?.clear();
  cleanup(w);
  if (w.tick % 10 === 0) checkEnd(w);
}

