import type { BuildingKind, CostMap } from '../sim/types';

export interface TechDef { id: string; name: string; at: BuildingKind; icon: string; cost: CostMap; time: number; desc: string }

/** Technologies researched at buildings. Their effects are read by the simulation through `hasTech`. */
export const TECHS: Record<string, TechDef> = {
  baskets: { id: 'baskets', name: 'Woven baskets', at: 'stockpile', icon: 'gatherer', cost: { wood: 40, knowledge: 10 }, time: 25, desc: 'Gatherers and hunters carry 50% more per trip.' },
  flint: { id: 'flint', name: 'Flint-edged weapons', at: 'toolshelter', icon: 'toolshelter', cost: { stone: 35, knowledge: 15 }, time: 30, desc: 'Spears, axes and clubs deal +15% damage.' },
  leather: { id: 'leather', name: 'Hide armour', at: 'lodge', icon: 'guard', cost: { food: 60, wood: 30 }, time: 35, desc: 'All fighters have +20% health.' },
  fleet: { id: 'fleet', name: 'Fleet-footed', at: 'lodge', icon: 'move', cost: { food: 40, knowledge: 15 }, time: 30, desc: 'Scouts, raiders and slingers move 15% faster.' },
  remedies: { id: 'remedies', name: 'Herbal remedies', at: 'circle', icon: 'heart', cost: { knowledge: 25, food: 20 }, time: 30, desc: 'Elders heal twice as fast.' },
  hardy: { id: 'hardy', name: 'Fur wraps', at: 'hearth', icon: 'snow', cost: { food: 30, wood: 25 }, time: 28, desc: 'Cold damage is reduced by 40%.' },
};
export const techsFor = (k: BuildingKind) => Object.values(TECHS).filter((t) => t.at === k);
