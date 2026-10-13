import { rebuildBlocked } from './grid';
import { ensureFog, packExplored, updateFog } from './fog';
import { SAVE_VERSION } from './world';
import type { World } from './types';
import { reindex } from './util';

export const SAVE_FORMAT = 'lineage-rts-save';

export function serialize(w: World): string {
  packExplored(w);
  return JSON.stringify({ format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: Date.now(), world: w },
    (k, v) => (k.startsWith('_') ? undefined : v));
}

export type LoadResult = { ok: true; world: World } | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isArr = Array.isArray;

export function deserialize(text: string): LoadResult {
  let raw: any;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'Save file is not valid JSON.' }; }
  if (!raw || typeof raw !== 'object' || raw.format !== SAVE_FORMAT) return { ok: false, error: 'This is not a Lineage save file.' };
  if (!isNum(raw.version)) return { ok: false, error: 'Save has no version.' };
  if (raw.version > SAVE_VERSION) return { ok: false, error: `Save is from a newer game version (v${raw.version}).` };
  const w = raw.world;
  if (!w || typeof w !== 'object') return { ok: false, error: 'Save has no world data.' };
  for (const k of ['W', 'H', 'tick', 'time', 'gen', 'nextId', 'rng', 'seed']) if (!isNum(w[k])) return { ok: false, error: `Save is missing "${k}".` };
  if (!isArr(w.terrain) || w.terrain.length !== w.H || w.terrain.some((r: unknown) => typeof r !== 'string' || (r as string).length !== w.W)) {
    return { ok: false, error: 'Save terrain is corrupt.' };
  }
  for (const k of ['units', 'buildings', 'nodes', 'activities', 'landmarks', 'log', 'lineage']) if (!isArr(w[k])) return { ok: false, error: `Save is missing "${k}".` };
  if (!w.res || ['food', 'wood', 'stone', 'knowledge', 'provisions'].some((k) => !isNum(w.res[k]))) return { ok: false, error: 'Save resources are corrupt.' };
  if (!w.disc || !w.ai || !w.stats || !w.winter || !w.done) return { ok: false, error: 'Save is incomplete.' };
  if (w.species !== 'human' && w.species !== 'neanderthal') return { ok: false, error: 'Save species is invalid.' };
  const ids = new Set<number>();
  for (const e of [...w.units, ...w.buildings, ...w.nodes]) {
    if (!e || !isNum(e.id) || ids.has(e.id)) return { ok: false, error: 'Save contains invalid or duplicate entities.' };
    ids.add(e.id);
  }
  for (const u of w.units) if (!isNum(u.x) || !isNum(u.y) || !isNum(u.hp) || !u.order || typeof u.kind !== 'string') return { ok: false, error: 'Save contains a corrupt unit.' };
  for (const b of w.buildings) if (!isNum(b.x) || !isNum(b.y) || !isNum(b.hp) || typeof b.kind !== 'string') return { ok: false, error: 'Save contains a corrupt building.' };
  const world = w as World;
  world.v = SAVE_VERSION;
  for (const u of world.units) { u.path = null; u.ox = u.x; u.oy = u.y; u.tgt = -1; if (typeof u.buff !== 'number') u.buff = 0; if (typeof u.ability !== 'number') u.ability = 0; }
  reindex(world); rebuildBlocked(world); ensureFog(world); updateFog(world);
  world._fx = [];
  return { ok: true, world };
}
