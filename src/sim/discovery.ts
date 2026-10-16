import { DISCOVERIES } from '../data/discoveries';
import { BUILDINGS } from '../data/buildings';
import { pay } from './econ';
import { hasDisc, isExplored } from './rules';
import type { Activity, DiscoveryId, World } from './types';
import { DT, moveTo, setOrder, autoWork } from './units';
import { bCenter, bRadius, dist, emit, isWinter, log, unitById } from './util';

export function costMultiplier(w: World, id: DiscoveryId) {
  const d = DISCOVERIES[id];
  if (w.disc[id] === 'faded') return 0.4;               // relearning from remembered clues
  if (d.parent && w.disc[d.parent] === 'preserved' && w.gen >= 2) {
    const gp = DISCOVERIES[d.parent].parent;
    if (gp && w.disc[gp] === 'preserved' && w.gen >= 3) return 0.55; // deep ancestral mastery across 3+ generations
    return 0.7; // inherited expertise
  }
  return 1;
}

export function discCost(w: World, id: DiscoveryId) {
  const m = costMultiplier(w, id), out: Record<string, number> = {};
  for (const [k, v] of Object.entries(DISCOVERIES[id].cost)) out[k] = Math.ceil((v ?? 0) * m);
  return out;
}
export const discTime = (w: World, id: DiscoveryId) =>
  DISCOVERIES[id].time * costMultiplier(w, id) * (w.trait === 'teaching' ? 0.8 : w.lineage.some((l) => l.trait === 'teaching') ? 0.9 : 1);

export interface Check { ok: boolean; reason: string }

export function investigateCheck(w: World, id: DiscoveryId): Check {
  const d = DISCOVERIES[id], st = w.disc[id];
  if (st === 'known' || st === 'preserved') return { ok: false, reason: 'Already discovered.' };
  if (st === 'hidden') return { ok: false, reason: `No clue yet: ${d.clueHint}` };
  const reqGen = d.minGen ?? (d.later ? 2 : 1);
  if (w.gen < reqGen) {
    return {
      ok: false,
      reason: reqGen === 2
        ? 'Your ancestors have not left enough to build on. Pass the lineage on first.'
        : `Requires Generation ${reqGen} — pass the fire onward first.`,
    };
  }
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
  w.activities.push({ id: w.nextId++, kind: 'teach', disc: id, progress: 0, total: 15 * (w.trait === 'teaching' ? 0.8 : w.lineage.some((l) => l.trait === 'teaching') ? 0.9 : 1), worker: -1 });
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
          w.specialists ??= {};
          w.specialists[a.disc] = worker.id;
          if (a.disc === 'kiln') {
            for (const b of w.buildings) if (b.owner === 0) { const nm = Math.round(b.maxHp * 1.35); b.hp += nm - b.maxHp; b.maxHp = nm; }
          }
          emit(w, { k: 'discover', x: worker.x, y: worker.y, owner: 0 });
          log(w, `Discovery: ${DISCOVERIES[a.disc].name} (mastered by ${worker.name})! ${DISCOVERIES[a.disc].effect}`, 'good');
        } else {
          w.disc[a.disc] = 'preserved';
          if (w.specialists) delete w.specialists[a.disc];
          emit(w, { k: 'preserved', x: worker.x, y: worker.y, owner: 0 });
          log(w, `${DISCOVERIES[a.disc].name} is now taught to apprentices — future generations will keep it.`, 'good');
        }
        setOrder(worker, { t: 'idle' }); autoWork(w, worker);
      }
    }
  }
}

function nearWater(w: World, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const c = w.terrain[ty + dy]?.[tx + dx];
    if (c === '~' || c === '=' || c === 'L') return true;
  }
  return false;
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
  raise('pottery', hasDisc(w, 'cooking') && w.buildings.some((b) => b.owner === 0 && b.kind === 'stockpile' && b.done));
  raise('farming', w.stats.food >= 80 || w.gen >= 2 || w.time >= w.winter.end);
  raise('boats', (hasDisc(w, 'portable') || hasDisc(w, 'cooking')) && (
    w.nodes.some((n) => n.kind === 'fish' && isExplored(w, n.x, n.y)) ||
    w.units.some((u) => u.owner === 0 && nearWater(w, u.x, u.y))
  ));
  raise('kiln', hasDisc(w, 'pottery') && hasDisc(w, 'heat'));
  raise('irrigation', hasDisc(w, 'farming') && (
    w.buildings.some((b) => b.owner === 0 && b.kind === 'field' && b.done) ||
    w.stats.food >= 250
  ));
}

