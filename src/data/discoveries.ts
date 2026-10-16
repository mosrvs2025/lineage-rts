import type { BuildingKind, DiscoveryId, Res } from '../sim/types';

export interface DiscoveryDef {
  id: DiscoveryId; name: string; branch: string;
  clue: string;            // shown once observed
  clueHint: string;        // how to get the clue
  needs: BuildingKind[];   // facilities that must exist
  cost: Partial<Record<Res | 'knowledge', number>>;
  time: number;
  parent?: DiscoveryId;    // inherited expertise discounts children of preserved knowledge
  effect: string;
  later?: boolean;
  minGen?: number;         // earliest generation that can investigate this discovery
}

export const DISCOVERIES: Record<DiscoveryId, DiscoveryDef> = {
  cooking: { id: 'cooking', name: 'Cooking', branch: 'Maintain fire',
    clue: 'Meat held over the embers is softer and goes further.',
    clueHint: 'Deliver 25 food to a drop-off.',
    needs: ['hearth'], cost: { wood: 10, knowledge: 10 }, time: 20,
    effect: 'All food you deliver is worth +25%.' },
  preservation: { id: 'preservation', name: 'Smoke preservation', branch: 'Maintain fire',
    clue: 'Food left near smoke does not spoil.',
    clueHint: 'Deliver 15 meat from hunted deer, or survive until winter begins.',
    needs: ['hearth', 'stockpile'], cost: { wood: 15, stone: 10, knowledge: 20 }, time: 35,
    effect: 'Unlocks smoking racks: food becomes provisions that never spoil and that feed expeditions.' },
  portable: { id: 'portable', name: 'Portable fire', branch: 'Maintain fire',
    clue: 'Pitch seeping from the cave wall burns for hours — a torch can be carried.',
    clueHint: 'Send a scout to the Ember Cave (north-west of camp).',
    needs: ['toolshelter'], cost: { wood: 20, stone: 5, knowledge: 20 }, time: 35,
    effect: 'Hunters and guards carry torches: wolves flee from them and keep away from workers near them.' },
  heat: { id: 'heat', name: 'Controlled heat', branch: 'Maintain fire',
    clue: 'Fire-hardened wood holds an edge better than raw wood.',
    clueHint: 'Know both Cooking and Portable fire.',
    needs: ['toolshelter'], cost: { wood: 20, stone: 20, knowledge: 30 }, time: 50, parent: 'portable', later: true, minGen: 2,
    effect: 'Fire-hardened spears: your hunters, guards, raiders and leader deal +25% damage.' },
  pottery: { id: 'pottery', name: 'Pottery', branch: 'Shaping earth & seed',
    clue: 'River clay beside the hearth bakes into watertight jars that keep grain dry and vermin out.',
    clueHint: 'Know Cooking and have a Stockpile built.',
    needs: ['hearth', 'stockpile'], cost: { wood: 20, stone: 20, knowledge: 25 }, time: 40, parent: 'cooking', later: true, minGen: 2,
    effect: 'Clay vessels cut winter food spoilage by 60%, extend supply range by +6 tiles, and boost smoking racks (+2 provisions/batch).' },
  farming: { id: 'farming', name: 'Seed cultivation', branch: 'Shaping earth & seed',
    clue: 'Seeds spilled near the warm camp sprout in thick rows when spring warms the soil.',
    clueHint: 'Deliver 80 food or survive the first winter.',
    needs: ['stockpile', 'toolshelter'], cost: { food: 25, wood: 20, knowledge: 30 }, time: 45, parent: 'preservation', later: true, minGen: 2,
    effect: 'Unlocks Crop fields (steady food harvest near camp) and doubles natural berry bush regrowth.' },
  boats: { id: 'boats', name: 'Reed & dugout boats', branch: 'Water & trade',
    clue: 'Hollowed logs charred with embers float steady across deep water and swift currents.',
    clueHint: 'Explore a ford or shoreline while knowing Portable fire or Cooking.',
    needs: ['toolshelter', 'lodge'], cost: { wood: 30, stone: 10, knowledge: 25 }, time: 40, parent: 'portable', later: true, minGen: 2,
    effect: 'Units cross fords and shorelines 40% faster, fishing spots yield +50%, and expeditions burn 35% fewer provisions.' },
  kiln: { id: 'kiln', name: 'High-heat kilns', branch: 'Civilization foundations',
    clue: 'Forced-draught kilns fire brick and glaze stone to outlast any storm or siege.',
    clueHint: 'Know both Pottery and Controlled heat.',
    needs: ['toolshelter', 'stockpile'], cost: { wood: 30, stone: 35, knowledge: 45 }, time: 50, parent: 'pottery', later: true, minGen: 3,
    effect: 'Fired brick & masonry: all buildings gain +35% health and +3 warmth radius; Watch towers deal +30% damage.' },
  irrigation: { id: 'irrigation', name: 'Seasonal irrigation', branch: 'Civilization foundations',
    clue: 'Channels dug from the river keep crop plots green even when frost grips the valley.',
    clueHint: 'Know Seed cultivation and build a Crop field (or deliver 250 food).',
    needs: ['stockpile', 'circle'], cost: { food: 30, wood: 25, stone: 20, knowledge: 45 }, time: 50, parent: 'farming', later: true, minGen: 3,
    effect: 'Crop fields produce +60% more food even during winter, and all food gathering is +25% faster.' },
};

export const DISC_ORDER: DiscoveryId[] = [
  'cooking', 'preservation', 'portable',
  'heat', 'pottery', 'farming', 'boats',
  'kiln', 'irrigation',
];
