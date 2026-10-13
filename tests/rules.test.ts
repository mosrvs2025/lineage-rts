import { describe, expect, it } from 'vitest';
import { cmdContext, cmdGift, cmdPlace, placeCheck } from '../src/sim/commands';
import { economySecond } from '../src/sim/econ';
import { makeBuilding, makeUnit, MEADOW } from '../src/sim/world';
import { advanceGeneration } from '../src/sim/succession';
import { newWorld, run, mine } from './helpers';

describe('discovery effects change play', () => {
  it('cooking makes delivered food worth 25% more', () => {
    const measure = (cooked: boolean) => {
      const w = newWorld();
      if (cooked) w.disc.cooking = 'known';
      const g = mine(w, 'gatherer')[0];
      const bush = w.nodes.find((n) => n.kind === 'bush')!;
      cmdContext(w, [g.id], bush.x + 0.5, bush.y + 0.5);
      const before = w.res.food;
      run(w, 40);
      return { gained: w.res.food - before + w.units.length * 0, delivered: w.stats.food };
    };
    const a = measure(false), b = measure(true);
    expect(b.delivered).toBeGreaterThan(0);
    expect(b.gained / b.delivered).toBeGreaterThan(a.gained / a.delivered);
  });

  it('winter spoils loose food, but smoked provisions survive; racks convert food', () => {
    const w = newWorld();
    w.time = w.winter.start + 5;
    w.res.food = 300; w.res.provisions = 100;
    for (let i = 0; i < 20; i++) economySecond(w);
    expect(w.res.food).toBeLessThan(300 - 30);
    expect(w.res.provisions).toBeGreaterThan(80); // only eaten if food runs out
    const w2 = newWorld();
    w2.disc.preservation = 'known';
    makeBuilding(w2, 'rack', 0, 14, 30, true);
    w2.res.food = 100;
    for (let i = 0; i < 12; i++) economySecond(w2);
    expect(w2.res.provisions).toBeGreaterThanOrEqual(12);
  });

  it('a faded discovery stops working until relearned', () => {
    const w = newWorld();
    w.disc.preservation = 'known';
    w.time = w.winter.end + 1;
    advanceGeneration(w, 0);
    expect(w.disc.preservation).toBe('faded');
    expect(placeCheck(w, 'rack', 14, 30).ok).toBe(false);
  });

  it('torches drive wolves off workers once portable fire is known', () => {
    const w = newWorld();
    const wolf = makeUnit(w, 'wolf', 2, 20.5, 30.5);
    const worker = mine(w, 'gatherer')[0];
    worker.x = worker.ox = 20.5; worker.y = worker.oy = 31.5;
    const hunter = mine(w, 'hunter')[0];
    hunter.x = hunter.ox = 21.5; hunter.y = hunter.oy = 31.5;
    w.disc.portable = 'known';
    run(w, 6);
    expect(worker.hp).toBe(worker.maxHp);
    expect(Math.hypot(wolf.x - worker.x, wolf.y - worker.y)).toBeGreaterThan(2);
  });
});

describe('diplomacy and expeditions', () => {
  it('a gift pauses hostilities for the pass', () => {
    const w = newWorld();
    w.res.food = 100;
    expect(cmdGift(w).ok).toBe(true);
    expect(w.truceUntil).toBeGreaterThan(w.time);
    expect(cmdGift(w).ok).toBe(false);
  });

  it('the Far Meadow outpost needs generation 2 and enough provisions', () => {
    const w = newWorld();
    w._exp!.fill(1);
    const x = MEADOW.x - 1, y = MEADOW.y - 1;
    w.res.provisions = 200; w.res.wood = 100; w.res.stone = 50;
    expect(placeCheck(w, 'watch', x, y).reason).toMatch(/first generation/);
    w.gen = 2;
    w.res.provisions = 10;
    expect(placeCheck(w, 'watch', x, y).reason).toMatch(/provisions/);
    w.res.provisions = 80;
    const r = cmdPlace(w, 'watch', x, y, []);
    expect(r.ok).toBe(true);
    expect(w.res.provisions).toBe(45);
    expect(w.buildings.some((b) => b.outpost)).toBe(true);
  });

  it('is deterministic for a given seed', () => {
    const a = newWorld(), b = newWorld();
    run(a, 20); run(b, 20);
    expect(a.units.map((u) => [u.x, u.y])).toEqual(b.units.map((u) => [u.x, u.y]));
  });
});
