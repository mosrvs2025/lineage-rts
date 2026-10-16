import type { BuildingKind, CostMap, DiscoveryId } from '../sim/types';

export interface UpgradeDef {
  name: string; desc: string; cost: CostMap; time: number; requires?: DiscoveryId;
  pop?: number; warmth?: number; hpMult?: number; knowledge?: number; vision?: number;
}

export interface BuildingDef {
  name: string; glyph: string; desc: string;
  w: number; h: number; hp: number;
  cost: CostMap; time: number;
  pop: number; warmth: number; dropoff: boolean; vision: number;
  trains: string[];
  buildable: boolean;
  requires?: string; // discovery id needed to place
  upgrades?: UpgradeDef[]; // sequential upgrade tiers
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hearth: { name: 'Clan hearth', glyph: 'H', desc: 'Settlement center. Warmth, drop-off, trains gatherers, slow knowledge from fireside stories.',
    w: 3, h: 3, hp: 500, cost: {}, time: 0, pop: 8, warmth: 9, dropoff: true, vision: 10, trains: ['gatherer'], upgrades: [
      { name: 'Great hearth', desc: 'A ringed fire pit with a carved totem. +4 housing, warmer, +0.25 knowledge/s.', cost: { wood: 70, stone: 30, knowledge: 25 }, time: 40, requires: 'cooking', pop: 4, warmth: 4, hpMult: 1.4, knowledge: 0.25 },
      { name: 'Clan hall', desc: 'The heart of a settlement. +6 housing, wide warmth, +0.5 knowledge/s.', cost: { wood: 120, stone: 60, knowledge: 60 }, time: 55, requires: 'preservation', pop: 6, warmth: 4, hpMult: 1.4, knowledge: 0.5 },
    ], buildable: false },
  shelter: { name: 'Shelter', glyph: 'S', desc: '+4 population. Small warm area.',
    w: 2, h: 2, hp: 160, cost: { wood: 25 }, time: 10, pop: 4, warmth: 4.5, dropoff: false, vision: 5, trains: [], upgrades: [{ name: 'Longhouse', desc: 'Sturdier hide-and-timber hut. +4 housing, warmer.', cost: { wood: 40, stone: 10 }, time: 20, pop: 4, warmth: 1.5, hpMult: 1.5 }], buildable: true },
  stockpile: { name: 'Stockpile', glyph: 'P', desc: 'Resource drop-off. Place near forests and hunting routes.',
    w: 2, h: 2, hp: 160, cost: { wood: 20 }, time: 8, pop: 0, warmth: 0, dropoff: true, vision: 5, trains: [], upgrades: [{ name: 'Storehouse', desc: 'Roofed storage. Loose food spoils 45% slower in winter.', cost: { wood: 45, stone: 10 }, time: 20, hpMult: 1.5 }], buildable: true },
  toolshelter: { name: 'Toolmaking shelter', glyph: 'T', desc: 'Tools: +15% wood & stone gathering. Unlocks guards and raiders. Facility for tool-based discoveries.',
    w: 2, h: 2, hp: 200, cost: { wood: 30, stone: 10 }, time: 14, pop: 0, warmth: 0, dropoff: false, vision: 5, trains: [], upgrades: [
      { name: 'Flint workshop', desc: 'Dedicated benches. Wood and stone gathering +15% more.', cost: { wood: 50, stone: 30 }, time: 28, hpMult: 1.3 },
      { name: 'Hafting bench', desc: 'Better-bound weapons: all melee damage +10%.', cost: { stone: 60, knowledge: 40 }, time: 40, requires: 'portable', hpMult: 1.3 },
    ], buildable: true },
  lodge: { name: 'Hunting lodge', glyph: 'L', desc: 'Trains scouts, hunters, guards and raiders.',
    w: 3, h: 2, hp: 240, cost: { wood: 40, stone: 10 }, time: 16, pop: 0, warmth: 3.5, dropoff: false, vision: 6, trains: ['scout', 'hunter', 'guard', 'raider', 'slinger', 'brute', 'stalker', 'champion'], upgrades: [{ name: 'War lodge', desc: 'Unlocks Champions, the clan\'s elite spear-warriors.', cost: { wood: 70, stone: 40 }, time: 35, hpMult: 1.4 }], buildable: true },
  circle: { name: 'Teaching circle', glyph: 'C', desc: 'Apprenticeships: preserve discoveries for future generations. Knowledge +0.5/s.',
    w: 3, h: 3, hp: 200, cost: { wood: 35 }, time: 16, pop: 0, warmth: 4, dropoff: false, vision: 5, trains: ['elder'], upgrades: [{ name: 'Elders\' circle', desc: 'Research 50% faster and +0.5 knowledge/s.', cost: { wood: 60, stone: 20, knowledge: 30 }, time: 30, knowledge: 0.5, hpMult: 1.3 }], buildable: true },
  rack: { name: 'Smoking rack', glyph: 'R', desc: 'Smokes 6 food into 6 provisions every 6s. Provisions never spoil and feed expeditions.',
    w: 2, h: 2, hp: 120, cost: { wood: 25, stone: 5 }, time: 10, pop: 0, warmth: 0, dropoff: false, vision: 4, trains: [], upgrades: [{ name: 'Smokehouse', desc: 'Roofed smoke chamber: 6 food → 9 provisions.', cost: { wood: 40, stone: 20 }, time: 24, requires: 'preservation', hpMult: 1.4 }], buildable: true, requires: 'preservation' },
  field: { name: 'Crop field', glyph: 'F', desc: 'Cultivated plot of hardy grain and roots. Harvests 4 food every 5s and acts as a food drop-off.',
    w: 2, h: 2, hp: 140, cost: { wood: 20, food: 15 }, time: 12, pop: 0, warmth: 0, dropoff: true, vision: 5, trains: [], upgrades: [{ name: 'Irrigated terrace', desc: 'Stone-lined channels and rich soil: harvests 6 food every 5s and +2 housing.', cost: { wood: 35, stone: 20 }, time: 22, requires: 'farming', pop: 2, hpMult: 1.4 }], buildable: true, requires: 'farming' },
  watch: { name: 'Watch post', glyph: 'W', desc: 'Reveals territory and warns of threats. Extends your supply range as an outpost.',
    w: 2, h: 2, hp: 160, cost: { wood: 25, stone: 10 }, time: 12, pop: 0, warmth: 0, dropoff: false, vision: 13, trains: [], upgrades: [
      { name: 'Archer post', desc: 'Shielded platform: shoots enemies within 9 tiles.', cost: { wood: 40, stone: 30 }, time: 25, hpMult: 1.4, vision: 2 },
      { name: 'Great tower', desc: 'Taller, torch-lit tower: longer, harder-hitting volleys.', cost: { wood: 40, stone: 60 }, time: 35, requires: 'portable', hpMult: 1.5, vision: 3 },
    ], buildable: true },
  palisade: { name: 'Palisade', glyph: '#', desc: 'Blocks movement. Build lines across chokepoints. Raiders hack through.',
    w: 1, h: 1, hp: 130, cost: { wood: 4 }, time: 3, pop: 0, warmth: 0, dropoff: false, vision: 2, trains: [], upgrades: [{ name: 'Reinforced palisade', desc: 'Doubles the wall\'s health.', cost: { wood: 6 }, time: 8, hpMult: 2 }], buildable: true },
};

export const BUILD_ORDER: BuildingKind[] = ['shelter', 'stockpile', 'toolshelter', 'lodge', 'circle', 'rack', 'field', 'watch', 'palisade'];
