import type { Game } from './game';
import { icon } from './icons';
import { sfx } from './audio';
import { bCenter } from '../sim/util';

export interface TutorialStep {
  id: string;
  title: string;
  mentor: string;
  text: string;
  spotlight?: string; // CSS selector to highlight with pulsing ring
  rewardText: string;
  check: (g: Game) => boolean;
  reward: (g: Game) => void;
  showMe: (g: Game) => void;
}

const TUT_DONE_KEY = 'lineage-rts:tutorial:done';

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'select_worker',
    title: '1. Select a Gatherer',
    mentor: 'Chieftain Auren',
    text: 'Welcome to the valley! Every clan survives by the hands of its gatherers. Tap a Gatherer near the Hearth, or tap the Idle Worker button to select one.',
    spotlight: '[data-act="nextidle"], [data-act="idle"]',
    rewardText: '+15 Food',
    check: (g) => {
      const w = g.world; if (!w) return false;
      return g.sel.some(id => w._u?.get(id)?.owner === 0);
    },
    reward: (g) => { if (g.world) g.world.res.food += 15; },
    showMe: (g) => {
      const w = g.world; if (!w) return;
      const u = w.units.find(x => x.owner === 0 && x.kind === 'gatherer') ?? w.units.find(x => x.owner === 0);
      if (u) {
        g.selectUnits([u.id]);
        g.cam.centerOn(u.x, u.y);
        g.ping(u.x, u.y, 'rgba(255,215,110,.95)');
      }
    },
  },
  {
    id: 'gather_res',
    title: '2. Harvest Food & Timber',
    mentor: 'Chieftain Auren',
    text: 'With a Gatherer selected, tap a Berry Bush or Tree (or open Jobs on the right dock) so your clan collects Food and Wood for the coming frost.',
    spotlight: '[data-act="jobs"], [data-act="work"]',
    rewardText: '+20 Wood',
    check: (g) => {
      const w = g.world; if (!w) return false;
      return w.stats.food >= 4 || w.units.filter(u => u.owner === 0 && u.order.t === 'gather').length >= 4;
    },
    reward: (g) => { if (g.world) g.world.res.wood += 20; },
    showMe: (g) => {
      const w = g.world; if (!w) return;
      const bush = w.nodes.find(n => n.kind === 'bush');
      if (bush) {
        g.cam.centerOn(bush.x, bush.y);
        g.ping(bush.x + 0.5, bush.y + 0.5, 'rgba(150,255,160,.95)');
      }
    },
  },
  {
    id: 'build_stockpile',
    title: '3. Construct a Stockpile or Shelter',
    mentor: 'Chieftain Auren',
    text: 'Tap Build (B) on the right dock, pick a Stockpile or Toolmaking Shelter, drag the green footprint onto clear ground, and tap Place.',
    spotlight: '[data-act="build"], [data-act="place-ok"]',
    rewardText: '+20 Wood, +10 Stone',
    check: (g) => {
      const w = g.world; if (!w) return false;
      return w.buildings.some(b => b.owner === 0 && (b.kind === 'stockpile' || b.kind === 'toolshelter'));
    },
    reward: (g) => { if (g.world) { g.world.res.wood += 20; g.world.res.stone += 10; } },
    showMe: (g) => {
      g.hud.act('build');
    },
  },
  {
    id: 'build_tools',
    title: '4. Raise a Toolmaking Shelter',
    mentor: 'Elder Kaelen',
    text: 'Flint tools speed up wood and stone gathering by +15% and unlock Guards, Raiders, and Portable Fire. Build a Toolmaking Shelter near your Hearth!',
    spotlight: '[data-act="build"], [data-act="placeb:toolshelter"]',
    rewardText: '+15 Knowledge',
    check: (g) => {
      const w = g.world; if (!w) return false;
      return w.buildings.some(b => b.owner === 0 && b.kind === 'toolshelter');
    },
    reward: (g) => { if (g.world) g.world.res.knowledge += 15; },
    showMe: (g) => {
      g.startPlace('toolshelter');
    },
  },
  {
    id: 'scout_cave',
    title: '5. Scout the Ember Cave',
    mentor: 'Pathfinder Sora',
    text: 'Landmarks hold ancient clues! Select your Scout (or tap Army) and send them north-west to the Ember Cave, or use your Scout’s Eagle Flare ability.',
    spotlight: '[data-act="army"], [data-act="flare"]',
    rewardText: '+15 Knowledge & Portable Fire Clue',
    check: (g) => {
      const w = g.world; if (!w) return false;
      const cave = w.landmarks.find(l => l.id === 'cave');
      const scout = w.units.find(u => u.owner === 0 && (u.kind === 'scout' || u.kind === 'stalker'));
      return !!cave?.visited || (!!scout && scout.order.t !== 'idle' && Math.hypot(scout.x - (cave?.x ?? 0), scout.y - (cave?.y ?? 0)) < 16);
    },
    reward: (g) => {
      if (g.world) {
        g.world.res.knowledge += 15;
        if (g.world.disc.portable === 'hidden') g.world.disc.portable = 'clue';
      }
    },
    showMe: (g) => {
      const w = g.world; if (!w) return;
      const scout = w.units.find(u => u.owner === 0 && (u.kind === 'scout' || u.kind === 'stalker')) ?? w.units.find(u => u.owner === 0);
      const cave = w.landmarks.find(l => l.id === 'cave');
      if (scout) g.selectUnits([scout.id]);
      if (cave) {
        g.cam.centerOn(cave.x, cave.y);
        g.ping(cave.x + 0.5, cave.y + 0.5, 'rgba(255,215,110,.95)');
      }
    },
  },
  {
    id: 'investigate_disc',
    title: '6. Investigate a Discovery',
    mentor: 'Elder Kaelen',
    text: 'Once you observe a clue, open Discoveries (D) on the right dock and tap Investigate on Cooking, Smoke Preservation, or Portable Fire!',
    spotlight: '[data-act="disc"], [data-act^="inv:"]',
    rewardText: '+25 Food, +15 Knowledge',
    check: (g) => {
      const w = g.world; if (!w) return false;
      return w.activities.some(a => a.kind === 'investigate') || Object.values(w.disc).some(s => s === 'known' || s === 'preserved');
    },
    reward: (g) => { if (g.world) { g.world.res.food += 25; g.world.res.knowledge += 15; } },
    showMe: (g) => {
      if (g.world && g.world.disc.cooking === 'hidden') g.world.disc.cooking = 'clue';
      g.hud.act('disc');
    },
  },
  {
    id: 'muster_warband',
    title: '7. Muster Warriors & Chieftain Rally',
    mentor: 'Chieftain Auren',
    text: 'Rival warbands and wolves prowl the valley. Build a Hunting Lodge to train Hunters/Guards, or select your Chieftain and tap Rally to inspire nearby allies!',
    spotlight: '[data-act="rally"], [data-act="build"], [data-act^="train:"]',
    rewardText: '+25 Food, +15 Stone',
    check: (g) => {
      const w = g.world; if (!w) return false;
      const ldr = w.units.find(u => u.owner === 0 && u.kind === 'leader');
      const hasLodge = w.buildings.some(b => b.owner === 0 && b.kind === 'lodge');
      const fighters = w.units.filter(u => u.owner === 0 && ['hunter', 'guard', 'raider', 'slinger', 'brute', 'stalker', 'champion'].includes(u.kind)).length;
      return hasLodge || fighters >= 2 || (!!ldr && ldr.ability > 0);
    },
    reward: (g) => { if (g.world) { g.world.res.food += 25; g.world.res.stone += 15; } },
    showMe: (g) => {
      const w = g.world; if (!w) return;
      const ldr = w.units.find(u => u.owner === 0 && u.kind === 'leader');
      if (ldr) {
        g.selectUnits([ldr.id]);
        g.cam.centerOn(ldr.x, ldr.y);
      }
    },
  },
  {
    id: 'preserve_knowledge',
    title: '8. Smoke Provisions & Preserve Wisdom',
    mentor: 'Elder Kaelen',
    text: 'Unpreserved discoveries fade if their specialist falls or when a generation ends! Build a Teaching Circle to Teach Apprentices, and a Smoking Rack for winter provisions.',
    spotlight: '[data-act="build"], [data-act="disc"], [data-act^="teach:"]',
    rewardText: '+20 Provisions, +20 Knowledge',
    check: (g) => {
      const w = g.world; if (!w) return false;
      return w.buildings.some(b => b.owner === 0 && (b.kind === 'circle' || b.kind === 'rack')) ||
        w.activities.some(a => a.kind === 'teach') ||
        Object.values(w.disc).some(s => s === 'preserved');
    },
    reward: (g) => { if (g.world) { g.world.res.provisions += 20; g.world.res.knowledge += 20; } },
    showMe: (g) => {
      const w = g.world; if (!w) return;
      const h = w.buildings.find(b => b.owner === 0 && b.kind === 'hearth');
      if (h) { const c = bCenter(h); g.cam.centerOn(c.x, c.y); }
      g.hud.act('build');
    },
  },
];

