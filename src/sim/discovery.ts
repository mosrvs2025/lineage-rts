import { DISCOVERIES } from '../data/discoveries';
import { BUILDINGS } from '../data/buildings';
import { pay } from './econ';
import { hasDisc } from './rules';
import type { Activity, DiscoveryId, World } from './types';
import { DT, moveTo, setOrder, autoWork } from './units';
import { bCenter, bRadius, dist, isWinter, log, unitById } from './util';

export function costMultiplier(w: World, id: DiscoveryId) {
  const d = DISCOVERIES[id];
  if (w.disc[id] === 'faded') return 0.4;               // relearning from remembered clues
  if (d.parent && w.disc[d.parent] === 'preserved' && w.gen >= 2) return 0.7; // inherited expertise
  return 1;
}

export function discCost(w: World, id: DiscoveryId) {
  const m = costMultiplier(w, id), out: Record<string, number> = {};
  for (const [k, v] of Object.entries(DISCOVERIES[id].cost)) out[k] = Math.ceil((v ?? 0) * m);
  return out;
}
export const discTime = (w: World, id: DiscoveryId) =>
  DISCOVERIES[id].time * costMultiplier(w, id) * (w.trait === 'teaching' ? 0.8 : 1);

export interface Check { ok: boolean; reason: string }

export function investigateCheck(w: World, id: DiscoveryId): Check {
  const d = DISCOVERIES[id], st = w.disc[id];
  if (st === 'known' || st === 'preserved') return { ok: false, reason: 'Already discovered.' };
  if (st === 'hidden') return { ok: false, reason: `No clue yet: ${d.clueHint}` };
  if (d.later && w.gen < 2) return { ok: false, reason: 'Your ancestors have not left enough to build on. Pass the lineage on first.' };
  if (w.activities.some((a) => a.disc === id)) return { ok: false, reason: 'Already being investigated.' };
  if (w.activities.length >= 2) return { ok: false, reason: 'Two activities already under way.' };
  for (const n of d.needs) {
    if (!w.buildings.some((b) => b.owner === 0 && b.kind === n && b.done)) return { ok: false, reason: `Needs a ${BUILDINGS[n].name}.` };
  }
  const cost = discCost(w, id);
  for (const [k, v] of Object.entries(cost)) {
    if (w.res[k as 'food'] < v) return { ok: false, reason: `Needs ${v} ${k} (you have ${Math.floor(w.res[k as 'food'])}).` };
  }
  if (!w.units.some((u) => u.owner === 0 && u.kind === 'gatherer')) return { ok: false, reason: 'No one available to investigate.' };
  return { ok: true, reason: '' };
}

export function startInvestigation(w: World, id: DiscoveryId): Check {
  const c = investigateCheck(w, id);
  if (!c.ok) return c;
  pay(w, discCost(w, id) as never);
  w.activities.push({ id: w.nextId++, kind: 'investigate', disc: id, progress: 0, total: discTime(w, id), worker: -1 });
  log(w, `Investigating ${DISCOVERIES[id].name}…`);
  return { ok: true, reason: '' };
}

export function teachCheck(w: World, id: DiscoveryId): Check {
  const st = w.disc[id];
  if (st !== 'known') return { ok: false, reason: st === 'preserved' ? 'Already preserved.' : 'Not yet discovered.' };
  if (!w.buildings.some((b) => b.owner === 0 && b.kind === 'circle' && b.done)) return { ok: false, reason: 'Needs a Teaching circle.' };
  if (w.activities.some((a) => a.disc === id)) return { ok: false, reason: 'Already being taught.' };
  if (w.activities.length >= 2) return { ok: false, reason: 'Two activities already under way.' };
  if (w.res.knowledge < 10) return { ok: false, reason: 'Needs 10 knowledge.' };
  if (!w.units.some((u) => u.owner === 0 && u.kind === 'gatherer')) return { ok: false, reason: 'No apprentice available.' };
  return { ok: true, reason: '' };
}
export function startTeaching(w: World, id: DiscoveryId): Check {
  const c = teachCheck(w, id); if (!c.ok) return c;
  w.res.knowledge -= 10;
  w.activities.push({ id: w.nextId++, kind: 'teach', disc: id, progress: 0, total: 15 * (w.trait === 'teaching' ? 0.8 : 1), worker: -1 });
  log(w, `An apprentice begins learning ${DISCOVERIES[id].name}…`);
  return { ok: true, reason: '' };
}

function facilityFor(w: World, a: Activity) {
  const need = a.kind === 'teach' ? 'circle' : DISCOVERIES[a.disc].needs[0];
  return w.buildings.find((b) => b.owner === 0 && b.kind === need && b.done);
}

export function activitiesTick(w: World) {
  for (const a of [...w.activities]) {
    const fac = facilityFor(w, a);
    if (!fac) continue;
    let worker = unitById(w, a.worker);
    if (!worker || worker.hp <= 0 || worker.order.t !== 'research') {
      const taken = new Set(w.activities.map((x) => x.worker));
      const c = bCenter(fac);
      let best, bd = Infinity;
      for (const u of w.units) {
        if (u.owner !== 0 || u.kind !== 'gatherer' || taken.has(u.id)) continue;
        const d = dist(u.x, u.y, c.x, c.y) + (u.order.t === 'idle' ? -20 : 0);
        if (d < bd) { bd = d; best = u; }
      }
      worker = best;
      if (!worker) continue;
      setOrder(worker, { t: 'research' });
      a.worker = worker.id;
    }
    const c = bCenter(fac);
    const r = moveTo(w, worker, c.x, c.y, bRadius(fac) + 1.1, { x: fac.x, y: fac.y, w: fac.w, h: fac.h });
    if (r === 'arrived') {
      a.progress += DT;
      if (a.progress >= a.total) {
        w.activities.splice(w.activities.indexOf(a), 1);
        if (a.kind === 'investigate') {
          w.disc[a.disc] = 'known';
          log(w, `Discovery: ${DISCOVERIES[a.disc].name}! ${DISCOVERIES[a.disc].effect}`, 'good');
        } else {
          w.disc[a.disc] = 'preserved';
          log(w, `${DISCOVERIES[a.disc].name} is now taught to apprentices — future generations will keep it.`, 'good');
        }
        setOrder(worker, { t: 'idle' }); autoWork(w, worker);
      }
    }
  }
}

/** Slow checks for landmarks and clues. */
export function cluesTick(w: World) {
  for (const l of w.landmarks) {
    if (l.visited) continue;
    if (w.units.some((u) => u.owner === 0 && dist(u.x, u.y, l.x + 0.5, l.y + 0.5) < 3.5)) {
      l.visited = true;
      if (l.id === 'cave') { w.res.knowledge += 15; log(w, 'Your scout reaches the Ember Cave: pitch seeps from the wall and burns steadily. (+15 knowledge)', 'good'); }
      else log(w, `Your clan has reached the ${l.name}.`, 'good');
    }
  }
  const raise = (id: DiscoveryId, cond: boolean) => {
    if (cond && w.disc[id] === 'hidden') {
      w.disc[id] = 'clue';
      log(w, `New clue — ${DISCOVERIES[id].name}: ${DISCOVERIES[id].clue}`, 'good');
    }
  };
  raise('cooking', w.stats.food >= 25);
  raise('preservation', w.stats.meat >= 15 || isWinter(w) || w.time >= w.winter.start);
  raise('portable', !!w.landmarks.find((l) => l.id === 'cave')?.visited);
  raise('heat', hasDisc(w, 'cooking') && hasDisc(w, 'portable'));
}

