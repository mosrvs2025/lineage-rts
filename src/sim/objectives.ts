import { DISC_ORDER } from '../data/discoveries';
import { hasDisc } from './rules';
import type { World } from './types';
import { compass, fmtTime } from './util';
import { OUTPOST_REQUIRE, meadowOf } from './world';

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
  if (w.gen === 2 && !w.endless) {
    return [
      { id: 'prov', gen: 2, text: `Stock ${OUTPOST_REQUIRE} provisions for an expedition`, done: d.prov },
      { id: 'era2', gen: 2, text: 'Investigate a Generation II discovery (Pottery, Farming, Boats or Controlled heat)', done: d.era2 },
      { id: 'outpost', gen: 2, text: `Raise an outpost at the Far Meadow (${compass(w, meadowOf(w))})`, done: !!d.outpost },
    ];
  }
  return [
    { id: 'era2p', gen: w.gen, text: 'Preserve a Generation II discovery at a Teaching circle', done: d.era2p },
    { id: 'era3', gen: w.gen, text: 'Master a Generation III discovery (High-heat kilns or Seasonal irrigation)', done: d.era3 },
    { id: 'rival', gen: w.gen, text: 'Defeat the rival clan\'s hearth to claim the entire valley', done: false },
  ];
}

export function updateObjectives(w: World) {
  const d = w.done;
  if (w.stats.food >= 150) d.food = true;
  if (has(w, 'stockpile') && has(w, 'toolshelter')) d.base = true;
  if (hasDisc(w, 'preservation')) d.smoke = true;
  if (has(w, 'rack')) d.rack = true;
  if (DISC_ORDER.some((id) => w.disc[id] === 'preserved')) d.teach = true;
  if (w.time >= w.winter.end && w.gen === 1) d.winter = true;
  if (w.gen >= 2 && w.res.provisions >= OUTPOST_REQUIRE) d.prov = true;
  if (['heat', 'pottery', 'farming', 'boats'].some((id) => hasDisc(w, id as never))) d.era2 = true;
  if (['heat', 'pottery', 'farming', 'boats'].some((id) => w.disc[id as never] === 'preserved')) d.era2p = true;
  if (hasDisc(w, 'kiln') || hasDisc(w, 'irrigation')) d.era3 = true;
  if (w.buildings.some((b) => b.owner === 0 && b.outpost && b.done)) d.outpost = true;
}

/** Victory/defeat check. */
export function checkEnd(w: World) {
  if (w.status !== 'playing') return;
  if (!w.endless && w.gen >= 2 && w.buildings.some((b) => b.owner === 0 && b.outpost && b.done)) {
    w.status = 'won';
    w.endMsg = 'Your descendants stand at the Far Meadow, fed by food their ancestors learned to smoke. The lineage reaches beyond the valley.';
    return;
  }
  if (w.endless && !w.buildings.some((b) => b.owner === 1 && b.kind === 'hearth')) {
    w.status = 'won';
    w.endMsg = 'Across generations of inherited knowledge, your civilization has united the entire land and outlasted every rival.';
    return;
  }
  const hearth = w.buildings.some((b) => b.owner === 0 && b.kind === 'hearth');
  const people = w.units.some((u) => u.owner === 0);
  if (!hearth) { w.status = 'lost'; w.endMsg = 'The clan hearth has been destroyed. The fire is out and the lineage scatters.'; }
  else if (!people) { w.status = 'lost'; w.endMsg = 'No one is left to carry the fire. The lineage ends here.'; }
}
