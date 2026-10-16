import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { findPath, isBlocked, nearestFree, rebuildBlocked } from './grid';
import type { Rect } from './grid';
import { FIGHTERS, foodMult, gatherRate, hasDisc, hasTech, hostile, isExplored, nearestDropoff, rankOf, anyTier } from './rules';
import type { Building, Pt, ResNode, Unit, World } from './types';
import { bCenter, bRadius, buildingById, dist, emit, log, nodeById, rand, unitById } from './util';

export const DT = 0.05;

export type Target = Unit | Building;
export const isBuilding = (t: Target): t is Building => 'progress' in t;
export function getTarget(w: World, id: number): Target | undefined {
  const u = unitById(w, id); if (u) return u.hp > 0 ? u : undefined;
  const b = buildingById(w, id); if (b && b.hp > 0) return b;
  return undefined;
}
const tCenter = (t: Target): Pt => (isBuilding(t) ? bCenter(t) : { x: t.x, y: t.y });
const tRadius = (t: Target) => (isBuilding(t) ? bRadius(t) : UNITS[t.kind].radius);
const footprint = (b: Building): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h });

type MoveResult = 'arrived' | 'moving' | 'stuck';

function onWaterEdge(w: World, x: number, y: number): boolean {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (w.terrain[ty]?.[tx] === '=') return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = w.terrain[ty + dy]?.[tx + dx];
    if (c === '~' || c === '=' || c === 'L') return true;
  }
  return false;
}

function speedOf(w: World, u: Unit) {
  let s = UNITS[u.kind].speed;
  if (u.owner === 0) {
    if (u.kind === 'scout') s *= w.trait === 'recon' ? 1.2 : 1;
    if (hasDisc(w, 'boats') && onWaterEdge(w, u.x, u.y)) s *= 1.4;
  }
  if (u.owner === 0 && hasTech(w, 'fleet') && (u.kind === 'scout' || u.kind === 'raider' || u.kind === 'slinger' || u.kind === 'stalker')) s *= 1.15;
  if (u.buff > 0) s *= 1.35;
  return s;
}

/** Walk toward (tx,ty) until within `reach`. Handles path planning and invalidation. */
export function moveTo(w: World, u: Unit, tx: number, ty: number, reach: number, allow?: Rect): MoveResult {
  const d = dist(u.x, u.y, tx, ty);
  if (d <= reach) { u.path = null; return 'arrived'; }
  if (!u.path || (dist(tx, ty, u.ptx, u.pty) > 1.5 && u.pcd <= 0)) {
    u.path = findPath(w, u.x, u.y, tx, ty, allow, !u.raw);
    u.ptx = tx; u.pty = ty; u.pcd = 0.8;
    if (!u.path) return 'stuck';
  }
  let step = speedOf(w, u) * DT;
  while (step > 0 && u.path && u.path.length) {
    const wp = u.path[0];
    const dd = dist(u.x, u.y, wp.x, wp.y);
    if (dd <= step || (u.path.length > 1 && dd <= 0.4)) {
      if (dd <= step) { u.x = wp.x; u.y = wp.y; step -= dd; } else step = Math.max(0, step - dd);
      u.path.shift();
    } else {
      const nx = u.x + ((wp.x - u.x) / dd) * step, ny = u.y + ((wp.y - u.y) / dd) * step;
      // a new building may have been placed on the route
      if (isBlocked(w, Math.floor(nx), Math.floor(ny)) && !isBlocked(w, Math.floor(u.x), Math.floor(u.y)) &&
        !(allow && nx >= allow.x && nx < allow.x + allow.w && ny >= allow.y && ny < allow.y + allow.h)) {
        u.path = null; u.pcd = 0; u.raw = true; return 'moving';
      }
      u.x = nx; u.y = ny; step = 0;
    }
    if (dist(u.x, u.y, tx, ty) <= reach) { u.path = null; return 'arrived'; }
  }
  if (!u.path || !u.path.length) { u.path = null; return dist(u.x, u.y, tx, ty) <= reach + 0.6 ? 'arrived' : 'moving'; }
  return 'moving';
}

export function setOrder(u: Unit, o: Unit['order']) { u.order = o; u.path = null; u.tgt = -1; u.pcd = 0; u.raw = false; }

// ---------------------------------------------------------------- targeting
function protectedFromWolves(w: World, v: Unit): boolean {
  if (v.owner !== 0 || !hasDisc(w, 'portable')) return false;
  return w.units.some((o) => o.owner === 0 && (o.kind === 'hunter' || o.kind === 'guard' || o.kind === 'leader') &&
    dist(o.x, o.y, v.x, v.y) < 6);
}

