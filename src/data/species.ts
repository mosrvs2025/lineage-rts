import type { Res, Species, UnitKind } from '../sim/types';

export interface SpeciesDef {
  id: Species; name: string; plural: string; tag: string; perks: string[];
  gather: Partial<Record<Exclude<Res, 'knowledge' | 'provisions'>, number>>;  // gather-rate multipliers
  cold: number;                                   // cold damage taken (1 = normal)
  hp?: { kinds: UnitKind[]; mult: number };      // sturdier unit types
  vision?: number;                                // extra sight for every unit
  unique: UnitKind;                               // species-exclusive unit
  rival: Species;                                 // who they face by default
  scale: number; skin: string[]; hair: string[]; heavyBrow: boolean; voicePitch: number;
  leader: string; band: string;                   // portrait backdrop colour
}

/** The three peoples. Differences are modest and each has a clear identity. */
export const SPECIES: Record<Species, SpeciesDef> = {
  human: {
    id: 'human', name: 'Human', plural: 'Humans', tag: 'Wide-ranging foragers',
    perks: ['Gatherers work 10% faster', 'Unique: Slingers, cheap ranged skirmishers'],
    gather: { food: 1.1, wood: 1.1, stone: 1.1 }, cold: 1, unique: 'slinger', rival: 'neanderthal',
    scale: 1.35, skin: ['#e6bd94', '#d9a57e', '#b9805a'], hair: ['#46301e', '#2a1c14', '#8a5a2a', '#1d1713'], heavyBrow: false, voicePitch: 1,
    leader: 'Ysa', band: '#4a6a8a',
  },
  neanderthal: {
    id: 'neanderthal', name: 'Neanderthal', plural: 'Neanderthals', tag: 'Hardy cold-weather hunters',
    perks: ['Leaders, guards and raiders +15% health', 'Take 35% less cold damage', 'Unique: Brutes that crush buildings'],
    gather: {}, cold: 0.65, hp: { kinds: ['guard', 'raider', 'leader', 'brute'], mult: 1.15 }, unique: 'brute', rival: 'human',
    scale: 1.42, skin: ['#d9a888', '#cc9878', '#b58562'], hair: ['#2a1c14', '#3a2616', '#5a3a1e', '#171210'], heavyBrow: true, voicePitch: 0.55,
    leader: 'Brok', band: '#6a5a44',
  },
  denisovan: {
    id: 'denisovan', name: 'Denisovan', plural: 'Denisovans', tag: 'Mountain stoneworkers',
    perks: ['Stone and wood gathering +20%', 'Take 20% less cold damage, +1 sight', 'Unique: Stalkers, fast javelin hunters'],
    gather: { stone: 1.2, wood: 1.2 }, cold: 0.8, vision: 1, unique: 'stalker', rival: 'neanderthal',
    scale: 1.38, skin: ['#b98a64', '#a87a56', '#8e6446'], hair: ['#141010', '#241a14', '#3a2a1e', '#0e0c0a'], heavyBrow: true, voicePitch: 0.8,
    leader: 'Tala', band: '#5a4a6a',
  },
};
export const SPECIES_ORDER: Species[] = ['human', 'neanderthal', 'denisovan'];
