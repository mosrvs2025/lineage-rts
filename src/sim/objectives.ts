import { hasDisc } from './rules';
import type { World } from './types';
import { fmtTime } from './util';
import { OUTPOST_REQUIRE } from './world';

export interface Objective { id: string; text: string; done: boolean; gen: number }

const has = (w: World, kind: string) => w.buildings.some((b) => b.owner === 0 && b.kind === kind && b.done);

export function objectiveList(w: World): Objective[] {
  const d = w.done;
  if (w.gen === 1) {
    return [
      { id: 'food', gen: 1, text: 'Gather 150 food', done: d.food },
      { id: 'base', gen: 1, text: 'Build a stockpile and a toolmaking shelter', done: d.base },
      { id: 'smoke', gen: 1, text: 'Discover smoke preservation', done: d.smoke },
      { id: 'rack', gen: 1, text: 'Build a smoking rack', done: d.rack },
      { id: 'teach', gen: 1, text: 'Build a teaching circle and preserve a discovery', done: d.teach },
      { id: 'winter', gen: 1, text: `Survive the winter (spring at ${fmtTime(w.winter.end)})`, done: d.winter },
      { id: 'succeed', gen: 1, text: 'Advance to the next generation', done: false },
    ];
  }
  return [
    { id: 'prov', gen: 2, text: `Stock ${OUTPOST_REQUIRE} provisions for an expedition`, done: d.prov },
    { id: 'outpost', gen: 2, text: 'Raise an outpost at the Far Meadow (north-east)', done: false },
  ];
}

export function updateObjectives(w: World) {
  const d = w.done;
  if (w.stats.food >= 150) d.food = true;
  if (has(w, 'stockpile') && has(w, 'toolshelter')) d.base = true;
  if (hasDisc(w, 'preservation')) d.smoke = true;
  if (has(w, 'rack')) d.rack = true;
  if (w.disc.cooking === 'preserved' || w.disc.preservation === 'preserved' || w.disc.portable === 'preserved' || w.disc.heat === 'preserved') d.teach = true;
  if (w.time >= w.winter.end && w.gen === 1) d.winter = true;
  if (w.gen >= 2 && w.res.provisions >= OUTPOST_REQUIRE) d.prov = true;
}

/** Victory/defeat check. */
export function checkEnd(w: World) {
  if (w.status !== 'playing') return;
  if (w.gen >= 2 && w.buildings.some((b) => b.owner === 0 && b.outpost && b.done)) {
    w.status = 'won';
    w.endMsg = 'Your descendants stand at the Far Meadow, fed by food their ancestors learned to smoke. The lineage reaches beyond the valley.';
    return;
  }
  const hearth = w.buildings.some((b) => b.owner === 0 && b.kind === 'hearth');
  const people = w.units.some((u) => u.owner === 0);
  if (!hearth) { w.status = 'lost'; w.endMsg = 'The clan hearth has been destroyed. The fire is out and the lineage scatters.'; }
  else if (!people) { w.status = 'lost'; w.endMsg = 'No one is left to carry the fire. The lineage ends here.'; }
}