export function findEnemy(w: World, u: Unit, radius: number, buildings: boolean, deer = false): Target | undefined {
  let best: Target | undefined, bd = radius;
  for (const o of w.units) {
    if (o.hp <= 0 || o === u || !hostile(w, u.owner, o.owner)) continue;
    if (o.kind === 'deer' && !deer) continue;
    if (o.kind === 'mammoth') continue;           // mammoths are only fought on purpose
    if (u.kind === 'wolf' && protectedFromWolves(w, o)) continue;
    const d = dist(u.x, u.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (buildings && u.owner !== 2) {
    for (const b of w.buildings) {
      if (b.hp <= 0 || !hostile(w, u.owner, b.owner)) continue;
      const c = bCenter(b); const d = dist(u.x, u.y, c.x, c.y) - bRadius(b);
      if (d < bd) { bd = d; best = b; }
    }
  }
  return best;
}

function leaderNear(w: World, u: Unit) {
  for (const o of w.units) if (o.kind === 'leader' && o.owner === u.owner && o.hp > 0 && dist(o.x, o.y, u.x, u.y) < 5) return true;
  return false;
}

function damageOf(w: World, u: Unit, t: Target): number {
  const d = UNITS[u.kind];
  let dmg = d.dmg;
  if (leaderNear(w, u)) dmg *= 1.15;
  if (u.buff > 0) dmg *= 1.3;
  if (u.owner === 0 && FIGHTERS.includes(u.kind)) {
    if (hasTech(w, 'flint')) dmg *= 1.15;
    if (anyTier(w, 'toolshelter', 2) && d.range < 2) dmg *= 1.1;
    dmg *= 1 + 0.1 * rankOf(u);
  }
  if (u.owner === 0 && hasDisc(w, 'heat') && ['hunter', 'guard', 'raider', 'leader'].includes(u.kind)) dmg *= 1.25;
  if (u.owner === 0 && hasDisc(w, 'portable') && !isBuilding(t) && t.kind === 'wolf' && (u.kind === 'hunter' || u.kind === 'guard')) dmg *= 1.4;
  if (isBuilding(t) && t.kind === 'palisade' && (u.kind === 'raider' || u.kind === 'brute')) dmg *= 1.5;
  if (isBuilding(t) && u.kind === 'brute') dmg *= 1.5;
  return dmg;
}

export function damage(w: World, t: Target, amount: number, from?: Unit) {
  t.hp -= amount;
  if (from && !isBuilding(t)) t.lastHit = from.id;
  if (t.owner === 0 && from && from.owner !== 0) w.alert = { x: isBuilding(t) ? t.x + t.w / 2 : t.x, y: isBuilding(t) ? t.y + t.h / 2 : t.y, t: w.time };
  if (!isBuilding(t)) {
    if (t.kind === 'deer' && t.hp > 0 && from) {
      const dx = t.x - from.x, dy = t.y - from.y, d = Math.hypot(dx, dy) || 1;
      const p = nearestFree(w, t.x + (dx / d) * 9, t.y + (dy / d) * 9);
      t.order = { t: 'flee', x: p.x, y: p.y }; t.path = null;
    }
    if (t.kind === 'mammoth' && from && t.hp > 0 && t.order.t !== 'attack') { t.order = { t: 'attack', target: from.id }; t.path = null; emit(w, { k: 'howl', x: t.x, y: t.y, owner: 2, kind: 'mammoth' }); }
    if (from && t.owner !== 2 && t.order.t === 'idle' && UNITS[t.kind].aggro > 0) { t.order = { t: 'attack', target: from.id }; t.path = null; }
    if (t.owner === 0 && t.hp > 0 && w.time - (w.log[w.log.length - 1]?.t ?? -99) > 8 && from && from.owner !== 0 && t.kind === 'gatherer') {
      log(w, 'Workers are under attack!', 'bad');
    }
  }
}

function strike(w: World, u: Unit, t: Target) {
  const d = UNITS[u.kind];
  u.cd = d.cd;
  const c = tCenter(t);
  if (d.range > 2) w._fx?.push({ x1: u.x, y1: u.y, x2: c.x, y2: c.y, t: 0.18, c: u.owner === 0 ? '#ffd27a' : '#ff8a7a' });
  else w._fx?.push({ x1: c.x, y1: c.y, x2: c.x, y2: c.y, t: 0.12, c: '#ffffff' });
  emit(w, { k: d.range > 2 ? 'shoot' : 'hit', x: u.x, y: u.y, x2: c.x, y2: c.y, owner: u.owner, kind: u.kind });
  damage(w, t, damageOf(w, u, t), u);
}

/** Pursue and hit a target. Returns false when the target is gone. */
function fight(w: World, u: Unit, t: Target, hold = false): boolean {
  const d = UNITS[u.kind];
  const c = tCenter(t);
  const gap = dist(u.x, u.y, c.x, c.y) - tRadius(t);
  if (gap <= d.range + 0.25) {
    u.path = null;
    if (u.cd <= 0 && d.dmg > 0) strike(w, u, t);
  } else if (!hold) {
    const r = moveTo(w, u, c.x, c.y, d.range + tRadius(t) - 0.1, isBuilding(t) ? footprint(t) : undefined);
    if (r === 'stuck') return false;
  }
  return true;
}

// ---------------------------------------------------------------- resources
export function nearestNode(w: World, x: number, y: number, res: ResNode['res'], maxD = 60, exceptId = -1): ResNode | undefined {
  let best: ResNode | undefined, bd = maxD;
  for (const n of w.nodes) {
    if (n.res !== res || n.id === exceptId || n.amount < (n.regen ? 8 : 1)) continue;
    if (!isExplored(w, n.x, n.y)) continue;
    const d = dist(x, y, n.x + 0.5, n.y + 0.5);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

export function autoWork(w: World, u: Unit) {
  if (u.kind !== 'gatherer' && u.kind !== 'hunter') return;
  const counts = { food: 0, wood: 0 };
  for (const o of w.units) {
    if (o.owner === u.owner && o.order.t === 'gather') {
      const n = nodeById(w, o.order.node); if (n && (n.res === 'food' || n.res === 'wood')) counts[n.res]++;
    }
  }
  const want: ResNode['res'] = u.kind === 'hunter' || counts.food <= counts.wood ? 'food' : 'wood';
  const n = nearestNode(w, u.x, u.y, want) ?? nearestNode(w, u.x, u.y, want === 'food' ? 'wood' : 'food');
  if (n) setOrder(u, { t: 'gather', node: n.id });
}

function removeNode(w: World, n: ResNode) {
  w.nodes.splice(w.nodes.indexOf(n), 1); w._n?.delete(n.id);
  if (n.kind !== 'carcass') rebuildBlocked(w);
}

function doGather(w: World, u: Unit) {
  const o = u.order as { t: 'gather'; node: number };
  const node = nodeById(w, o.node);
  const cap = Math.round(UNITS[u.kind].carry * (u.owner === 0 && hasTech(w, 'baskets') ? 1.5 : 1));
  const gone = !node || node.amount < 1;
  if (u.carry.n >= cap || (gone && u.carry.n > 0)) {
    const drop = nearestDropoff(w, u);
    if (!drop) { if (gone) setOrder(u, { t: 'idle' }); return; }
    const c = bCenter(drop);
    const r = moveTo(w, u, c.x, c.y, bRadius(drop) + 0.9, footprint(drop));
    if (r === 'arrived') {
      if (u.owner === 0 && u.carry.res) {
        const amt = u.carry.res === 'food' ? Math.round(u.carry.n * foodMult(w)) : u.carry.n;
        w.res[u.carry.res] += amt;
        emit(w, { k: 'deliver', x: u.x, y: u.y, owner: 0, res: u.carry.res, n: amt });
        if (u.carry.res === 'food') { w.stats.food += u.carry.n; if (u.carry.meat) w.stats.meat += u.carry.n; }
      }
      u.carry = { res: null, n: 0, meat: false };
    } else if (r === 'stuck') setOrder(u, { t: 'idle' });
    return;
  }
  if (gone) {
    const near = node ?? undefined;
    const res = near?.res ?? u.carry.res ?? 'food';
    const alt = nearestNode(w, u.x, u.y, res, 16);
    if (alt) o.node = alt.id; else setOrder(u, { t: 'idle' });
    return;
  }
  if (node.res === 'food' && node.kind !== 'carcass' && node.amount < 8) {
    const alt = nearestNode(w, u.x, u.y, 'food', 16, node.id);
    if (alt) { o.node = alt.id; return; }
  }
  if (u.kind === 'hunter' && node.res !== 'food') { setOrder(u, { t: 'idle' }); return; }
  if (u.carry.res && u.carry.res !== node.res) u.carry = { res: null, n: 0, meat: false };
  const r = moveTo(w, u, node.x + 0.5, node.y + 0.5, 1.5, { x: node.x, y: node.y, w: 1, h: 1 });
  if (r === 'stuck') { setOrder(u, { t: 'idle' }); return; }
  if (r === 'arrived') {
    u.work += gatherRate(w, u, node.res, node.kind === 'carcass', node.kind === 'fish') * DT;
    while (u.work >= 1 && u.carry.n < cap && node.amount >= 1) {
      u.work -= 1; u.carry.res = node.res; u.carry.n++; node.amount--; u.carry.meat = node.kind === 'carcass';
      if (u.owner === 0 && u.carry.n % 2 === 1) emit(w, { k: node.res === 'wood' ? 'chop' : node.res === 'stone' ? 'mine' : 'pick', x: node.x + 0.5, y: node.y + 0.5, owner: 0 });
      if (node.kind === 'carcass') u.work = Math.min(u.work, 0.99);
    }
    if (node.amount < 1 && !node.regen) { if (node.kind === 'tree') emit(w, { k: 'felled', x: node.x + 0.5, y: node.y + 0.5 }); removeNode(w, node); }
  }
}

// ---------------------------------------------------------------- building
function doBuild(w: World, u: Unit, o: { t: 'build'; b: number }) {
  const b = buildingById(w, o.b);
  if (!b || b.done) {
    // look for another unfinished site nearby, else go back to work
    const next = w.buildings.find((s) => s.owner === u.owner && !s.done && dist(bCenter(s).x, bCenter(s).y, u.x, u.y) < 10);
    if (next) setOrder(u, { t: 'build', b: next.id }); else { setOrder(u, { t: 'idle' }); autoWork(w, u); }
    return;
  }
  const c = bCenter(b);
  const r = moveTo(w, u, c.x, c.y, bRadius(b) + 0.9, footprint(b));
  if (r === 'stuck') { setOrder(u, { t: 'idle' }); return; }
  if (r === 'arrived') {
    const def = BUILDINGS[b.kind];
    b.progress = Math.min(1, b.progress + DT / def.time);
    if ((w.tick + u.id) % 9 === 0) emit(w, { k: 'hammer', x: u.x, y: u.y, owner: b.owner });
    b.hp = Math.min(b.maxHp, b.maxHp * (0.1 + 0.9 * b.progress));
    if (b.progress >= 1) {
      b.done = true; b.hp = b.maxHp;
      if (b.owner === 0) log(w, `${def.name} completed.`, 'good');
      emit(w, { k: 'built', x: c.x, y: c.y, owner: b.owner, kind: b.kind });
    }
  }
}

// ---------------------------------------------------------------- per-unit tick
function wander(w: World, u: Unit) {
  if (rand(w) < 0.01) {
    const a = rand(w) * Math.PI * 2, r = 1 + rand(w) * 3;
    const p = nearestFree(w, u.home.x + Math.cos(a) * r, u.home.y + Math.sin(a) * r);
    u.order = { t: 'flee', x: p.x, y: p.y }; u.path = null;
  }
}

function updateWolf(w: World, u: Unit) {
  if (u.order.t === 'idle') {
    // torches drive wolves off
    if (hasDisc(w, 'portable')) {
      const torch = w.units.find((o) => o.owner === 0 && (o.kind === 'hunter' || o.kind === 'guard' || o.kind === 'leader') && dist(o.x, o.y, u.x, u.y) < 5);
      if (torch) {
        const dx = u.x - torch.x, dy = u.y - torch.y, d = Math.hypot(dx, dy) || 1;
        const p = nearestFree(w, u.x + (dx / d) * 8, u.y + (dy / d) * 8);
        u.order = { t: 'flee', x: p.x, y: p.y }; u.path = null; return;
      }
    }
    if ((w.tick + u.id) % 5 === 0) {
      const t = findEnemy(w, u, 7, false);
      if (t && dist(t.x, t.y, u.home.x, u.home.y) < 18) { u.order = { t: 'attack', target: t.id }; u.path = null; emit(w, { k: 'howl', x: u.x, y: u.y, owner: 2, kind: 'wolf' }); return; }
    }
    if (dist(u.x, u.y, u.home.x, u.home.y) > 3) moveTo(w, u, u.home.x, u.home.y, 1.5);
    else wander(w, u);
  }
}

export function updateUnit(w: World, u: Unit) {
  u.ox = u.x; u.oy = u.y;
  if (u.cd > 0) u.cd -= DT;
  if (u.pcd > 0) u.pcd -= DT;
  if (u.buff > 0) u.buff -= DT;
  if (u.ability > 0) u.ability -= DT;
  const def = UNITS[u.kind];
  const o = u.order;
  switch (o.t) {
    case 'idle': {
      if (u.kind === 'wolf') { updateWolf(w, u); break; }
      if (u.kind === 'deer') { wander(w, u); break; }
      if (u.kind === 'mammoth') { if (dist(u.x, u.y, u.home.x, u.home.y) > 4) moveTo(w, u, u.home.x, u.home.y, 2); else wander(w, u); break; }
      if (def.aggro > 0 && (w.tick + u.id) % 5 === 0) {
        const hunting = u.owner === 0 && u.kind === 'hunter';
        const t = findEnemy(w, u, def.aggro, false, hunting);
        if (t) { u.order = { t: 'attack', target: t.id }; u.path = null; break; }
      }
      if (u.role === 'garrison' && dist(u.x, u.y, u.home.x, u.home.y) > 1.5) moveTo(w, u, u.home.x, u.home.y, 1);
      break;
    }
    case 'hold': {
      if ((w.tick + u.id) % 3 === 0) {
        const t = findEnemy(w, u, def.range + 0.5, false);
        if (t) fight(w, u, t, true);
      }
      break;
    }
    case 'move': case 'flee': {
      const r = moveTo(w, u, o.x, o.y, 0.45);
      if (r !== 'moving') { u.order = { t: 'idle' }; u.path = null; }
      break;
    }
    case 'amove': case 'patrol': {
      let t = u.tgt >= 0 ? getTarget(w, u.tgt) : undefined;
      if (t && dist(u.x, u.y, tCenter(t).x, tCenter(t).y) > def.aggro * 1.8 + 3) t = undefined;
      if (!t && (w.tick + u.id) % 4 === 0) {
        t = findEnemy(w, u, Math.max(def.aggro, 5), true, false);
        u.tgt = t ? t.id : -1;
      }
      if (t) { if (!fight(w, u, t)) u.tgt = -1; }
      else {
        const r = moveTo(w, u, o.x, o.y, 0.8);
        if (r !== 'moving') {
          if (o.t === 'patrol' && r === 'arrived') u.order = { t: 'patrol', x: o.x2, y: o.y2, x2: o.x, y2: o.y }; // turn round
          else u.order = { t: 'idle' };
          u.path = null;
        }
      }
      break;
    }
    case 'attack': {
      const t = getTarget(w, o.target);
      if (!t || (!isBuilding(t) && t.owner === u.owner) || (u.owner !== 2 && !isBuilding(t) && t.kind !== 'deer' && !hostile(w, u.owner, t.owner))) {
        const c = w._carc?.get(o.target);
        const cn = c ? nodeById(w, c) : undefined;
        if (cn && u.owner === 0 && (u.kind === 'hunter' || u.kind === 'gatherer')) { setOrder(u, { t: 'gather', node: cn.id }); u.work = 0; }
        else setOrder(u, { t: 'idle' });
        break;
      }
      if (u.kind === 'wolf' && dist(u.x, u.y, u.home.x, u.home.y) > 22) { setOrder(u, { t: 'idle' }); break; }
      if (u.kind === 'mammoth' && dist(u.x, u.y, u.home.x, u.home.y) > 15) { setOrder(u, { t: 'idle' }); break; }
      if (u.role === 'garrison' && dist(u.x, u.y, u.home.x, u.home.y) > 11) { setOrder(u, { t: 'move', x: u.home.x, y: u.home.y }); break; }
      if (!fight(w, u, t)) setOrder(u, { t: 'idle' });
      break;
    }
    case 'gather': doGather(w, u); break;
    case 'build': doBuild(w, u, o); break;
    case 'research': break;
  }
  // the current order finished: start the next shift-queued one
  if (u.order.t === 'idle' && u.q?.length) setOrder(u, u.q.shift()!);
}

/** Soft separation so units do not stack on one pixel. */
export function separate(w: World) {
  const us = w.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) continue;
      const d = Math.hypot(dx, dy);
      if (d >= 0.55) continue;
      const push = (0.55 - d) * 0.25;
      const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
      const ax = a.x - nx * push, ay = a.y - ny * push, bx = b.x + nx * push, by = b.y + ny * push;
      if (!isBlocked(w, Math.floor(ax), Math.floor(ay))) { a.x = ax; a.y = ay; }
      if (!isBlocked(w, Math.floor(bx), Math.floor(by))) { b.x = bx; b.y = by; }
    }
  }
}

export function carcassAt(w: World, deer: Unit, amount = 70) {
  const tx = Math.floor(deer.x), ty = Math.floor(deer.y);
  const n: ResNode = {
    id: w.nextId++, kind: 'carcass', res: 'food', x: tx, y: ty, amount, max: amount, regen: 0,
  };
  w.nodes.push(n); w._n?.set(n.id, n);
  w._carc ??= new Map();
  w._carc.set(deer.id, n.id);
}
