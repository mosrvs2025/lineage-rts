import { UNITS } from './units';
import type { Res, Species, UnitKind } from '../sim/types';

export interface SpeciesDef {
  id: Species; name: string; plural: string; tag: string; perks: string[];
  archetype: string;
  gather: Partial<Record<Exclude<Res, 'knowledge' | 'provisions'>, number>>;  // gather-rate multipliers
  cold: number;                                   // cold damage taken (1 = normal)
  hp?: { kinds: UnitKind[]; mult: number };       // sturdier unit types
  hpAll?: number;                                 // baseline HP multiplier across all units
  dmg?: { kinds: UnitKind[]; mult: number };      // specialized unit damage bonus
  dmgAll?: number;                                // baseline damage multiplier across all units
  speedMult: number;                              // racial movement speed multiplier
  rangeMult?: number;                             // racial ranged/spear reach multiplier
  vision?: number;                                // extra sight for every unit
  unique: UnitKind;                               // species-exclusive unit
  rival: Species;                                 // who they face by default
  scale: number; skin: string[]; hair: string[]; heavyBrow: boolean; voicePitch: number;
  leader: string; band: string;                   // portrait backdrop colour
}

/** The three peoples: each has a distinct Warcraft-style silhouette, stat profile, and battlefield role. */
export const SPECIES: Record<Species, SpeciesDef> = {
  human: {
    id: 'human', name: 'Human', plural: 'Humans', tag: 'Sun-Strider Skirmishers & Foragers',
    archetype: 'Swift & Versatile · +10% Move Speed · +15% Ranged/Command Attack · +10% All Gathering',
    perks: [
      '+10% Move Speed & +15% Ranged/Leader Damage',
      'Gatherers harvest Food, Wood & Stone 10% faster',
      'Unique: Slingers — fast long-range stone skirmishers',
    ],
    gather: { food: 1.1, wood: 1.1, stone: 1.1 }, cold: 1,
    hpAll: 1.0, hp: { kinds: ['scout', 'slinger'], mult: 1.08 },
    dmgAll: 1.05, dmg: { kinds: ['leader', 'hunter', 'slinger', 'scout', 'champion'], mult: 1.15 },
    speedMult: 1.10,
    unique: 'slinger', rival: 'neanderthal',
    scale: 1.35, skin: ['#e6bd94', '#d9a57e', '#b9805a'], hair: ['#46301e', '#2a1c14', '#8a5a2a', '#1d1713'], heavyBrow: false, voicePitch: 1,
    leader: 'Ysa', band: '#2788a8',
  },
  neanderthal: {
    id: 'neanderthal', name: 'Neanderthal', plural: 'Neanderthals', tag: 'Ice-Kin Mammoth Juggernauts',
    archetype: 'Heavy Frontline Brawlers · +20% Melee HP & Might · -35% Cold Damage · -8% Speed',
    perks: [
      '+20% Health & Melee Damage on Warriors (+12% HP all units)',
      'Take 35% less cold exposure damage in Winter',
      'Unique: Brutes — colossal siege-breakers with 2H cleavers',
    ],
    gather: {}, cold: 0.65,
    hpAll: 1.12, hp: { kinds: ['guard', 'raider', 'leader', 'brute', 'champion'], mult: 1.20 },
    dmgAll: 1.08, dmg: { kinds: ['guard', 'raider', 'leader', 'brute', 'champion', 'gatherer'], mult: 1.20 },
    speedMult: 0.92,
    unique: 'brute', rival: 'human',
    scale: 1.44, skin: ['#d9a888', '#cc9878', '#b58562'], hair: ['#7a361a', '#5a2814', '#8c4220', '#3a1c10'], heavyBrow: true, voicePitch: 0.55,
    leader: 'Brok', band: '#8a5229',
  },
  denisovan: {
    id: 'denisovan', name: 'Denisovan', plural: 'Denisovans', tag: 'Jade-Peak Sharpshooters & Mystics',
    archetype: 'High-Peak Precision · +15% Weapon Damage & Reach · +6% HP · +1 Sight · +20% Stone/Wood',
    perks: [
      '+15% Attack Damage, +6% Health & +4% Speed across all units',
      '+20% Stone/Wood gathering, +1 Sight & -20% Cold damage',
      'Unique: Stalkers — armor-piercing javelin hunters',
    ],
    gather: { stone: 1.2, wood: 1.2 }, cold: 0.8,
    hpAll: 1.06, hp: { kinds: ['hunter', 'stalker', 'elder', 'guard'], mult: 1.12 },
    dmgAll: 1.12, dmg: { kinds: ['hunter', 'stalker', 'elder', 'guard', 'champion'], mult: 1.18 },
    speedMult: 1.04, rangeMult: 1.12, vision: 1,
    unique: 'stalker', rival: 'neanderthal',
    scale: 1.40, skin: ['#a87a56', '#966a48', '#7d563a'], hair: ['#141010', '#241a14', '#1c1824', '#0e0c0a'], heavyBrow: true, voicePitch: 0.8,
    leader: 'Tala', band: '#4e3a78',
  },
};
export const SPECIES_ORDER: Species[] = ['human', 'neanderthal', 'denisovan'];

/** Compute effective unit stats for a given Species and Generation (1..3) so UI and simulation match. */
export function speciesUnitStats(species: Species, kind: UnitKind, gen = 1) {
  const u = UNITS[kind];
  const sp = SPECIES[species];
  const genMult = gen >= 3 ? 1.3 : gen === 2 ? 1.15 : 1;

  const hpSpeciesMult = sp.hp && sp.hp.kinds.includes(kind) ? sp.hp.mult : (sp.hpAll ?? 1);
  const dmgSpeciesMult = sp.dmg && sp.dmg.kinds.includes(kind) ? sp.dmg.mult : (sp.dmgAll ?? 1);
  const speedSpeciesMult = sp.speedMult ?? 1;

  const hp = Math.round(u.hp * hpSpeciesMult * genMult);
  const dmg = u.dmg > 0 ? Math.max(1, Math.round(u.dmg * dmgSpeciesMult * genMult)) : 0;
  const speed = Number((u.speed * speedSpeciesMult).toFixed(1));
  const vision = u.vision + (sp.vision ?? 0);
  const range = u.range > 1.1 && sp.rangeMult ? Number((u.range * sp.rangeMult).toFixed(1)) : u.range;

  const hpBonusPct = Math.round((hpSpeciesMult * genMult - 1) * 100);
  const dmgBonusPct = Math.round((dmgSpeciesMult * genMult - 1) * 100);
  const speedBonusPct = Math.round((speedSpeciesMult - 1) * 100);
  const visionBonus = sp.vision ?? 0;

  return {
    hp, dmg, speed, vision, range,
    hpPct: hpBonusPct, dmgPct: dmgBonusPct, speedPct: speedBonusPct, visBonus: visionBonus,
    hpBonusPct, dmgBonusPct, speedBonusPct, visionBonus,
    hpSpeciesMult, dmgSpeciesMult, speedSpeciesMult,
  };
}

