import type { BuildingKind, Res } from '../sim/types';

export interface BuildingDef {
  name: string; glyph: string; desc: string;
  w: number; h: number; hp: number;
  cost: Partial<Record<Res, number>>; time: number;
  pop: number; warmth: number; dropoff: boolean; vision: number;
  trains: string[];
  buildable: boolean;
  requires?: string; // discovery id needed to place
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  hearth: { name: 'Clan hearth', glyph: 'H', desc: 'Settlement center. Warmth, drop-off, trains gatherers, slow knowledge from fireside stories.',
    w: 3, h: 3, hp: 500, cost: {}, time: 0, pop: 8, warmth: 9, dropoff: true, vision: 10, trains: ['gatherer'], buildable: false },
  shelter: { name: 'Shelter', glyph: 'S', desc: '+4 population. Small warm area.',
    w: 2, h: 2, hp: 160, cost: { wood: 25 }, time: 10, pop: 4, warmth: 4.5, dropoff: false, vision: 5, trains: [], buildable: true },
  stockpile: { name: 'Stockpile', glyph: 'P', desc: 'Resource drop-off. Place near forests and hunting routes.',
    w: 2, h: 2, hp: 160, cost: { wood: 20 }, time: 8, pop: 0, warmth: 0, dropoff: true, vision: 5, trains: [], buildable: true },
  toolshelter: { name: 'Toolmaking shelter', glyph: 'T', desc: 'Tools: +15% wood & stone gathering. Unlocks guards and raiders. Facility for tool-based discoveries.',
    w: 2, h: 2, hp: 200, cost: { wood: 30, stone: 10 }, time: 14, pop: 0, warmth: 0, dropoff: false, vision: 5, trains: [], buildable: true },
  lodge: { name: 'Hunting lodge', glyph: 'L', desc: 'Trains scouts, hunters, guards and raiders.',
    w: 3, h: 2, hp: 240, cost: { wood: 40, stone: 10 }, time: 16, pop: 0, warmth: 3.5, dropoff: false, vision: 6, trains: ['scout', 'hunter', 'guard', 'raider'], buildable: true },
  circle: { name: 'Teaching circle', glyph: 'C', desc: 'Apprenticeships: preserve discoveries for future generations. Knowledge +0.5/s.',
    w: 3, h: 3, hp: 200, cost: { wood: 35 }, time: 16, pop: 0, warmth: 4, dropoff: false, vision: 5, trains: [], buildable: true },
  rack: { name: 'Smoking rack', glyph: 'R', desc: 'Smokes 6 food into 6 provisions every 6s. Provisions never spoil and feed expeditions.',
    w: 2, h: 2, hp: 120, cost: { wood: 25, stone: 5 }, time: 10, pop: 0, warmth: 0, dropoff: false, vision: 4, trains: [], buildable: true, requires: 'preservation' },
  watch: { name: 'Watch post', glyph: 'W', desc: 'Reveals territory and warns of threats. Extends your supply range as an outpost.',
    w: 2, h: 2, hp: 160, cost: { wood: 25, stone: 10 }, time: 12, pop: 0, warmth: 0, dropoff: false, vision: 13, trains: [], buildable: true },
  palisade: { name: 'Palisade', glyph: '#', desc: 'Blocks movement. Build lines across chokepoints. Raiders hack through.',
    w: 1, h: 1, hp: 130, cost: { wood: 4 }, time: 3, pop: 0, warmth: 0, dropoff: false, vision: 2, trains: [], buildable: true },
};

export const BUILD_ORDER: BuildingKind[] = ['shelter', 'stockpile', 'toolshelter', 'lodge', 'circle', 'rack', 'watch', 'palisade'];
