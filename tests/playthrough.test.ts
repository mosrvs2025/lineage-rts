import { describe, expect, it } from 'vitest';
import { step, TICKS_PER_SEC } from '../src/sim/step';
import { newWorld } from './helpers';
import { Bot } from './bot';

describe('full scenario (scripted bot)', () => {
  const cases = [['human', 'valley'], ['neanderthal', 'valley'], ['denisovan', 'valley'], ['neanderthal', 'tundra'], ['human', 'lush'], ['denisovan', 'steppe']] as const;
  for (const [species, map] of cases) {
    it(`a competent player can win as ${species} on ${map}`, () => {
      const w = newWorld(species, map);
      const bot = new Bot(w);
      const log: string[] = [];
      for (let s = 0; s < 40 * 60 && w.status === 'playing'; s++) {
        for (let t = 0; t < TICKS_PER_SEC; t++) step(w);
        bot.everySecond();
        if (s % 120 === 0) log.push(`${s}s gen${w.gen} pop ${w.units.filter((u) => u.owner === 0).length} food ${Math.floor(w.res.food)} wood ${Math.floor(w.res.wood)} prov ${Math.floor(w.res.provisions)} disc ${Object.values(w.disc).join(',')} rival ${w.units.filter((u) => u.owner === 1).length} raids ${w.ai.raids} guards ${w.units.filter((u) => u.owner === 0 && u.kind === 'guard').length} lost ${w.stats.lost} kills ${w.stats.kills}`);
      }
      console.log(species, map, w.status, Math.floor(w.time), w.endMsg, '\n' + log.join('\n'), '\n' + bot.trace.join('\n'));
      expect(w.status).toBe('won');
    }, 120000);
  }
});