export class TutorialController {
  active = false;
  stepIdx = 0;
  private lastHtml = '';
  private container: HTMLElement | null = null;

  constructor(private g: Game) {}

  private ensureContainer(): HTMLElement {
    if (this.container && document.body.contains(this.container)) return this.container;
    let el = document.getElementById('tut-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tut-banner';
      el.className = 'tut-banner hidden';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      document.getElementById('app')?.appendChild(el);
    }
    this.container = el;
    return el;
  }

  start(fromBeginning = true) {
    this.active = true;
    if (fromBeginning) this.stepIdx = 0;
    this.lastHtml = '';
    this.update();
  }

  stop(markComplete = false) {
    this.active = false;
    this.clearSpotlights();
    const el = this.ensureContainer();
    el.classList.add('hidden');
    el.innerHTML = '';
    this.lastHtml = '';
    if (markComplete) {
      try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch { /* ignore */ }
    }
  }

  nextStep() {
    const cur = TUTORIAL_STEPS[this.stepIdx];
    if (cur) {
      cur.reward(this.g);
      sfx.good();
      this.g.hud?.toast(`Tutorial Step Complete: ${cur.rewardText}!`, 'good');
    }
    this.stepIdx++;
    if (this.stepIdx >= TUTORIAL_STEPS.length) {
      this.stop(true);
      this.g.hud?.toast('Path of the First Fire complete! Your clan is ready to conquer the winter.', 'good');
      return;
    }
    this.lastHtml = '';
    this.update();
  }

