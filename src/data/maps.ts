/** Map definitions. Every map keeps the same strategic skeleton (your camp in the west, the rival clan in the east,
 *  a river with a defended pass, the Ember Cave and the Far Meadow) and varies terrain, resources, wildlife, winter and look. */
export type Biome = 'autumn' | 'tundra' | 'lush' | 'steppe';
type C = [number, number, number];  // x, y, radius (or count for animals)

export interface MapDef {
  id: string; name: string; desc: string; biome: Biome; difficulty: 'Standard' | 'Harsh' | 'Gentle' | 'Open';
  winter: { start: number; end: number };
  river: { amp: number; freq: number; phase: number; width: number };
  fords: [number, number][];          // y ranges where the river is shallow
  ridges: [number, number, number, number][];
  trees: C[]; treeP: number; rocks: C[]; bushes: [number, number][];
  deer: C[]; wolves: C[];
  start: { food: number; wood: number; stone: number };
}

const SKELETON_RIDGES: [number, number, number, number][] = [[38, 13, 42, 19], [38, 28, 42, 34]]; // flanks of the pass

export const MAPS: Record<string, MapDef> = {
  valley: {
    id: 'valley', name: 'Ember Valley', desc: 'Autumn woods along a winding river. The classic first winter.', biome: 'autumn', difficulty: 'Standard',
    winter: { start: 420, end: 720 }, river: { amp: 1.5, freq: 0.35, phase: 0, width: 1 }, fords: [[21, 25], [5, 6]],
    ridges: [...SKELETON_RIDGES, [46, 9, 49, 14], [50, 22, 53, 26], [60, 25, 64, 29], [22, 1, 28, 3], [30, 44, 34, 46]],
    trees: [[7, 8, 5], [14, 38, 5], [22, 31, 4], [26, 12, 5], [30, 40, 3], [20, 17, 3], [4, 40, 3], [46, 38, 4], [47, 19, 3], [60, 15, 5], [67, 22, 4], [52, 6, 4], [44, 44, 3], [28, 24, 2], [12, 13, 3]], treeP: 0.62,
    rocks: [[8, 36, 2], [27, 21, 2], [31, 8, 2], [16, 6, 1], [48, 30, 2], [58, 12, 2], [20, 42, 2]],
    bushes: [[15, 20], [16, 22], [15, 25], [17, 24], [14, 28], [13, 18], [24, 27], [25, 29], [10, 12], [29, 14], [47, 26], [55, 28]],
    deer: [[22, 14, 3], [18, 33, 3], [46, 29, 3], [60, 10, 3], [12, 5, 2]], wolves: [[24, 37, 2], [15, 4, 2], [48, 12, 2]],
    start: { food: 140, wood: 90, stone: 25 },
  },
  tundra: {
    id: 'tundra', name: 'Frostfang Tundra', desc: 'A frozen land of pines and stone. Winter comes early and stays long; wolves roam in packs.', biome: 'tundra', difficulty: 'Harsh',
    winter: { start: 330, end: 690 }, river: { amp: 2.5, freq: 0.22, phase: 1.2, width: 1 }, fords: [[21, 25], [4, 7], [40, 42]],
    ridges: [...SKELETON_RIDGES, [24, 6, 30, 9], [14, 42, 22, 45], [48, 4, 56, 7], [57, 18, 60, 22], [46, 40, 50, 44], [28, 30, 31, 34]],
    trees: [[7, 8, 4], [14, 38, 4], [24, 22, 3], [26, 13, 3], [47, 19, 3], [60, 15, 4], [66, 30, 3], [12, 13, 3], [6, 33, 3]], treeP: 0.55,
    rocks: [[8, 36, 3], [27, 18, 3], [31, 8, 2], [16, 6, 2], [48, 30, 2], [58, 12, 3], [20, 42, 2], [22, 28, 2]],
    bushes: [[15, 20], [16, 22], [15, 25], [14, 28], [13, 18], [25, 29], [29, 14]],
    deer: [[22, 14, 4], [18, 33, 3], [46, 29, 3], [60, 10, 4]], wolves: [[24, 37, 3], [15, 4, 3], [48, 12, 3], [28, 26, 2]],
    start: { food: 170, wood: 100, stone: 40 },
  },
  lush: {
    id: 'lush', name: 'Twin Fords', desc: 'A green, game-rich delta with three crossings. Plenty for everyone, which means the rival comes sooner.', biome: 'lush', difficulty: 'Gentle',
    winter: { start: 450, end: 690 }, river: { amp: 3, freq: 0.18, phase: 2.4, width: 1 }, fords: [[21, 25], [6, 8], [36, 38]],
    ridges: [...SKELETON_RIDGES, [50, 22, 53, 26], [22, 1, 28, 3], [62, 40, 66, 44]],
    trees: [[7, 8, 5], [14, 38, 5], [22, 31, 4], [26, 12, 5], [30, 40, 4], [20, 17, 3], [4, 40, 3], [46, 38, 5], [47, 19, 3], [60, 15, 5], [67, 22, 4], [52, 6, 4], [44, 44, 4], [12, 13, 3]], treeP: 0.7,
    rocks: [[8, 36, 2], [27, 21, 2], [31, 8, 2], [48, 30, 2], [58, 12, 2]],
    bushes: [[15, 20], [16, 22], [15, 25], [17, 24], [14, 28], [13, 18], [24, 27], [25, 29], [10, 12], [29, 14], [47, 26], [55, 28], [19, 27], [21, 36], [8, 31], [27, 9]],
    deer: [[22, 14, 4], [18, 33, 4], [46, 29, 3], [60, 10, 3], [12, 5, 3], [28, 36, 3]], wolves: [[24, 42, 2], [48, 12, 2]],
    start: { food: 140, wood: 90, stone: 25 },
  },
  steppe: {
    id: 'steppe', name: 'Highland Steppe', desc: 'Wind-swept grassland broken by rocky ridges. Little timber, much stone, and long sight-lines.', biome: 'steppe', difficulty: 'Open',
    winter: { start: 400, end: 700 }, river: { amp: 1, freq: 0.5, phase: 0.6, width: 1 }, fords: [[21, 25], [10, 12], [33, 34]],
    ridges: [...SKELETON_RIDGES, [22, 3, 24, 11], [24, 34, 27, 42], [46, 6, 52, 9], [56, 18, 59, 25], [62, 34, 66, 37], [10, 41, 15, 44]],
    trees: [[7, 8, 3], [14, 38, 3], [26, 12, 4], [20, 17, 2], [46, 38, 3], [60, 15, 3], [67, 22, 3], [12, 13, 3], [30, 24, 2]], treeP: 0.6,
    rocks: [[8, 36, 3], [27, 21, 3], [31, 8, 3], [16, 6, 2], [48, 30, 3], [58, 12, 3], [20, 42, 2], [23, 27, 2], [4, 14, 2]],
    bushes: [[15, 20], [16, 22], [15, 25], [17, 24], [14, 28], [13, 18], [24, 30], [10, 12], [29, 14], [47, 26], [18, 20], [19, 23], [12, 29], [18, 27], [20, 25]],
    deer: [[22, 14, 4], [18, 33, 4], [46, 29, 3], [60, 10, 3], [32, 38, 3], [26, 20, 3]], wolves: [[24, 37, 2], [15, 4, 2]],
    start: { food: 150, wood: 110, stone: 25 },
  },
};
export const MAP_ORDER = ['valley', 'tundra', 'lush', 'steppe'];
