import { DISC_ORDER } from '../data/discoveries';
import type { DiscoveryId, LineageEntry, Successor, World } from './types';
import { autoWork, setOrder } from './units';
import { fmtTime, log } from './util';
import { makeUnit, spawnSpot } from './world';

export function canSucceed(w: World) {
  return w.status === 'playing' && w.gen === 1 && w.time >= w.winter.end;
}

const NAMES = ['Tala', 'Orrin', 'Mika', 'Dag', 'Selu', 'Rhan', 'Ila', 'Koro', 'Bel', 'Nuru', 'Vaya', 'Hodo'];

export function successorCandidates(w: World): Successor[] {
  const base = (w.seed ^ (w.gen * 2654435761)) >>> 0;
  const n = (i: number) => NAMES[(base + i * 5) % NAMES.length];
  return [
    { name: n(0), trait: 'logistics', note: 'Organizer — gathering 15% faster, expeditions use 30% fewer provisions.' },
    { name: n(1), trait: 'recon', note: 'Pathfinder — everyone sees 2 tiles farther and scouts move 20% faster.' },
    { name: n(2), trait: 'teaching', note: 'Teacher — investigations and teaching 20% faster, +30 knowledge now.' },
  ];
}

export interface InheritRow { id: DiscoveryId; from: string; to: string }
export function inheritancePreview(w: World): InheritRow[] {
  return DISC_ORDER.map((id) => {
    const s = w.disc[id];
    const to = s === 'preserved' ? 'preserved' : s === 'known' ? 'faded' : s;
    return { id, from: s, to };
  });
}

export function advanceGeneration(w: World, pick: number): boolean {
  if (!canSucceed(w)) return false;
  const cand = successorCandidates(w)[pick];
  if (!cand) return false;
  w.gen = 2;
  w.trait = cand.trait;
  // discoveries: preserved ones are kept; unpreserved ones fade and must be relearned from remembered clues
  for (const id of DISC_ORDER) {
    if (w.disc[id] === 'known') w.disc[id] = 'faded';
  }
  w.activities = [];
  // the old leader steps aside, elders retire, children grow up
  const old = w.units.find((u) => u.owner === 0 && u.kind === 'leader');
  const oldName = old?.name ?? 'The founder';
  if (old) w.units.splice(w.units.indexOf(old), 1);
  const elders = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer').sort((a, b) => a.born - b.born).slice(0, 1);
  for (const e of elders) w.units.splice(w.units.indexOf(e), 1);
  const hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth');
  if (hearth) {
    const p = spawnSpot(w, hearth);
    const l = makeUnit(w, 'leader', 0, p.x, p.y);
    l.name = cand.name; l.gen = 2;
    for (let i = 0; i < 3; i++) {
      const g = makeUnit(w, 'gatherer', 0, p.x - 1 + i, p.y + 1);
      g.gen = 2; autoWork(w, g);
    }
  }
  for (const u of w.units) if (u.owner === 0) { u.hp = u.maxHp; if (u.order.t === 'research') setOrder(u, { t: 'idle' }); }
  if (cand.trait === 'teaching') w.res.knowledge += 30;
  const entry: LineageEntry = { name: cand.name, gen: 2, trait: cand.trait };
  w.lineage.push(entry);
  // a second winter looms; the rival has grown while we waited
  w.winter = { start: w.time + 420, end: w.time + 600 };
  w.ai.supply += 60; w.ai.nextRaid = Math.min(w.ai.nextRaid, w.time + 80);
  log(w, `${oldName} passes the fire to ${cand.name}. Generation 2 begins.`, 'good');
  const kept = DISC_ORDER.filter((id) => w.disc[id] === 'preserved').length;
  log(w, kept ? `${kept} preserved discoveries are inherited.` : 'No discoveries were taught — your clan must relearn from clues.', kept ? 'good' : 'bad');
  log(w, `Next winter begins at ${fmtTime(w.winter.start)}.`);
  return true;
}
