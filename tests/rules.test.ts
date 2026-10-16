import { describe, expect, it } from 'vitest';
import { cmdContext, cmdGift, cmdInvestigate, cmdPlace, cmdTeach, placeCheck } from '../src/sim/commands';
import { costMultiplier, discCost, discTime, investigateCheck } from '../src/sim/discovery';
import { economySecond } from '../src/sim/econ';
import { gatherRate, isWarm, supplyRange, visionOf } from '../src/sim/rules';
import { advanceGeneration, canSucceed } from '../src/sim/succession';
import { cmdUpgrade } from '../src/sim/upgrades';
import { makeBuilding, makeUnit, meadowOf } from '../src/sim/world';
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

describe('specialist knowledge risk & multi-generational progression', () => {
  it('tracks the specialist who makes a discovery and degrades unpreserved knowledge if they die', () => {
    const w = newWorld();
    makeBuilding(w, 'stockpile', 0, 14, 30, true);
    makeBuilding(w, 'circle', 0, 18, 30, true);
    w.disc.preservation = 'clue';
    w.res = { food: 200, wood: 200, stone: 200, knowledge: 200, provisions: 50 };
    expect(cmdInvestigate(w, 'preservation').ok).toBe(true);
    run(w, 45);
    expect(w.disc.preservation).toBe('known');
    const specId = w.specialists?.preservation;
    expect(specId).toBeDefined();

    // If the specialist dies before teaching finishes, the discovery degrades to faded
    const specUnit = w.units.find((u) => u.id === specId)!;
    specUnit.hp = 0;
    run(w, 1);
    expect(w.disc.preservation).toBe('faded');
    expect(w.specialists?.preservation).toBeUndefined();
  });

  it('protects preserved discoveries even if the original specialist later dies', () => {
    const w = newWorld();
    makeBuilding(w, 'circle', 0, 14, 30, true);
    w.disc.cooking = 'clue';
    w.res = { food: 200, wood: 200, stone: 200, knowledge: 200, provisions: 50 };
    expect(cmdInvestigate(w, 'cooking').ok).toBe(true);
    run(w, 30);
    expect(w.disc.cooking).toBe('known');
    const specId = w.specialists?.cooking;
    expect(specId).toBeDefined();

    expect(cmdTeach(w, 'cooking').ok).toBe(true);
    run(w, 25);
    expect(w.disc.cooking).toBe('preserved');
    expect(w.specialists?.cooking).toBeUndefined();

    const specUnit = w.units.find((u) => u.id === specId)!;
    specUnit.hp = 0;
    run(w, 1);
    expect(w.disc.cooking).toBe('preserved');
  });

  it('supports Generation 3+ succession, ancestral legacy bonuses, and deep ancestral mastery discount (0.55x)', () => {
    const w = newWorld();
    const g = mine(w, 'gatherer')[0];
    const baseGather = gatherRate(w, g, 'food', false);
    const baseVis = visionOf(w, g, 6);
    const baseDiscTime = discTime(w, 'preservation');

    // Gen 1 -> Gen 2 (pick 0 = logistics)
    w.disc.preservation = 'preserved';
    w.disc.cooking = 'preserved';
    w.time = w.winter.end + 1;
    expect(canSucceed(w)).toBe(true);
    advanceGeneration(w, 0);
    expect(w.gen).toBe(2);

    // Gen 2 -> Gen 3 (pick 1 = recon)
    w.disc.pottery = 'preserved';
    w.disc.farming = 'preserved';
    w.time = w.winter.end + 1;
    expect(canSucceed(w)).toBe(true);
    advanceGeneration(w, 1);
    expect(w.gen).toBe(3);

    // Gen 3 -> Gen 4 (pick 2 = teaching)
    w.time = w.winter.end + 1;
    expect(canSucceed(w)).toBe(true);
    advanceGeneration(w, 2);
    expect(w.gen).toBe(4);

    const gAfter = mine(w, 'gatherer')[0];
    // Ancestral legacy bonuses in Gen 3+ (logistics & recon in lineage, teaching active)
    expect(gatherRate(w, gAfter, 'food', false)).toBeGreaterThan(baseGather);
    expect(visionOf(w, gAfter, 6)).toBeGreaterThan(baseVis);
    expect(discTime(w, 'preservation')).toBeLessThan(baseDiscTime);

    // Deep ancestral mastery: kiln has parent pottery (preserved) and grandparent cooking (preserved) in Gen 3+
    expect(costMultiplier(w, 'kiln')).toBeCloseTo(0.55);
    expect(costMultiplier(w, 'irrigation')).toBeCloseTo(0.55);
    const kilnCost = discCost(w, 'kiln');
    expect(kilnCost.knowledge).toBe(Math.ceil(45 * 0.55));
  });
});