  showMeCurrent() {
    const cur = TUTORIAL_STEPS[this.stepIdx];
    if (cur) cur.showMe(this.g);
  }

  private clearSpotlights() {
    document.querySelectorAll('.tut-spotlight').forEach(el => el.classList.remove('tut-spotlight'));
  }

  update() {
    const el = this.ensureContainer();
    if (!this.active || !this.g.world || this.g.showcase || this.g.menuOpen) {
      el.classList.add('hidden');
      this.clearSpotlights();
      return;
    }
    const step = TUTORIAL_STEPS[this.stepIdx];
    if (!step) {
      this.stop(true);
      return;
    }
    if (step.check(this.g)) {
      this.nextStep();
      return;
    }
    el.classList.remove('hidden');
    this.clearSpotlights();
    if (step.spotlight) {
      try {
        document.querySelectorAll(step.spotlight).forEach(node => node.classList.add('tut-spotlight'));
      } catch { /* ignore invalid selector */ }
    }
    const pct = Math.round(((this.stepIdx + 1) / TUTORIAL_STEPS.length) * 100);
    const html = `
      <div class="tut-head">
        <span class="tut-badge">${icon('bulb')} Guided Tutorial · ${this.stepIdx + 1}/${TUTORIAL_STEPS.length}</span>
        <b class="tut-title">${step.title}</b>
        <span class="tut-rew">${icon('sparkle')}${step.rewardText}</span>
        <button data-act="tut-close" class="mini" aria-label="Close tutorial">${icon('close')}</button>
      </div>
      <p class="tut-body"><em>${step.mentor}:</em> "${step.text}"</p>
      <div class="tut-foot">
        <div class="tut-prog"><i style="width:${pct}%"></i></div>
        <div class="tut-btns">
          <button data-act="tut-show" class="btn mini-btn">${icon('scout')}Show Me</button>
          <button data-act="tut-skip" class="btn mini-btn primary">${icon('play')}Skip Step</button>
        </div>
      </div>`;
    if (html !== this.lastHtml) {
      el.innerHTML = html;
      this.lastHtml = html;
    }
  }
}
