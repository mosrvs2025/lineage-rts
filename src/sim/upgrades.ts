import { BUILDINGS } from '../data/buildings';
import type { UpgradeDef } from '../data/buildings';
import { TECHS } from '../data/techs';
import type { Check } from './discovery';
import { canAfford, pay } from './econ';
import { FIGHTERS, RANK_KILLS, hasDisc, hasTech, rankOf } from './rules';
import { damage } from './units';
import type { Building, World } from './types';
import { bCenter, buildingById, dist, emit, log } from './util';

const DT = 0.05;
const ok: Check = { ok: true, reason: '' };

export const nextUpgrade = (b: Building): UpgradeDef | undefined => BUILDINGS[b.kind].upgrades?.[b.tier];

export function upgradeCheck(w: World, bId: number): Check {
  const b = buildingById(w, bId);
  if (!b || b.owner !== 0 || !b.done) return { ok: false, reason: 'Building not ready.' };
  const u = nextUpgrade(b);
  if (!u) return { ok: false, reason: 'Fully upgraded.' };
  if (b.upg) return { ok: false, reason: 'Already upgrading.' };
  if (u.requires && !hasDisc(w, u.requires)) return { ok: false, reason: `Needs the ${u.requires} discovery.` };
  if (!canAfford(w, u.cost)) return { ok: false, reason: 'Not enough resources.' };
  return ok;
}
export function cmdUpgrade(w: World, bId: number): Check {
  const c = upgradeCheck(w, bId); if (!c.ok) return c;
  const b = buildingById(w, bId)!, u = nextUpgrade(b)!;
  pay(w, u.cost);
  b.upg = { t: u.time, total: u.time };
  return c;
}
export function cancelUpgrade(w: World, bId: number) {
  const b = buildingById(w, bId); if (!b?.upg) return;
  const u = nextUpgrade(b)!;
  for (const k of Object.keys(u.cost) as (keyof typeof u.cost)[]) w.res[k] += Math.floor((u.cost[k] ?? 0) * 0.75);
  b.upg = undefined;
}

export function researchCheck(w: World, bId: number, tech: string): Check {
  const b = buildingById(w, bId), t = TECHS[tech];
  if (!b || !t || b.owner !== 0 || !b.done || b.kind !== t.at) return { ok: false, reason: 'Cannot research here.' };
  if (hasTech(w, tech)) return { ok: false, reason: 'Already known.' };
  if (b.research) return { ok: false, reason: 'Already researching.' };
  if (w.buildings.some((x) => x.research?.tech === tech)) return { ok: false, reason: 'Already being researched.' };
  if (!canAfford(w, t.cost)) return { ok: false, reason: 'Not enough resources.' };
  return ok;
}
export function cmdResearch(w: World, bId: number, tech: string): Check {
  const c = researchCheck(w, bId, tech); if (!c.ok) return c;
  const t = TECHS[tech]; pay(w, t.cost);
  buildingById(w, bId)!.research = { tech, t: t.time, total: t.time };
  return c;
}
export function cancelResearch(w: World, bId: number) {
  const b = buildingById(w, bId); if (!b?.research) return;
  const t = TECHS[b.research.tech];
  for (const k of Object.keys(t.cost) as (keyof typeof t.cost)[]) w.res[k] += Math.floor((t.cost[k] ?? 0) * 0.75);
  b.research = undefined;
}