describe('Era II and Era III discovery branches & Crop field', () => {
  it('pottery reduces winter spoilage, extends supply range, and boosts smoking rack output', () => {
    const wBase = newWorld();
    const wPot = newWorld();
    wPot.disc.pottery = 'known';

    expect(supplyRange(wPot)).toBe(supplyRange(wBase) + 6);

    wBase.time = wBase.winter.start + 5;
    wPot.time = wPot.winter.start + 5;
    wBase.res.food = 300;
    wPot.res.food = 300;
    for (let i = 0; i < 10; i++) {
      economySecond(wBase);
      economySecond(wPot);
    }
    expect(wPot.res.food).toBeGreaterThan(wBase.res.food);

    // Smoking rack batch bonus (+2 provisions with pottery: 6 base + 2 pottery = 8 after 6 seconds)
    const wRack = newWorld();
    wRack.disc.preservation = 'known';
    wRack.disc.pottery = 'known';
    makeBuilding(wRack, 'rack', 0, 14, 30, true);
    wRack.res.food = 100;
    for (let i = 0; i < 6; i++) economySecond(wRack);
    expect(wRack.res.provisions).toBe(8);
  });

  it('farming unlocks buildable Crop fields and irrigation boosts field harvests through winter', () => {
    const w = newWorld();
    const hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth')!;
    w.res = { food: 200, wood: 200, stone: 200, knowledge: 200, provisions: 50 };
    expect(placeCheck(w, 'field', hearth.x + 4, hearth.y).ok).toBe(false);

    w.disc.farming = 'known';
    expect(placeCheck(w, 'field', hearth.x + 4, hearth.y).ok).toBe(true);
    const field = makeBuilding(w, 'field', 0, hearth.x + 4, hearth.y, true);

    const beforeStats = w.stats.food;
    for (let i = 0; i < 5; i++) economySecond(w);
    const gainedBase = w.stats.food - beforeStats;
    expect(gainedBase).toBe(4);

    // Upgrade to Irrigated terrace + discover irrigation in winter
    w.disc.irrigation = 'known';
    expect(cmdUpgrade(w, field.id).ok).toBe(true);
    run(w, 25);
    expect(field.tier).toBe(1);

    w.time = w.winter.start + 5;
    field.tick = 0;
    const beforeIrr = w.stats.food;
    for (let i = 0; i < 5; i++) economySecond(w);
    const gainedIrr = w.stats.food - beforeIrr;
    expect(gainedIrr).toBe(Math.round(6 * 1.6));
  });

  it('boats reduce expedition provision upkeep and boost fishing gather rate', () => {
    const w = newWorld();
    const g = mine(w, 'gatherer')[0];
    const baseFish = gatherRate(w, g, 'food', false, true);
    w.disc.boats = 'known';
    expect(gatherRate(w, g, 'food', false, true)).toBeCloseTo(baseFish * 1.5);

    // Expedition upkeep reduction
    const wNoBoats = newWorld();
    const wBoats = newWorld();
    wBoats.disc.boats = 'known';
    wNoBoats.res.provisions = 50;
    wBoats.res.provisions = 50;
    // Move a unit far outside supply range
    wNoBoats.units[0].x = 70; wNoBoats.units[0].y = 70;
    wBoats.units[0].x = 70; wBoats.units[0].y = 70;
    economySecond(wNoBoats);
    economySecond(wBoats);
    expect(wBoats.res.provisions).toBeGreaterThan(wNoBoats.res.provisions);
  });

  it('kiln reinforces building HP (+35%), expands warmth radius (+3), and requires Gen 3', () => {
    const w = newWorld();
    makeBuilding(w, 'stockpile', 0, 10, 30, true);
    makeBuilding(w, 'toolshelter', 0, 14, 30, true);
    makeBuilding(w, 'circle', 0, 18, 30, true);
    w.res = { food: 200, wood: 200, stone: 200, knowledge: 200, provisions: 50 };
    w.disc.pottery = 'known';
    w.disc.kiln = 'clue';
    w.gen = 2;
    expect(investigateCheck(w, 'kiln').ok).toBe(false);
    w.gen = 3;
    expect(investigateCheck(w, 'kiln').ok).toBe(true);

    const hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth')!;
    const warmPointX = hearth.x + 1.5 + 11.5;
    const warmPointY = hearth.y + 1.5;
    expect(isWarm(w, warmPointX, warmPointY)).toBe(false);

    w.disc.kiln = 'known';
    expect(isWarm(w, warmPointX, warmPointY)).toBe(true);

    const shelter = makeBuilding(w, 'shelter', 0, hearth.x - 4, hearth.y, true);
    expect(shelter.maxHp).toBe(Math.round(160 * 1.35));
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
    const MEADOW = meadowOf(w); const x = MEADOW.x - 1, y = MEADOW.y - 1;
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

