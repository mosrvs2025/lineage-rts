import type { DiscoveryId, Species, World } from '../sim/types';
import { makeBuilding, makeUnit } from '../sim/world';
import { nearestFree, rebuildBlocked } from '../sim/grid';
import { log } from '../sim/util';

export type CampaignDifficulty = 'story' | 'standard' | 'ancestral';

export interface CampaignDialogue {
  id: string;
  speaker: string;
  title: string;
  species: Species;
  text: string;
  when: (w: World) => boolean;
}

export interface CampaignObjective {
  id: string;
  text: string;
  check: (w: World) => boolean;
}

export interface CampaignChapter {
  id: string;
  chapterNum: number;
  act: number;
  actName: string;
  title: string;
  subtitle: string;
  species: Species;
  rivalSpecies: Species;
  leaderName: string;
  bannerColor: string;
  mapId: string;
  seed: number;
  lore: string;
  specialRules: string[];
  setup: (w: World, diff: CampaignDifficulty) => void;
  objectives: CampaignObjective[];
  dialogues: CampaignDialogue[];
  checkWin: (w: World) => { won: boolean; msg?: string };
}

export interface ChapterProgress {
  completed: boolean;
  stars: number; // 1..3
  bestTime: number;
  difficulty: CampaignDifficulty;
}

const PROGRESS_KEY = 'lineage-rts:campaign:v1';

export function loadCampaignProgress(): Record<string, ChapterProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ChapterProgress>;
  } catch {
    return {};
  }
}

export function saveChapterVictory(chapterId: string, timeSec: number, lostUnits: number, diff: CampaignDifficulty): ChapterProgress {
  const all = loadCampaignProgress();
  const prev = all[chapterId];
  const stars = diff === 'ancestral' ? 3 : lostUnits <= 2 && timeSec < 900 ? 3 : lostUnits <= 6 ? 2 : 1;
  const next: ChapterProgress = {
    completed: true,
    stars: Math.max(prev?.stars ?? 0, stars),
    bestTime: prev?.bestTime ? Math.min(prev.bestTime, Math.floor(timeSec)) : Math.floor(timeSec),
    difficulty: diff,
  };
  all[chapterId] = next;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
  return next;
}

function applyDifficulty(w: World, diff: CampaignDifficulty) {
  if (diff === 'story') {
    w.res.food += 60;
    w.res.wood += 45;
    w.res.stone += 20;
    w.res.knowledge += 10;
    w.ai.nextRaid += 90;
  } else if (diff === 'ancestral') {
    w.res.food = Math.max(80, w.res.food - 25);
    w.ai.supply += 35;
    w.ai.nextRaid = Math.max(110, w.ai.nextRaid - 45);
  }
}

