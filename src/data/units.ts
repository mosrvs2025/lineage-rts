import type { Res, UnitKind } from '../sim/types';

export interface UnitDef {
  name: string; glyph: string; desc: string;
  hp: number; speed: number; dmg: number; range: number; cd: number;
  vision: number; carry: number; aggro: number;
  cost: Partial<Record<Res, number>>; time: number;
  needs?: string;        // building kind required to train
  trainAt?: string;
  radius: number;
}

export const UNITS: Record<UnitKind, UnitDef> = {
  gatherer: { name: 'Gatherer', glyph: 'G', desc: 'Gathers, builds and repairs. Vulnerable without protection.',
    hp: 30, speed: 2.6, dmg: 3, range: 0.9, cd: 1.2, vision: 6, carry: 10, aggro: 0,
    cost: { food: 25 }, time: 10, trainAt: 'hearth', radius: 0.4 },
  scout: { name: 'Scout', glyph: 'S', desc: 'Fast. Finds routes and clues. Weak in a fight.',
    hp: 25, speed: 4.4, dmg: 3, range: 0.9, cd: 1.2, vision: 10, carry: 0, aggro: 0,
    cost: { food: 30 }, time: 12, trainAt: 'lodge', radius: 0.4 },
  hunter: { name: 'Hunter', glyph: 'H', desc: 'Ranged. Hunts deer and drives off wolves. Weak at close range.',
    hp: 35, speed: 2.9, dmg: 8, range: 6, cd: 1.4, vision: 8, carry: 10, aggro: 8,
    cost: { food: 30, wood: 20 }, time: 16, trainAt: 'lodge', radius: 0.4 },
  guard: { name: 'Spear guard', glyph: 'P', desc: 'Tough melee unit that holds approaches. Can be outmaneuvered.',
    hp: 75, speed: 2.5, dmg: 9, range: 1.2, cd: 1.0, vision: 6, carry: 0, aggro: 7,
    cost: { food: 35, wood: 15 }, time: 18, trainAt: 'lodge', needs: 'toolshelter', radius: 0.45 },
  raider: { name: 'Raider', glyph: 'R', desc: 'Fast striker that hunts workers and archers. Struggles against guards.',
    hp: 45, speed: 3.7, dmg: 11, range: 1.0, cd: 0.9, vision: 7, carry: 0, aggro: 8,
    cost: { food: 35, stone: 15 }, time: 18, trainAt: 'lodge', needs: 'toolshelter', radius: 0.4 },
  leader: { name: 'Clan leader', glyph: 'L', desc: 'Nearby allies fight 15% harder. Rally heals and speeds nearby allies.',
    hp: 90, speed: 2.8, dmg: 12, range: 1.2, cd: 1.0, vision: 8, carry: 0, aggro: 7,
    cost: {}, time: 0, radius: 0.5 },
  deer: { name: 'Deer', glyph: 'd', desc: 'Wildlife. Hunt for meat.',
    hp: 25, speed: 3.4, dmg: 0, range: 0, cd: 1, vision: 6, carry: 0, aggro: 0,
    cost: {}, time: 0, radius: 0.4 },
  wolf: { name: 'Wolf', glyph: 'w', desc: 'Predator. Attacks lone workers.',
    hp: 45, speed: 3.3, dmg: 7, range: 1.0, cd: 1.1, vision: 8, carry: 0, aggro: 7,
    cost: {}, time: 0, radius: 0.4 },
};

export const TRAINABLE: UnitKind[] = ['gatherer', 'scout', 'hunter', 'guard', 'raider'];
