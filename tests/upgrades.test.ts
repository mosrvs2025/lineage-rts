import { UNITS } from "../src/data/units";
import { describe, expect, it } from 'vitest';
import { cmdTrain, trainCheck } from '../src/sim/commands';
import { cmdUpgrade, cmdResearch, upgradeCheck, cancelUpgrade } from '../src/sim/upgrades';
import { popCap, hasTech } from '../src/sim/rules';
import { makeBuilding, makeUnit } from '../src/sim/world';
import { newWorld, run } from './helpers';

const rich = (w: ReturnType<typeof newWorld>) => { w.res.food = w.res.wood = w.res.stone = w.res.knowledge = 500; };
const first = (w: ReturnType<typeof newWorld>, kind: string) => w.buildings.find((b) => b.owner === 0 && b.kind === kind)!;

describe('building upgrades', () => {
  it('upgrades a shelter into a longhouse: more housing, more health, costs resources', () => {
    const w = newWorld(); rich(w);
    const s = makeBuilding(w, 'shelter', 0, 20, 28, true);
    const cap = popCap(w), hp = s.maxHp, wood = w.res.wood;
    expect(cmdUpgrade(w, s.id).ok).toBe(true);
    expect(w.res.wood).toBeLessThan(wood);
    expect(cmdUpgrade(w, s.id).ok).toBe(false); // already upgrading
    run(w, 25);
    expect(s.tier).toBe(1);
    expect(popCap(w)).toBe(cap + 4);
    expect(s.maxHp).toBeGreaterThan(hp);
    expect(upgradeCheck(w, s.id).reason).toMatch(/Fully/);
  });
  it('gates hearth upgrades behind discoveries and refunds on cancel', () => {
    const w = newWorld(); rich(w);
    const h = first(w, 'hearth');
    expect(upgradeCheck(w, h.id).ok).toBe(false);
    w.disc.cooking = 'known';
    const k = w.res.knowledge;
    expect(cmdUpgrade(w, h.id).ok).toBe(true);
    cancelUpgrade(w, h.id);
    expect(h.upg).toBeUndefined();
    expect(w.res.knowledge).toBeGreaterThan(k - 25);
  });
});

describe('new units', () => {
  it('gates champions behind a war lodge and species units behind species', () => {
    const w = newWorld(); rich(w);
    makeBuilding(w, 'toolshelter', 0, 24, 30, true);
    const l = makeBuilding(w, 'lodge', 0, 28, 30, true);
    expect(trainCheck(w, l.id, 'champion').ok).toBe(false);
    expect(trainCheck(w, l.id, 'slinger').ok).toBe(true);
    expect(trainCheck(w, l.id, 'brute').ok).toBe(false);
    cmdUpgrade(w, l.id); run(w, 40);
    expect(trainCheck(w, l.id, 'champion').ok).toBe(true);
    const n = newWorld('neanderthal'); rich(n);
    makeBuilding(n, 'toolshelter', 0, 24, 30, true);
    const nl = makeBuilding(n, 'lodge', 0, 28, 30, true);
    expect(trainCheck(n, nl.id, 'brute').ok).toBe(true);
    expect(trainCheck(n, nl.id, 'slinger').ok).toBe(false);
  });
  it('trains an elder at the circle and heals the wounded', () => {
    const w = newWorld(); rich(w);
    const c = makeBuilding(w, 'circle', 0, 20, 30, true);
    expect(cmdTrain(w, c.id, 'elder').ok).toBe(true);
    run(w, 30);
    const e = w.units.find((u) => u.kind === 'elder')!;
    expect(e).toBeTruthy();
    const g = makeUnit(w, 'guard', 0, e.x + 1, e.y); g.hp = 10;
    run(w, 5);
    expect(g.hp).toBeGreaterThan(14);
  });
});

describe('research', () => {
  it('learns a technology that changes the simulation', () => {
    const w = newWorld(); rich(w);
    const s = makeBuilding(w, 'stockpile', 0, 20, 28, true);
    expect(cmdResearch(w, s.id, 'baskets').ok).toBe(true);
    expect(cmdResearch(w, s.id, 'baskets').ok).toBe(false);
    run(w, 30);
    expect(hasTech(w, 'baskets')).toBe(true);
  });
});

