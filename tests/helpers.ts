import { createWorld } from '../src/sim/world';
import { step, TICKS_PER_SEC } from '../src/sim/step';
import { updateFog } from '../src/sim/fog';
import type { World } from '../src/sim/types';

export function newWorld(species: 'human' | 'neanderthal' = 'human'): World {
  const w = createWorld(species);
  updateFog(w);
  return w;
}
export function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * TICKS_PER_SEC; i++) step(w);
}
export const mine = (w: World, kind: string) => w.units.filter((u) => u.owner === 0 && u.kind === kind);