/** Per-tick progress of upgrades, research and tower fire. */
export function upgradesTick(w: World) {
  for (const b of w.buildings) {
    if (b.owner !== 0 || !b.done) continue;
    if (b.upg) {
      b.upg.t -= DT;
      if (b.upg.t <= 0) {
        const u = nextUpgrade(b)!;
        b.tier++; b.upg = undefined;
        const mult = u.hpMult ?? 1;
        const nm = Math.round(b.maxHp * mult); b.hp += nm - b.maxHp; b.maxHp = nm;
        log(w, `${u.name} complete.`, 'good');
        emit(w, { k: 'upgrade', x: bCenter(b).x, y: bCenter(b).y, owner: 0, kind: b.kind, n: b.tier });
      }
    }
    if (b.research) {
      const elders = w.units.filter((u) => u.owner === 0 && u.kind === 'elder' && dist(u.x, u.y, bCenter(b).x, bCenter(b).y) < 7).length;
      const rate = (1 + 0.25 * Math.min(2, elders)) * (b.kind === 'circle' && b.tier >= 1 ? 1.5 : 1);
      b.research.t -= DT * rate;
      if (b.research.t <= 0) {
        const id = b.research.tech; b.research = undefined;
        w.techs[id] = true;
        if (id === 'leather') for (const u of w.units) if (u.owner === 0 && FIGHTERS.includes(u.kind)) { const nm = Math.round(u.maxHp * 1.2); u.hp += nm - u.maxHp; u.maxHp = nm; }
        log(w, `${TECHS[id].name} learned.`, 'good');
        emit(w, { k: 'tech', x: bCenter(b).x, y: bCenter(b).y, owner: 0, kind: b.kind });
      }
    }
    if (b.kind === 'watch' && b.tier >= 1) towerFire(w, b);
  }
}

function towerFire(w: World, b: Building) {
  b.cd = (b.cd ?? 0) - DT;
  if (b.cd > 0) return;
  const c = bCenter(b);
  const range = b.tier >= 2 ? 11 : 9, dmg = b.tier >= 2 ? 9 : 6;
  let best: { x: number; y: number; hp: number } | undefined, bd = range;
  for (const u of w.units) {
    if (u.owner === 0 || u.kind === 'deer' || u.hp <= 0) continue;
    if (u.owner === 1 && w.time < w.truceUntil) continue;
    const d = dist(c.x, c.y, u.x, u.y);
    if (d < bd) { bd = d; best = u; }
  }
  if (!best) return;
  b.cd = b.tier >= 2 ? 1.3 : 1.6;
  const t = best as import('./types').Unit;
  w._fx?.push({ x1: c.x, y1: c.y, x2: t.x, y2: t.y, t: 0.18, c: '#ffd27a' });
  emit(w, { k: 'shoot', x: c.x, y: c.y, x2: t.x, y2: t.y, owner: 0, kind: 'watch' });
  t.lastHit = -1;
  damage(w, t, dmg);
}

/** Once per second: elders mend the wounded. */
export function eldersSecond(w: World) {
  const rate = hasTech(w, 'remedies') ? 2.4 : 1.2;
  for (const e of w.units) {
    if (e.owner !== 0 || e.kind !== 'elder' || e.hp <= 0) continue;
    for (const u of w.units) {
      if (u.owner !== 0 || u === e || u.hp >= u.maxHp || dist(e.x, e.y, u.x, u.y) > 4.5) continue;
      u.hp = Math.min(u.maxHp, u.hp + rate);
      emit(w, { k: 'heal', x: u.x, y: u.y, owner: 0 });
    }
  }
}

/** Credit a kill to the unit that landed the last blow; promote on thresholds. */
export function creditKill(w: World, dead: { lastHit?: number; kind: string; owner: number }) {
  if (dead.owner === 0 || dead.kind === 'deer' || dead.lastHit === undefined) return;
  const k = w.units.find((u) => u.id === dead.lastHit && u.owner === 0); if (!k) return;
  const before = rankOf(k);
  k.kills++;
  const after = rankOf(k);
  if (after > before) {
    const nm = Math.round(k.maxHp * 1.15); k.hp += nm - k.maxHp; k.maxHp = nm;
    log(w, `${k.name} the ${k.kind} is promoted to ${after === 1 ? 'veteran' : 'elite'}!`, 'good');
    emit(w, { k: 'rank', x: k.x, y: k.y, owner: 0, n: after });
  }
}
export { RANK_KILLS };
