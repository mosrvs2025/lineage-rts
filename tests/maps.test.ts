import { describe, expect, it } from 'vitest';
import { MAPS, MAP_ORDER } from '../src/data/maps';
import { findPath, isBlocked } from '../src/sim/grid';
import { meadowOf } from '../src/sim/world';
import { cmdContext } from '../src/sim/commands';
import { newWorld, run } from './helpers';

const pathLen = (p: { x: number; y: number }[] | null, sx: number, sy: number) => { if (!p) return Infinity; let d = 0, a = { x: sx, y: sy }; for (const q of p) { d += Math.hypot(q.x - a.x, q.y - a.y); a = q; } return d; };

describe('maps', () => {
  for (const id of MAP_ORDER) {
    it(`${id}: generates a connected, fair map`, () => {
      const w = newWorld('human', id);
      expect(w.map).toBe(id);
      expect(w.winter).toEqual(MAPS[id].winter);
      const M = MAPS[id], hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth')!, rival = w.buildings.find((b) => b.owner === 1 && b.kind === 'hearth')!;
      const sx = hearth.x + 1, sy = hearth.y + 3.5;
      const trees = w.nodes.filter((n) => n.kind === 'tree').length, rocks = w.nodes.filter((n) => n.kind === 'rock').length, food = w.nodes.filter((n) => n.res === 'food' && n.kind !== 'carcass').length;
      expect(trees).toBeGreaterThan(30); expect(rocks).toBeGreaterThan(5); expect(food).toBeGreaterThan(8);
      // a gatherer at home can reach wood, stone and food without leaving the neighbourhood
      for (const r of ['wood', 'stone', 'food'] as const) {
        const near = w.nodes.filter((n) => n.res === r && Math.hypot(n.x - sx, n.y - sy) < 22).length;
        expect(near, `${r} near the start`).toBeGreaterThan(2);
      }
      expect(findPath(w, sx, sy, meadowOf(w).x + 0.5, meadowOf(w).y + 0.5)).not.toBeNull();
      expect(findPath(w, sx, sy, rival.x + 1, rival.y + 3.5)).not.toBeNull();
      expect(findPath(w, sx, sy, M.cave.x + 0.5, M.cave.y + 1.5)).not.toBeNull();
      expect(findPath(w, sx, sy, M.stage.x, M.stage.y)).not.toBeNull();
      for (const n of w.nodes) if (n.kind !== 'fish') expect(w.terrain[n.y][n.x]).toBe('.');
    });
  }

  it('the four maps genuinely differ in shape, terrain mix and mechanics', () => {
    const stat = (id: string) => {
      const w = newWorld('human', id), t = w.terrain.join('');
      const share = (c: string) => t.split(c).length - 1;
      return { land: share('.') / t.length, water: (share('~') + share('L')) / t.length, rock: share('^') / t.length, lake: share('L'), shallows: share('='), fish: w.nodes.filter((n) => n.kind === 'fish').length, mammoths: w.units.filter((u) => u.kind === 'mammoth').length };
    };
    const [v, g, i, c] = ['valley', 'glasswater', 'isles', 'canyon'].map(stat);
    expect(g.lake).toBeGreaterThan(300); expect(v.lake).toBe(0);                       // only Glasswater has the freezing lake
    expect(i.water).toBeGreaterThan(0.4); expect(v.water).toBeLessThan(0.15);          // the isles are mostly sea
    expect(c.rock).toBeGreaterThan(0.45); expect(v.rock).toBeLessThan(0.2);             // the canyon is mostly rock
    expect(c.mammoths).toBeGreaterThanOrEqual(4); expect(v.mammoths).toBe(0);
    expect(i.fish).toBeGreaterThan(10); expect(g.fish).toBeGreaterThan(3); expect(v.fish).toBe(0);
  });

  it('Glasswater: the lake blocks in summer, you can walk across the ice in winter, and it thaws', () => {
    const w = newWorld('human', 'glasswater');
    const a = { x: 22, y: 24 }, b = { x: 50, y: 24 };       // either side of the lake
    expect(isBlocked(w, 36, 24)).toBe(true);
    const summer = pathLen(findPath(w, a.x, a.y, b.x, b.y), a.x, a.y);
    w.time = w.winter.start + 5; run(w, 2);
    expect(w._frozen).toBe(true);
    expect(isBlocked(w, 36, 24)).toBe(false);
    const winter = pathLen(findPath(w, a.x, a.y, b.x, b.y), a.x, a.y);
    expect(winter).toBeLessThan(summer * 0.7);               // the ice is a genuine shortcut
    const u = w.units.find((x) => x.owner === 0 && x.kind === 'gatherer')!; u.x = u.ox = 36.5; u.y = u.oy = 24.5; u.hp = u.maxHp;
    w.time = w.winter.end + 5; run(w, 2);
    expect(w._frozen).toBe(false);
    expect(w.terrain[Math.floor(u.y)][Math.floor(u.x)]).not.toBe('L');   // thaw: pushed ashore
    expect(u.hp).toBeLessThan(u.maxHp);
  });

  it('The Isles: fishing spots feed gatherers endlessly', () => {
    const w = newWorld('human', 'isles');
    const spot = w.nodes.filter((n) => n.kind === 'fish').sort((p, q) => Math.hypot(p.x - 10, p.y - 24) - Math.hypot(q.x - 10, q.y - 24))[0];
    expect(spot).toBeTruthy();
    const g = w.units.find((u) => u.owner === 0 && u.kind === 'gatherer')!;
    const f0 = w.stats.food;
    cmdContext(w, [g.id], spot.x + 0.5, spot.y + 0.5, { type: 'node', node: spot });
    run(w, 150);
    expect(w.stats.food).toBeGreaterThan(f0 + 8);
    expect(spot.amount).toBeGreaterThan(0);                  // regenerates
  });

  it('Mammoth Canyon: mammoths are peaceful until struck, then stampede, and leave a huge carcass', () => {
    const w = newWorld('human', 'canyon');
    const m = w.units.find((u) => u.kind === 'mammoth')!;
    const guard = w.units.find((u) => u.owner === 0 && u.kind === 'leader')!;
    guard.x = guard.ox = m.x - 2; guard.y = guard.oy = m.y; guard.order = { t: 'idle' };
    run(w, 10); expect(m.order.t).not.toBe('attack');         // ignores a passer-by
    const hp0 = guard.hp;
    cmdContext(w, [guard.id], m.x, m.y, { type: 'unit', unit: m });
    run(w, 6);
    expect(m.hp).toBeLessThan(m.maxHp);
    expect(guard.hp).toBeLessThan(hp0);                       // it hits back, hard
    m.hp = 0; run(w, 1);
    expect(w.nodes.some((n) => n.kind === 'carcass' && n.amount >= 250)).toBe(true);
  });

  it('every species has a rival', () => {
    for (const sp of ['human', 'neanderthal', 'denisovan'] as const) expect(newWorld(sp).rivalSpecies).not.toBe(sp);
  });
});
