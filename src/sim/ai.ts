import { nearestFree } from './grid';
import type { UnitKind, World } from './types';
import { setOrder } from './units';
import { bCenter, dist, log, pick, rand } from './util';
import { makeUnit, spawnSpot } from './world';

const OUTPOST = { x: 44.5, y: 23.5 };

/** Rival clan: a light scripted economy, a garrison at the pass, and periodic warbands. Runs once per second. */
export function aiSecond(w: World) {
  const ai = w.ai;
  const hearth = w.buildings.find((b) => b.owner === 1 && b.kind === 'hearth');
  if (!hearth) return;
  const rate = 0.8 + w.time / 1400;
  ai.supply += rate;
  const mine = w.units.filter((u) => u.owner === 1);
  const cap = 12 + Math.floor(w.time / 300) * 2;
  if (ai.supply >= 50 && w.time >= ai.nextSpawn && mine.length < Math.min(cap, 22)) {
    const garrison = mine.filter((u) => u.role === 'garrison').length;
    const kind: UnitKind = pick(w, ['guard', 'guard', 'raider', 'raider', 'hunter']);
    const p = spawnSpot(w, hearth);
    const u = makeUnit(w, kind, 1, p.x, p.y);
    ai.supply -= 45; ai.nextSpawn = w.time + 20;
    if (garrison < 4) {
      u.role = 'garrison'; u.home = nearestFree(w, OUTPOST.x + rand(w) * 2, OUTPOST.y + rand(w) * 2);
      setOrder(u, { t: 'move', x: u.home.x, y: u.home.y });
    }
  }
  // returning warbands rejoin the pool
  const hc = bCenter(hearth);
  for (const u of mine) {
    if (u.role === 'raid' && u.order.t === 'idle') {
      if (dist(u.x, u.y, hc.x, hc.y) > 6) setOrder(u, { t: 'move', x: hc.x + rand(w) * 3, y: hc.y + 3 });
      else u.role = 'none';
    }
  }
  // raid
  if (w.time >= ai.nextRaid && w.time >= w.truceUntil) {
    const pool = mine.filter((u) => u.role === 'none' && u.kind !== 'hunter');
    const need = 2 + Math.min(4, ai.raids);
    if (pool.length >= need) {
      const targets = [...w.buildings.filter((b) => b.owner === 0), ...w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer')];
      if (targets.length) {
        let best = targets[0], bd = Infinity;
        for (const t of targets) {
          const tc = 'progress' in t ? bCenter(t) : { x: t.x, y: t.y };
          const d = dist(tc.x, tc.y, hc.x, hc.y);
          if (d < bd) { bd = d; best = t; }
        }
        const tc = 'progress' in best ? bCenter(best) : { x: best.x, y: best.y };
        for (const u of pool.slice(0, need + 2)) { u.role = 'raid'; setOrder(u, { t: 'amove', x: tc.x, y: tc.y }); }
        ai.raids++;
        log(w, 'A rival warband has set out from the east!', 'bad');
      }
    }
    ai.nextRaid = w.time + Math.max(90, 160 - ai.raids * 8) + rand(w) * 25;
  }
  // warn when raiders get close
  if (w.time - ai.lastRaidMsg > 45) {
    const near = mine.find((u) => u.role === 'raid' && w.buildings.some((b) => b.owner === 0 && dist(bCenter(b).x, bCenter(b).y, u.x, u.y) < 14));
    if (near) { ai.lastRaidMsg = w.time; log(w, 'Raiders are approaching your settlement!', 'bad'); }
  }
}

