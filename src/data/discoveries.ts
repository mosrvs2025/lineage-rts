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
    needs: ['toolshelter'], cost: { wood: 20, stone: 20, knowledge: 30 }, time: 50, parent: 'portable', later: true,
    effect: 'Fire-hardened spears: your hunters, guards, raiders and leader deal +25% damage.' },
};

export const DISC_ORDER: DiscoveryId[] = ['cooking', 'preservation', 'portable', 'heat'];