export const CAMPAIGN_CHAPTERS: CampaignChapter[] = [
  {
    id: 'ch1_embers',
    chapterNum: 1,
    act: 1,
    actName: 'Act I · The Sapiens Dawn',
    title: 'Embers of the Valley',
    subtitle: 'Cro-Magnon Prologue · Ember Valley',
    species: 'human',
    rivalSpecies: 'neanderthal',
    leaderName: 'Auren',
    bannerColor: '#27b7c6',
    mapId: 'valley',
    seed: 10101,
    lore: 'Driven north by ash and drought, Chieftain Auren kindles a fragile hearth in Ember Valley. Autumn leaves are already falling—your clan must master smoke preservation and teaching before the First Frost claims the valley.',
    specialRules: [
      'Starts with an early Cooking clue and abundant nearby berry bushes',
      'Guided mentor transmissions from Chieftain Auren',
      'Win by surviving the First Winter with 30+ Provisions & 1 Preserved Discovery (or raising the Far Meadow Outpost)',
    ],
    setup: (w, diff) => {
      applyDifficulty(w, diff);
      w.disc.cooking = 'clue';
      w.res.food += 30;
      w.res.wood += 20;
    },
    objectives: [
      { id: 'c1_base', text: 'Build a Stockpile and a Toolmaking shelter', check: (w) => w.buildings.some(b => b.owner === 0 && b.kind === 'stockpile' && b.done) && w.buildings.some(b => b.owner === 0 && b.kind === 'toolshelter' && b.done) },
      { id: 'c1_cave', text: 'Send a Scout to explore the Ember Cave (north-west)', check: (w) => !!w.landmarks.find(l => l.id === 'cave')?.visited },
      { id: 'c1_smoke', text: 'Discover Smoke Preservation & build a Smoking Rack', check: (w) => (w.disc.preservation === 'known' || w.disc.preservation === 'preserved') && w.buildings.some(b => b.owner === 0 && b.kind === 'rack' && b.done) },
      { id: 'c1_teach', text: 'Preserve at least 1 Discovery at a Teaching Circle', check: (w) => Object.values(w.disc).some(s => s === 'preserved') },
      { id: 'c1_prov', text: 'Stock 30 Smoked Provisions & survive the First Winter', check: (w) => w.res.provisions >= 30 && w.time >= w.winter.end },
    ],
    dialogues: [
      { id: 'd1_start', speaker: 'Chieftain Auren', title: 'Founder of the Valley Hearth', species: 'human', text: 'Keep the embers bright! Send our gatherers to the berry bushes and timber, then raise a Stockpile and Toolmaking Shelter.', when: (w) => w.time >= 2 },
      { id: 'd1_cave', speaker: 'Pathfinder Sora', title: 'Clan Scout', species: 'human', text: 'Chieftain! Pitch seeps from the walls of the Ember Cave. With a Toolmaking Shelter we can craft torches that never blow out!', when: (w) => !!w.landmarks.find(l => l.id === 'cave')?.visited },
      { id: 'd1_winter', speaker: 'Chieftain Auren', title: 'Founder of the Valley Hearth', species: 'human', text: 'The First Frost descends! Keep our people close to the Hearth and let the Smoking Racks cure our stores.', when: (w) => w.time >= w.winter.start },
    ],
    checkWin: (w) => {
      const hasPreserved = Object.values(w.disc).some(s => s === 'preserved');
      const hasOutpost = w.buildings.some(b => b.owner === 0 && b.outpost && b.done);
      if (hasOutpost || (w.time >= w.winter.end && w.res.provisions >= 30 && hasPreserved)) {
        return { won: true, msg: 'Auren’s hearth burned bright through the First Winter, and the clan’s preserved wisdom passes intact to a new generation!' };
      }
      return { won: false };
    },
  },
  {
    id: 'ch2_glasswater',
    chapterNum: 2,
    act: 1,
    actName: 'Act I · The Sapiens Dawn',
    title: 'Across the Frozen Expanse',
    subtitle: 'Cro-Magnon Expedition · Glasswater Tundra',
    species: 'human',
    rivalSpecies: 'neanderthal',
    leaderName: 'Sora',
    bannerColor: '#27b7c6',
    mapId: 'glasswater',
    seed: 20202,
    lore: 'Generation II looks beyond the valley to the great Glasswater Lake. In summer its deep waters shield your camp—but when winter freezes the lake solid, Neanderthal warbands can march straight across the ice.',
    specialRules: [
      'Begins with Cooking preserved from Generation I and a Hunting Lodge ready',
      'The central lake freezes solid during winter, opening a direct ice bridge',
      'Train Slingers and claim the Far Meadow Outpost across the water',
    ],
    setup: (w, diff) => {
      applyDifficulty(w, diff);
      w.disc.cooking = 'preserved';
      w.disc.portable = 'clue';
      const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth')!;
      const p = nearestFree(w, h.x + 4, h.y + 1);
      makeBuilding(w, 'lodge', 0, Math.floor(p.x), Math.floor(p.y), true);
      rebuildBlocked(w);
      const uPos = nearestFree(w, h.x + 2, h.y + 4);
      makeUnit(w, 'slinger', 0, uPos.x, uPos.y);
    },
    objectives: [
      { id: 'c2_slings', text: 'Train at least 3 Cro-Magnon Slingers or Hunters', check: (w) => w.units.filter(u => u.owner === 0 && (u.kind === 'slinger' || u.kind === 'hunter')).length >= 3 },
      { id: 'c2_ice', text: 'Survive the Winter Ice Crossing & advance to Generation II', check: (w) => w.gen >= 2 },
      { id: 'c2_era2', text: 'Discover Reed Boats or Pottery in Generation II', check: (w) => w.disc.boats === 'known' || w.disc.boats === 'preserved' || w.disc.pottery === 'known' || w.disc.pottery === 'preserved' },
      { id: 'c2_outpost', text: 'Raise the Watch Post Outpost at the Far Meadow', check: (w) => w.buildings.some(b => b.owner === 0 && b.outpost && b.done) },
    ],
    dialogues: [
      { id: 'd2_start', speaker: 'Pathfinder Sora', title: 'Daughter of Auren', species: 'human', text: 'Glasswater Lake divides the tundra. Fish the shallows while the water is open—when the frost comes, the lake will turn to stone!', when: (w) => w.time >= 2 },
      { id: 'd2_freeze', speaker: 'Pathfinder Sora', title: 'Daughter of Auren', species: 'human', text: 'The lake has frozen solid! Guard the shoreline—Neanderthal raiders can cross the ice directly now!', when: (w) => !!w._frozen },
    ],
    checkWin: (w) => {
      if (w.buildings.some(b => b.owner === 0 && b.outpost && b.done)) {
        return { won: true, msg: 'Sora’s expedition crossed the Glasswater expanse and raised the high watchtower over the Far Meadow!' };
      }
      return { won: false };
    },
  },
  {
    id: 'ch3_mammoth',
    chapterNum: 3,
    act: 2,
    actName: 'Act II · Sons of the Frost',
    title: 'Blood of the Great Mammoth',
    subtitle: 'Neanderthal Hunt · Mammoth Canyon',
    species: 'neanderthal',
    rivalSpecies: 'human',
    leaderName: 'Torag',
    bannerColor: '#e89a3c',
    mapId: 'canyon',
    seed: 30303,
    lore: 'In the red-rock badlands of Mammoth Canyon, berries and fish are scarce. Warchief Torag must lead his ice-forged Neanderthal Brutes and Hunters into the central basin to bring down the colossal Woolly Mammoths.',
    specialRules: [
      'Starts with 2 Neanderthal Brutes and a Toolmaking Shelter',
      'Each felled Mammoth yields a massive 260-meat carcass',
      'Fell Mammoths, smoke 70 Provisions, and conquer the Canyon Pass or Far Meadow',
    ],
    setup: (w, diff) => {
      applyDifficulty(w, diff);
      const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth')!;
      makeBuilding(w, 'toolshelter', 0, h.x + 4, h.y - 2, true);
      makeBuilding(w, 'lodge', 0, h.x + 4, h.y + 2, true);
      rebuildBlocked(w);
      for (let i = 0; i < 2; i++) {
        const p = nearestFree(w, h.x + 2 + i, h.y + 4);
        makeUnit(w, 'brute', 0, p.x, p.y);
      }
      w.disc.preservation = 'clue';
    },
    objectives: [
      { id: 'c3_warband', text: 'Muster a hunting warband of 5+ fighters (Brutes, Hunters, or Guards)', check: (w) => w.units.filter(u => u.owner === 0 && ['brute', 'hunter', 'guard', 'leader', 'champion'].includes(u.kind)).length >= 5 },
      { id: 'c3_meat', text: 'Harvest 120+ Meat from hunted game & Mammoths', check: (w) => w.stats.meat >= 120 },
      { id: 'c3_prov', text: 'Smoke 70 Provisions at your Smoking Racks', check: (w) => w.res.provisions >= 70 },
      { id: 'c3_win', text: 'Claim the Far Meadow Outpost OR destroy the Rival Watch Post at the Pass', check: (w) => w.buildings.some(b => b.owner === 0 && b.outpost && b.done) || !w.buildings.some(b => b.owner === 1 && b.kind === 'watch') },
    ],
    dialogues: [
      { id: 'd3_start', speaker: 'Warchief Torag', title: 'Iron-Brow of the Canyon', species: 'neanderthal', text: 'Shrubs will not feed our clan in these red canyons. Rally the Brutes and Hunters—the Great Mammoths in the central basin will feast us for a generation!', when: (w) => w.time >= 2 },
      { id: 'd3_meat', speaker: 'Warchief Torag', title: 'Iron-Brow of the Canyon', species: 'neanderthal', text: 'A mighty beast falls! Haul the meat to the Smoking Racks before the canyon wolves gather.', when: (w) => w.stats.meat >= 60 },
    ],
    checkWin: (w) => {
      const passCleared = !w.buildings.some(b => b.owner === 1 && b.kind === 'watch');
      const outpostBuilt = w.buildings.some(b => b.owner === 0 && b.outpost && b.done);
      if (w.stats.meat >= 120 && w.res.provisions >= 70 && (passCleared || outpostBuilt)) {
        return { won: true, msg: 'Torag’s Thunderers felled the titans of Mammoth Canyon and broke the rival blockade!' };
      }
      return { won: false };
    },
  },
  {
    id: 'ch4_ironwinter',
    chapterNum: 4,
    act: 2,
    actName: 'Act II · Sons of the Frost',
    title: 'The Iron Winter',
    subtitle: 'Neanderthal Bastion · Permafrost Valley',
    species: 'neanderthal',
    rivalSpecies: 'denisovan',
    leaderName: 'Ursa',
    bannerColor: '#d84e28',
    mapId: 'valley',
    seed: 40404,
    lore: 'A volcanic ash-winter descends early upon the valley. Denisovan Stalkers strike from the mist while frost grips the river. Shield-Mother Ursa must fortify the river crossings, upgrade to a War Lodge, and crush the raiders.',
    specialRules: [
      'Winter arrives early and lasts longer; Neanderthal Cold Grit (-45% cold damage) shines',
      'Starts with Cooking & Portable Fire known',
      'Defeat 8 rival attackers and either raise the Far Meadow Outpost or raze the Rival Hearth',
    ],
    setup: (w, diff) => {
      applyDifficulty(w, diff);
      w.disc.cooking = 'preserved';
      w.disc.portable = 'known';
      w.disc.preservation = 'known';
      w.winter = { start: 260, end: 640 };
      w.res.wood += 50;
      w.res.stone += 35;
    },
    objectives: [
      { id: 'c4_fort', text: 'Build a Watch Post or Palisade wall to guard your settlement', check: (w) => w.buildings.some(b => b.owner === 0 && (b.kind === 'watch' || b.kind === 'palisade') && b.done) },
      { id: 'c4_warlodge', text: 'Upgrade a Hunting Lodge into a War Lodge (Tier 1)', check: (w) => w.buildings.some(b => b.owner === 0 && b.kind === 'lodge' && b.tier >= 1) },
      { id: 'c4_kills', text: 'Defeat 8 Rival Clan attackers in battle', check: (w) => w.stats.kills >= 8 },
      { id: 'c4_victory', text: 'Raise the Far Meadow Outpost (Gen II) OR destroy the Rival Clan Hearth', check: (w) => w.buildings.some(b => b.owner === 0 && b.outpost && b.done) || !w.buildings.some(b => b.owner === 1 && b.kind === 'hearth') },
    ],
    dialogues: [
      { id: 'd4_start', speaker: 'Shield-Mother Ursa', title: 'Matriarch of the Frost', species: 'neanderthal', text: 'Ash clouds blot out the sun—the Iron Winter comes early. Raise Watch Posts and Smoking Racks! The frost is our ally, not our grave.', when: (w) => w.time >= 2 },
      { id: 'd4_kills', speaker: 'Shield-Mother Ursa', title: 'Matriarch of the Frost', species: 'neanderthal', text: 'Their raiders break against our shields! Press the advantage and march on their pass!', when: (w) => w.stats.kills >= 5 },
    ],
    checkWin: (w) => {
      const rivalDown = !w.buildings.some(b => b.owner === 1 && b.kind === 'hearth');
      const outpostBuilt = w.buildings.some(b => b.owner === 0 && b.outpost && b.done);
      if (w.stats.kills >= 8 && (rivalDown || outpostBuilt)) {
        return { won: true, msg: 'Shield-Mother Ursa stood unbowed through the Iron Winter and shattered the Denisovan siege!' };
      }
      return { won: false };
    },
  },
  {
    id: 'ch5_isles',
    chapterNum: 5,
    act: 3,
    actName: 'Act III · Ghost-Walkers of the High Peaks',
    title: 'Whispers on the Causeways',
    subtitle: 'Denisovan Mastery · The Isles',
    species: 'denisovan',
    rivalSpecies: 'human',
    leaderName: 'Zhur',
    bannerColor: '#38d39c',
    mapId: 'isles',
    seed: 50505,
    lore: 'Across the mist-shrouded island chain, Seer Zhur leads the Denisovan Ghost-Walkers. Every shallow causeway is a chokepoint, and ancient megaliths hold forgotten lore for those swift enough to claim them.',
    specialRules: [
      'Denisovan units have +2 Sight Range and faster Discovery & Teaching',
      'Claim the Ancestral Megalith and Ember Cave for massive Knowledge',
      'Preserve 3 Discoveries and claim the Far Meadow Outpost',
    ],
    setup: (w, diff) => {
      applyDifficulty(w, diff);
      const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth')!;
      makeBuilding(w, 'circle', 0, h.x - 4, h.y, true);
      rebuildBlocked(w);
      const p = nearestFree(w, h.x + 2, h.y + 4);
      makeUnit(w, 'stalker', 0, p.x, p.y);
      w.res.knowledge += 20;
    },
    objectives: [
      { id: 'c5_landmarks', text: 'Explore both the Ember Cave and the Ancestral Megalith', check: (w) => !!w.landmarks.find(l => l.id === 'cave')?.visited && !!w.landmarks.find(l => l.id === 'shrine')?.visited },
      { id: 'c5_stalkers', text: 'Train 3 Denisovan Stalkers or Elders', check: (w) => w.units.filter(u => u.owner === 0 && (u.kind === 'stalker' || u.kind === 'elder')).length >= 3 },
      { id: 'c5_preserve3', text: 'Preserve at least 3 Discoveries at your Teaching Circle', check: (w) => Object.values(w.disc).filter(s => s === 'preserved').length >= 3 },
      { id: 'c5_outpost', text: 'Advance to Generation II and raise the Far Meadow Outpost', check: (w) => w.buildings.some(b => b.owner === 0 && b.outpost && b.done) },
    ],
    dialogues: [
      { id: 'd5_start', speaker: 'Seer Zhur', title: 'Voice of the High Peaks', species: 'denisovan', text: 'The Isles are bound by shallow causeways. Send our Stalkers across the fords to uncover the Ember Cave and the Ancestral Megalith!', when: (w) => w.time >= 2 },
      { id: 'd5_shrine', speaker: 'Seer Zhur', title: 'Voice of the High Peaks', species: 'denisovan', text: 'The Ancestral Megalith hums with old memory! Teach these secrets at the Circle so they never fade.', when: (w) => !!w.landmarks.find(l => l.id === 'shrine')?.visited },
    ],
    checkWin: (w) => {
      const preservedCount = Object.values(w.disc).filter(s => s === 'preserved').length;
      if (preservedCount >= 3 && w.buildings.some(b => b.owner === 0 && b.outpost && b.done)) {
        return { won: true, msg: 'Seer Zhur’s Ghost-Walkers mastered the causeways and etched three eternal discoveries into the clan’s lineage!' };
      }
      return { won: false };
    },
  },
  {
    id: 'ch6_threefires',
    chapterNum: 6,
    act: 3,
    actName: 'Act III · Ghost-Walkers of the High Peaks',
    title: 'Dawn of the Three Fires',
    subtitle: 'Grand Finale · Generation III Convergence',
    species: 'denisovan',
    rivalSpecies: 'neanderthal',
    leaderName: 'Altai',
    bannerColor: '#a864e8',
    mapId: 'valley',
    seed: 60606,
    lore: 'Three generations of struggle converge in the Grand Finale. Beginning in Generation II with ancestral wisdom already preserved, High Chieftain Altai must unlock Era III Civilization Mastery—High-Heat Kilns & Seasonal Irrigation—and unite the entire valley under one eternal banner.',
    specialRules: [
      'Starts in Generation II with Cooking, Smoke Preservation & Portable Fire preserved',
      'Starts with Stockpile, Toolmaking Shelter, Hunting Lodge, and Smoking Rack built',
      'Advance to Generation III, master an Era III Discovery, and destroy the Rival Hearth!',
    ],
    setup: (w, diff) => {
      applyDifficulty(w, diff);
      w.gen = 2;
      w.endless = true;
      w.disc.cooking = 'preserved';
      w.disc.preservation = 'preserved';
      w.disc.portable = 'preserved';
      w.disc.pottery = 'clue';
      w.disc.heat = 'clue';
      w.disc.farming = 'clue';
      w.res.food = 220;
      w.res.wood = 160;
      w.res.stone = 90;
      w.res.knowledge = 45;
      w.res.provisions = 45;
      const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth')!;
      makeBuilding(w, 'stockpile', 0, h.x + 4, h.y - 3, true);
      makeBuilding(w, 'toolshelter', 0, h.x + 4, h.y + 1, true);
      makeBuilding(w, 'lodge', 0, h.x - 4, h.y + 1, true);
      makeBuilding(w, 'rack', 0, h.x + 1, h.y - 4, true);
      makeBuilding(w, 'circle', 0, h.x + 7, h.y - 1, true);
      rebuildBlocked(w);
      for (const u of w.units) if (u.owner === 0) u.gen = 2;
      const p1 = nearestFree(w, h.x + 3, h.y + 4);
      const s1 = makeUnit(w, 'stalker', 0, p1.x, p1.y); s1.gen = 2;
      const s2 = makeUnit(w, 'guard', 0, p1.x + 1, p1.y); s2.gen = 2;
    },
    objectives: [
      { id: 'c6_era2', text: 'Preserve Pottery, Controlled Heat, or Seed Cultivation at your Teaching Circle', check: (w) => (['pottery', 'heat', 'farming'] as DiscoveryId[]).some(id => w.disc[id] === 'preserved') },
      { id: 'c6_gen3', text: 'Survive Winter and advance to Generation III (Sun-Bronze Era)', check: (w) => w.gen >= 3 },
      { id: 'c6_era3', text: 'Master High-Heat Kilns or Seasonal Irrigation (Era III)', check: (w) => w.disc.kiln === 'known' || w.disc.kiln === 'preserved' || w.disc.irrigation === 'known' || w.disc.irrigation === 'preserved' },
      { id: 'c6_unite', text: 'Lead your Sun-Bronze Warband to destroy the Rival Clan Hearth', check: (w) => !w.buildings.some(b => b.owner === 1 && b.kind === 'hearth') },
    ],
    dialogues: [
      { id: 'd6_start', speaker: 'High Chieftain Altai', title: 'Herald of the Three Fires', species: 'denisovan', text: 'Our ancestors bequeathed us fire, smoke, and shelter. Preserve the crafts of Era II, forge into Generation III, and unite every clan in the valley!', when: (w) => w.time >= 2 },
      { id: 'd6_gen3', speaker: 'High Chieftain Altai', title: 'Herald of the Three Fires', species: 'denisovan', text: 'Generation III dawns! Behold our gilded sun-bronze regalia and twin clan banners. Master the High-Heat Kilns and march upon the Rival Hearth!', when: (w) => w.gen >= 3 },
    ],
    checkWin: (w) => {
      if (!w.buildings.some(b => b.owner === 1 && b.kind === 'hearth')) {
        return { won: true, msg: 'Under High Chieftain Altai, the Three Fires are united! From stone and embers, a timeless civilization rises over the valley.' };
      }
      return { won: false };
    },
  },
];

export function getCampaignChapter(id?: string): CampaignChapter | undefined {
  if (!id) return undefined;
  return CAMPAIGN_CHAPTERS.find(c => c.id === id);
}

/** Tick campaign-specific dialogues and custom victory conditions once per second. */
export function campaignSecond(w: World) {
  if (!w.campaignId || w.status !== 'playing') return;
  const ch = getCampaignChapter(w.campaignId);
  if (!ch) return;
  w.done ??= {};
  for (const d of ch.dialogues) {
    const k = `dlg_${d.id}`;
    if (!w.done[k] && d.when(w)) {
      w.done[k] = true;
      log(w, `${d.speaker}: "${d.text}"`, 'info');
    }
  }
  for (const obj of ch.objectives) {
    if (obj.check(w)) w.done[obj.id] = true;
  }
  const res = ch.checkWin(w);
  if (res.won) {
    w.status = 'won';
    w.endMsg = res.msg ?? 'Campaign chapter complete!';
    saveChapterVictory(ch.id, w.time, w.stats.lost, (w.campaignDiff as CampaignDifficulty) ?? 'standard');
  }
}
