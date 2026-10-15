/** Map definitions. Each map has its own generator, start positions, landmarks and special mechanics. */
export type Biome = 'autumn' | 'tundra' | 'lush' | 'steppe' | 'badlands';
type C = [number, number, number];  // x, y, radius (or count for animals)
export interface Pt { x: number; y: number }

export interface AutoRes { trees: number; rocks: number; bushes: number; deer: number; wolves: number; mammoths?: number; fish?: number; homeBushes?: number; homeDeer?: number }

export interface MapDef {
  id: string; name: string; desc: string; biome: Biome; difficulty: 'Standard' | 'Harsh' | 'Gentle' | 'Open' | 'Deadly';
  features: string[];                       // shown on the map card
  gen: 'valley' | 'lake' | 'isles' | 'canyon';
  winter: { start: number; end: number };
  start: { food: number; wood: number; stone: number };
  player: Pt; rival: Pt; pass: Pt;          // hearth tiles, and the rival's forward post
  cave: Pt; meadow: Pt;                     // the Ember Cave clue and the Far Meadow victory site
  stage: Pt;                                // a safe staging point on the way to the meadow (used by bots and hints)
  permaFrost?: boolean;
  pace?: number;                            // rival tempo: <1 gentler (slower raids and growth), >1 fiercer
  valley?: { river: { amp: number; freq: number; phase: number }; fords: [number, number][]; ridges: [number, number, number, number][] };
  hand?: { trees: C[]; treeP: number; rocks: C[]; bushes: [number, number][]; deer: C[]; wolves: C[] };
  auto?: AutoRes;
}

export const MAPS: Record<string, MapDef> = {
  valley: {
    id: 'valley', name: 'Ember Valley', desc: 'A winding river, a defended pass and autumn woods. The classic first winter.', biome: 'autumn', difficulty: 'Standard',
    features: ['River with a fortified pass', 'Balanced resources'], gen: 'valley',
    winter: { start: 420, end: 720 }, start: { food: 140, wood: 90, stone: 25 },
    player: { x: 9, y: 22 }, rival: { x: 55, y: 35 }, pass: { x: 43, y: 22 }, cave: { x: 18, y: 8 }, meadow: { x: 66, y: 8 }, stage: { x: 36.5, y: 5.5 },
    valley: {
      river: { amp: 1.5, freq: 0.35, phase: 0 }, fords: [[21, 25], [5, 6]],
      ridges: [[38, 13, 42, 19], [38, 28, 42, 34], [46, 9, 49, 14], [50, 22, 53, 26], [60, 25, 64, 29], [22, 1, 28, 3], [30, 44, 34, 46]],
    },
    hand: {
      trees: [[7, 8, 5], [14, 38, 5], [22, 31, 4], [26, 12, 5], [30, 40, 3], [20, 17, 3], [4, 40, 3], [46, 38, 4], [47, 19, 3], [60, 15, 5], [67, 22, 4], [52, 6, 4], [44, 44, 3], [28, 24, 2], [12, 13, 3]], treeP: 0.62,
      rocks: [[8, 36, 2], [27, 21, 2], [31, 8, 2], [16, 6, 1], [48, 30, 2], [58, 12, 2], [20, 42, 2]],
      bushes: [[15, 20], [16, 22], [15, 25], [17, 24], [14, 28], [13, 18], [24, 27], [25, 29], [10, 12], [29, 14], [47, 26], [55, 28]],
      deer: [[22, 14, 3], [18, 33, 3], [46, 29, 3], [60, 10, 3], [12, 5, 2]], wolves: [[24, 37, 2], [15, 4, 2], [48, 12, 2]],
    },
  },

  glasswater: {
    id: 'glasswater', name: 'Glasswater', desc: 'A vast lake splits the land into two long shores. In winter it freezes solid: a shortcut for you, and for the rival.', biome: 'tundra', difficulty: 'Harsh',
    features: ['Lake freezes in winter: walk across the ice', 'Ice fishing on the shallows', 'Two shores, two narrow chokepoints'], gen: 'lake',
    winter: { start: 330, end: 690 }, start: { food: 160, wood: 100, stone: 35 },
    player: { x: 8, y: 9 }, rival: { x: 60, y: 38 }, pass: { x: 51, y: 36 }, cave: { x: 8, y: 41 }, meadow: { x: 65, y: 7 }, stage: { x: 37, y: 10.5 },
    auto: { trees: 13, rocks: 7, bushes: 22, deer: 7, wolves: 4, fish: 11, homeBushes: 14, homeDeer: 2 },
  },

  isles: {
    id: 'isles', name: 'The Isles', desc: 'A scatter of islands joined by shallow causeways. Fish the shallows, hold the crossings, and never leave a causeway undefended.', biome: 'lush', difficulty: 'Gentle',
    features: ['Island chain linked by causeways', 'Fishing spots: food that never runs out', 'No walking around: every route is a chokepoint'], gen: 'isles', pace: 0.7,
    winter: { start: 460, end: 680 }, start: { food: 130, wood: 100, stone: 25 },
    player: { x: 9, y: 24 }, rival: { x: 61, y: 25 }, pass: { x: 36, y: 24 }, cave: { x: 36, y: 41 }, meadow: { x: 64, y: 7 }, stage: { x: 36, y: 8.5 },
    auto: { trees: 12, rocks: 8, bushes: 12, deer: 3, wolves: 1, fish: 18 },
  },

  canyon: {
    id: 'canyon', name: 'Mammoth Canyon', desc: 'Red-rock canyons wind around a central basin where mammoth herds graze. One mammoth feeds the clan for a season. If you can bring it down.', biome: 'badlands', difficulty: 'Deadly',
    features: ['Canyon maze with ambush chokepoints', 'Mammoths: huge food, deadly when angered', 'Fish and berries are scarce: meat matters'], gen: 'canyon',
    winter: { start: 400, end: 700 }, start: { food: 150, wood: 110, stone: 30 },
    player: { x: 9, y: 38 }, rival: { x: 62, y: 11 }, pass: { x: 47, y: 18 }, cave: { x: 8, y: 8 }, meadow: { x: 66, y: 40 }, stage: { x: 46, y: 41.5 },
    auto: { trees: 9, rocks: 12, bushes: 12, deer: 4, wolves: 3, mammoths: 5 },
  },
};
export const MAP_ORDER = ['valley', 'glasswater', 'isles', 'canyon'];
