export type Species = 'human' | 'neanderthal';
export type Res = 'food' | 'wood' | 'stone';
export type UnitKind =
  | 'gatherer' | 'scout' | 'hunter' | 'guard' | 'raider' | 'leader'
  | 'deer' | 'wolf';
export type BuildingKind =
  | 'hearth' | 'shelter' | 'stockpile' | 'toolshelter' | 'lodge'
  | 'circle' | 'rack' | 'watch' | 'palisade';
export type Owner = 0 | 1 | 2; // 0 player clan, 1 rival clan, 2 wildlife
export type DiscoveryId = 'cooking' | 'preservation' | 'portable' | 'heat';
export type DiscState = 'hidden' | 'clue' | 'known' | 'preserved' | 'faded';

export interface Pt { x: number; y: number }

export type Order =
  | { t: 'idle' }
  | { t: 'move'; x: number; y: number }
  | { t: 'amove'; x: number; y: number }
  | { t: 'attack'; target: number }
  | { t: 'gather'; node: number }
  | { t: 'build'; b: number }
  | { t: 'hold' }
  | { t: 'research' }
  | { t: 'flee'; x: number; y: number };

export interface Unit {
  id: number;
  kind: UnitKind;
  owner: Owner;
  name: string;
  x: number; y: number;
  ox: number; oy: number; // previous position, for render interpolation
  hp: number; maxHp: number;
  order: Order;
  path: Pt[] | null;
  pcd: number;        // repath cooldown
  raw?: boolean;      // use an unsmoothed path (set after clipping an obstacle)
  ptx: number; pty: number; // target the current path was computed for
  cd: number;         // attack cooldown
  carry: { res: Res | null; n: number; meat?: boolean };
  work: number;       // gather progress accumulator
  tgt: number;        // current auto-acquired target (amove / idle aggro)
  home: Pt;           // wildlife den / garrison post
  role: 'none' | 'garrison' | 'raid';
  gen: number;        // generation born
  born: number;
  ability: number;    // leader rally cooldown
  buff: number;       // seconds of rally buff left
}

export interface Building {
  id: number;
  kind: BuildingKind;
  owner: Owner;
  x: number; y: number; // top-left tile
  w: number; h: number;
  hp: number; maxHp: number;
  progress: number;     // build progress 0..1
  done: boolean;
  queue: { kind: UnitKind; t: number }[];
  tick: number;         // misc timer (rack conversion)
  outpost?: boolean;
}

export interface ResNode {
  id: number;
  kind: 'tree' | 'bush' | 'rock' | 'carcass';
  res: Res;
  x: number; y: number; // tile
  amount: number;
  max: number;
  regen: number;
}

export interface Activity {
  id: number;
  kind: 'investigate' | 'teach';
  disc: DiscoveryId;
  progress: number;
  total: number;
  worker: number;
}

export interface Landmark { id: string; name: string; x: number; y: number; visited: boolean }

export interface AIState {
  supply: number;
  nextSpawn: number;
  nextRaid: number;
  raids: number;
  lastRaidMsg: number;
}

export interface Successor { name: string; trait: 'logistics' | 'recon' | 'teaching'; note: string }
export interface LineageEntry { name: string; gen: number; trait: string }

export interface World {
  v: number;
  seed: number;
  rng: number;
  tick: number;
  time: number;
  gen: number;
  species: Species;
  rivalSpecies: Species;
  W: number; H: number;
  terrain: string[];
  nextId: number;
  units: Unit[];
  buildings: Building[];
  nodes: ResNode[];
  res: { food: number; wood: number; stone: number; knowledge: number; provisions: number };
  stats: { food: number; meat: number; kills: number; lost: number; spoiled: number };
  disc: Record<DiscoveryId, DiscState>;
  activities: Activity[];
  explored: string;
  landmarks: Landmark[];
  ai: AIState;
  winter: { start: number; end: number };
  trait: Successor['trait'] | 'founder';
  lineage: LineageEntry[];
  done: Record<string, boolean>;
  status: 'playing' | 'won' | 'lost';
  endMsg: string;
  truceUntil: number;
  hungerT: number;
  log: { t: number; text: string; kind: 'info' | 'good' | 'bad' }[];
  // runtime caches (never serialized)
  _blocked?: Uint8Array;
  _vis?: Uint8Array;
  _u?: Map<number, Unit>;
  _b?: Map<number, Building>;
  _n?: Map<number, ResNode>;
  _exp?: Uint8Array;
  _carc?: Map<number, number>;
  _starving?: boolean;
  _fx?: { x1: number; y1: number; x2: number; y2: number; t: number; c: string }[];
}
