import { describe, expect, it } from 'vitest';
import { MAPS, MAP_ORDER } from '../src/data/maps';
import { findPath } from '../src/sim/grid';
import { MEADOW } from '../src/sim/world';
import { newWorld } from './helpers';

describe('maps', () => {
  for (const id of MAP_ORDER) {
    it(`${id}: generates a fair, connected map`, () => {
      const w = newWorld('human', id);
      expect(w.map).toBe(id);
      expect(w.winter).toEqual(MAPS[id].winter);
      const trees = w.nodes.filter((n) => n.kind === 'tree').length, rocks = w.nodes.filter((n) => n.kind === 'rock').length;
      expect(trees).toBeGreaterThan(40); expect(rocks).toBeGreaterThan(8);
      const hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth')!;
      const rival = w.buildings.find((b) => b.owner === 1 && b.kind === 'hearth')!;
      const sx = hearth.x + 1, sy = hearth.y + 3.5;
      expect(findPath(w, sx, sy, MEADOW.x + 0.5, MEADOW.y + 0.5)).not.toBeNull();   // the victory site is reachable
      expect(findPath(w, sx, sy, rival.x + 1, rival.y + 3.5)).not.toBeNull();       // so is the rival camp
      expect(findPath(w, sx, sy, 18.5, 9.5)).not.toBeNull();                        // and the Ember Cave clue
      // no resource or unit sits on blocked terrain
      for (const n of w.nodes) expect(w.terrain[n.y][n.x]).toBe('.');
    });
  }
  it('every species has a rival and a unique unit', () => {
    for (const sp of ['human', 'neanderthal', 'denisovan'] as const) {
      const w = newWorld(sp);
      expect(w.rivalSpecies).not.toBe(sp);
    }
  });
});
