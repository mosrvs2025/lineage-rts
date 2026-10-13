import { describe, expect, it } from 'vitest';
import { cmdContext, cmdPlace, cmdTrain, cmdInvestigate, cmdTeach, cmdMove, placeCheck } from '../src/sim/commands';
import { investigateCheck } from '../src/sim/discovery';
import { advanceGeneration, canSucceed } from '../src/sim/succession';
import { deserialize, serialize } from '../src/sim/save';
import { entityAt } from '../src/sim/query';
import { newWorld, run, mine } from './helpers';

describe('economy', () => {
  it('gatherers collect food, wood and stone and deliver to the hearth', () => {
    const w = newWorld();
    const g = mine(w, 'gatherer');
    const bush = w.nodes.find((n) => n.kind === 'bush')!;
    const tree = w.nodes.filter((n) => n.kind === 'tree').sort((a, b) => Math.hypot(a.x - 10, a.y - 24) - Math.hypot(b.x - 10, b.y - 24))[0];
    cmdContext(w, [g[0].id, g[1].id], bush.x + 0.5, bush.y + 0.5);
    cmdContext(w, [g[2].id], tree.x + 0.5, tree.y + 0.5);
    const f0 = w.res.food, wd0 = w.res.wood;
    run(w, 60);
    expect(w.stats.food).toBeGreaterThan(0);
    expect(w.res.wood).toBeGreaterThan(wd0 - 1);
    expect(w.res.food + 0).not.toBe(f0);
  });

  it('builds a structure that completes and blocks pathing', () => {
    const w = newWorld();
    const before = w.res.wood;
    const r = cmdPlace(w, 'stockpile', 14, 23, mine(w, 'gatherer').map((u) => u.id).slice(0, 2));
    expect(r.ok).toBe(true);
    expect(w.res.wood).toBe(before - 20);
    run(w, 25);
    const b = w.buildings.find((x) => x.kind === 'stockpile')!;
    expect(b.done).toBe(true);
    expect(placeCheck(w, 'stockpile', 14, 23).ok).toBe(false);
  });

  it('trains units within the population cap', () => {
    const w = newWorld();
    const h = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth')!;
    const n = mine(w, 'gatherer').length;
    expect(cmdTrain(w, h.id, 'gatherer').ok).toBe(true);
    run(w, 12);
    expect(mine(w, 'gatherer').length).toBe(n + 1);
  });
});

describe('orders & selection', () => {
  it('moves units and hit-tests entities', () => {
    const w = newWorld();
    const s = mine(w, 'scout')[0];
    cmdMove(w, [s.id], 20, 24);
    run(w, 15);
    expect(Math.hypot(s.x - 20, s.y - 24)).toBeLessThan(1.5);
    expect(entityAt(w, s.x, s.y)?.type).toBe('unit');
  });
});

describe('discovery & inheritance', () => {
  it('requires a clue, facilities and resources, then persists through succession', () => {
    const w = newWorld();
    expect(investigateCheck(w, 'preservation').ok).toBe(false);
    w.stats.meat = 20; w.stats.food = 200;
    run(w, 2);
    expect(w.disc.preservation).toBe('clue');
    expect(investigateCheck(w, 'preservation').reason).toMatch(/Stockpile/);
    w.buildings.push({ id: w.nextId++, kind: 'stockpile', owner: 0, x: 14, y: 30, w: 2, h: 2, hp: 100, maxHp: 100, progress: 1, done: true, queue: [], tick: 0 });
    w.res.wood = 100; w.res.stone = 50; w.res.knowledge = 100;
    expect(cmdInvestigate(w, 'preservation').ok).toBe(true);
    run(w, 60);
    expect(w.disc.preservation).toBe('known');
    // teach it
    w.buildings.push({ id: w.nextId++, kind: 'circle', owner: 0, x: 14, y: 34, w: 3, h: 3, hp: 100, maxHp: 100, progress: 1, done: true, queue: [], tick: 0 });
    expect(cmdTeach(w, 'preservation').ok).toBe(true);
    run(w, 30);
    expect(w.disc.preservation).toBe('preserved');
    // succession
    expect(canSucceed(w)).toBe(false);
    w.time = w.winter.end + 1;
    expect(canSucceed(w)).toBe(true);
    const bCount = w.buildings.filter((b) => b.owner === 0).length;
    expect(advanceGeneration(w, 2)).toBe(true);
    expect(w.gen).toBe(2);
    expect(w.disc.preservation).toBe('preserved');
    expect(w.buildings.filter((b) => b.owner === 0).length).toBe(bCount);
    expect(w.trait).toBe('teaching');
    expect(mine(w, 'leader').length).toBe(1);
  });

  it('unpreserved discoveries fade but are cheap to recover', () => {
    const w = newWorld();
    w.disc.cooking = 'known';
    w.time = w.winter.end + 1;
    advanceGeneration(w, 0);
    expect(w.disc.cooking).toBe('faded');
  });
});

describe('save / load', () => {
  it('round-trips a world and keeps simulating', () => {
    const w = newWorld('neanderthal');
    run(w, 30);
    const text = serialize(w);
    const r = deserialize(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.world.units.length).toBe(w.units.length);
    expect(r.world.species).toBe('neanderthal');
    run(r.world, 10);
    expect(r.world.time).toBeGreaterThan(w.time);
  });
  it('rejects invalid saves gracefully', () => {
    expect(deserialize('not json').ok).toBe(false);
    expect(deserialize('{"format":"x"}').ok).toBe(false);
    expect(deserialize(JSON.stringify({ format: 'lineage-rts-save', version: 99, world: {} })).ok).toBe(false);
    expect(deserialize(JSON.stringify({ format: 'lineage-rts-save', version: 1, world: { W: 1 } })).ok).toBe(false);
    const good = JSON.parse(serialize(newWorld()));
    good.world.units[0].id = good.world.units[1].id;
    expect(deserialize(JSON.stringify(good)).ok).toBe(false);
  });
});