describe('archer post & veterancy', () => {
  it('an upgraded watch post shoots wolves and promotes nothing', () => {
    const w = newWorld(); rich(w);
    const t = makeBuilding(w, 'watch', 0, 20, 28, true);
    cmdUpgrade(w, t.id); run(w, 30);
    const wolf = makeUnit(w, 'wolf', 2, 24, 29);
    wolf.order = { t: 'idle' }; wolf.home = { x: 24, y: 29 };
    const hp = wolf.hp; run(w, 4);
    expect(wolf.hp).toBeLessThan(hp);
  });
  it('promotes a unit after kills', () => {
    const w = newWorld();
    const g = makeUnit(w, 'guard', 0, 30, 30);
    for (let i = 0; i < 3; i++) {
      const r = makeUnit(w, 'raider', 1, 31, 30); r.hp = 0; r.lastHit = g.id; run(w, 1);
    }
    expect(g.kills).toBe(3);
    expect(g.maxHp).toBeGreaterThan(UNITS.guard.hp);
  });
});

describe('rival clan', () => {
  it('fortifies its watch post and fields heavier units later in the game', () => {
    const w = newWorld();
    const post = w.buildings.find((b) => b.owner === 1 && b.kind === 'watch')!;
    expect(post.tier).toBe(0);
    w.time = 700; w.ai.supply = 400; w.ai.nextSpawn = 0;
    run(w, 3);
    expect(post.tier).toBe(1);
  });
});

describe('rally points & alerts', () => {
  it('sends trained units to the rally point, and gatherers straight to work on a resource', async () => {
    const { cmdSetRally } = await import('../src/sim/commands');
    const w = newWorld(); rich(w);
    const h = first(w, 'hearth');
    const { nearestNode } = await import('../src/sim/units');
    const tree = nearestNode(w, h.x + 1, h.y + 1, 'wood')!;
    expect(cmdSetRally(w, h.id, tree.x + 0.5, tree.y + 0.5).ok).toBe(true);
    cmdTrain(w, h.id, 'gatherer'); run(w, 25);
    const g = w.units.filter((u) => u.kind === 'gatherer').pop()!;
    expect(g.order.t).toBe('gather');
    const n = w.nodes.find((x) => g.order.t === 'gather' && x.id === g.order.node)!;
    expect(n.res).toBe('wood'); expect(Math.hypot(n.x - tree.x, n.y - tree.y)).toBeLessThan(3);
  });
  it('remembers where the clan was last attacked', () => {
    const w = newWorld();
    const g = w.units.find((u) => u.owner === 0)!;
    const r = makeUnit(w, 'raider', 1, g.x + 0.5, g.y); r.order = { t: 'attack', target: g.id };
    w.truceUntil = 0; run(w, 3);
    expect(w.alert).toBeTruthy();
  });
});

describe('order queue & patrol', () => {
  it('runs shift-queued orders one after another', async () => {
    const { cmdMove } = await import('../src/sim/commands');
    const w = newWorld();
    const g = makeUnit(w, 'guard', 0, 12, 24);
    cmdMove(w, [g.id], 14, 24);
    g.q = [{ t: 'move', x: 14, y: 27 }, { t: 'move', x: 11, y: 27 }];
    run(w, 12);
    expect(g.q.length).toBe(0);
    expect(Math.hypot(g.x - 11, g.y - 27)).toBeLessThan(1);
  });
  it('a direct order replaces the queue', async () => {
    const { cmdMove } = await import('../src/sim/commands');
    const w = newWorld();
    const g = makeUnit(w, 'guard', 0, 12, 24);
    g.q = [{ t: 'move', x: 14, y: 27 }];
    cmdMove(w, [g.id], 13, 24);
    expect(g.q).toEqual([]);
  });
  it('patrols back and forth between two points', async () => {
    const { cmdPatrol } = await import('../src/sim/commands');
    const w = newWorld();
    const g = makeUnit(w, 'guard', 0, 12, 24);
    cmdPatrol(w, [g.id], 16, 24);
    let flips = 0, last = 16;
    for (let i = 0; i < 300; i++) { run(w, 0.05); const o = g.order as { t: string; x: number }; expect(o.t).toBe('patrol'); if (o.x !== last) { flips++; last = o.x; } }
    expect(flips).toBeGreaterThanOrEqual(2);
  });
});
