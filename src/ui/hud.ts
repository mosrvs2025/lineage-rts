import { BUILDINGS, BUILD_ORDER } from '../data/buildings';
import { DISCOVERIES, DISC_ORDER } from '../data/discoveries';
import { UNITS } from '../data/units';
import { SPECIES, SPECIES_ORDER, speciesUnitStats } from '../data/species';
import { MAPS, MAP_ORDER } from '../data/maps';
import { mapThumb } from './mapthumb';
import { TECHS, techsFor } from '../data/techs';
import {
  cmdBarter, cmdBless, cmdCancelSite, cmdGift, cmdHold, cmdInvestigate, cmdJob, cmdRally, cmdRepair, cmdRetreat, cmdScoutFlare, cmdStop, cmdTeach, cmdTrain, cmdWarcry, jobCounts, trainCheck,
} from '../sim/commands';
import { costMultiplier, discCost, discTime, investigateCheck, teachCheck } from '../sim/discovery';
import { objectiveList } from '../sim/objectives';
import { hasDisc, hasTech, popCap, popCount, rankOf, FIGHTERS } from '../sim/rules';
import { cancelResearch, cancelUpgrade, cmdResearch, cmdUpgrade, nextUpgrade, researchCheck, upgradeCheck } from '../sim/upgrades';
import { advanceGeneration, canSucceed, inheritancePreview, successorCandidates } from '../sim/succession';
import type { BuildingKind, DiscoveryId, Res, Species, UnitKind, World } from '../sim/types';
import { bCenter, compass, fmtTime, isWinter, nodeById, unitById } from '../sim/util';
import { OUTPOST_REQUIRE } from '../sim/world';
import { initAudio, isMuted, sfx } from './audio';
import { setSetting, settings } from './settings';
import type { Quality } from './settings';
import type { Game, SaveSlot } from './game';
import { icon } from './icons';
import { ResourceHistory } from './resource-summary';
import { Bubbles } from './bubbles';
import { Preview3D } from '../render/preview3d';
import type { PreviewPose } from '../render/preview3d';
import { CAMPAIGN_CHAPTERS, getCampaignChapter, loadCampaignProgress } from '../data/campaign';
import type { CampaignDifficulty } from '../data/campaign';
import { TutorialController } from './tutorial';
import { mp } from '../net/multiplayer';
import type { ChatChannel, MpMode } from '../net/multiplayer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const roman = (g: number) => ROMAN[g] ?? String(g);
type PanelId = 'build' | 'disc' | 'inspect' | null;
type Cost = Partial<Record<string, number>>;

const KIND_ICON: Record<string, string> = { gatherer: 'gatherer', scout: 'scout', hunter: 'hunter', guard: 'guard', raider: 'raider', leader: 'leader', elder: 'elder', slinger: 'slinger', brute: 'brute', champion: 'champion', stalker: 'stalker', deer: 'deer', wolf: 'wolf' };
const DISC_ICON: Record<DiscoveryId, string> = {
  cooking: 'food', preservation: 'rack', portable: 'discover', heat: 'build',
  pottery: 'pottery', farming: 'farming', boats: 'boats',
  kiln: 'kiln', irrigation: 'irrigation',
};

const CLAN_STATS: Record<Species, { label: string; v: number }[]> = {
  human: [
    { label: 'Foraging', v: 92 },
    { label: 'Cold Grit', v: 70 },
    { label: 'Might', v: 74 },
    { label: 'Scouting', v: 88 },
  ],
  neanderthal: [
    { label: 'Foraging', v: 72 },
    { label: 'Cold Grit', v: 96 },
    { label: 'Might', v: 95 },
    { label: 'Scouting', v: 68 },
  ],
  denisovan: [
    { label: 'Foraging', v: 88 },
    { label: 'Cold Grit', v: 84 },
    { label: 'Might', v: 80 },
    { label: 'Scouting', v: 96 },
  ],
};

const BANNER_COLORS = [
  { hex: '#27b7c6', name: 'Glacier Cyan' },
  { hex: '#e89a3c', name: 'Amber Ochre' },
  { hex: '#38d39c', name: 'Jade Moss' },
  { hex: '#d84e28', name: 'Cinnabar Red' },
  { hex: '#a864e8', name: 'Twilight Violet' },
  { hex: '#e8bd63', name: 'Sunburst Gold' },
];

const CHIEF_NAMES: Record<Species, string[]> = {
  human: ['Auren', 'Kaelen', 'Sora', 'Talon', 'Nira', 'Vael', 'Orin', 'Lyra'],
  neanderthal: ['Torag', 'Bruk', 'Krag', 'Ursa', 'Drom', 'Vorg', 'Grom', 'Skar'],
  denisovan: ['Zhur', 'Khul', 'Tayan', 'Altai', 'Sayan', 'Mergen', 'Nokh', 'Bayan'],
};

function chips(cost: Cost, w?: World): string {
  const parts = Object.entries(cost).filter(([, v]) => v);
  if (!parts.length) return '<span class="cc free">Free</span>';
  return parts.map(([k, v]) => `<span class="cc ${w && w.res[k as Res] < (v ?? 0) ? 'short' : ''}">${icon(k)}<b>${v}</b></span>`).join('');
}

interface BtnOpts { act: string; ic: string; label: string; key?: string; why?: string; on?: boolean; badge?: string; cost?: Cost; w?: World; tip?: { t: string; d: string; k?: string; cost?: Cost }; cls?: string; cd?: number }
const buildingTitle = (b: { kind: BuildingKind; tier: number }) => (b.tier > 0 ? BUILDINGS[b.kind].upgrades![b.tier - 1].name : BUILDINGS[b.kind].name);

function cbtn(o: BtnOpts): string {
  const tip = o.tip ? ` data-tip="${esc(JSON.stringify({ t: o.tip.t, d: o.tip.d, k: o.tip.k ?? o.key, c: o.tip.cost ?? o.cost }))}"` : '';
  return `<button class="cb ${['move', 'work', 'amove', 'build', 'stop', 'retreat', 'rally', 'bless', 'flare', 'warcry'].includes(o.act) ? 'quick' : ''} ${o.on ? 'on' : ''} ${o.why ? 'dis' : ''} ${o.cls ?? ''}" data-act="${o.act}" ${o.why ? `data-why="${esc(o.why)}"` : ''}${tip}>
    ${icon(o.ic)}<span class="cl">${o.label}</span>${o.key ? `<kbd>${o.key}</kbd>` : ''}${o.cost ? `<span class="cr">${chips(o.cost, o.w)}</span>` : ''}${o.badge ? `<i class="badge">${o.badge}</i>` : ''}${o.cd && o.cd > 0 ? `<i class="cdw" style="--cd:${Math.min(1, o.cd).toFixed(3)}"></i>` : ''}</button>`;
}

function portrait(species: Species) {
  const d = SPECIES[species];
  return `<div class="portrait-wrap" style="--band:${d.band}"><img src="portraits/${species}.png" alt="${esc(d.plural)}" class="portrait" loading="eager" draggable="false"/></div>`;
}

export class Hud {
  private panel: PanelId = null;
  private inspecting = 'food';
  private history = new ResourceHistory();
  private idleCursor = -1;
  private workMode = false;
  private lastChips = ''; private lastCmds = ''; private lastObj = ''; private lastPanel = ''; private lastJobs = ''; private lastSel = ''; private lastDock = ''; private lastClock = '';
  private lastLog = ''; private lastTick = 0; private jobsOpen = false; private objOpen: boolean | null = null;
  private springToast = false; private lastSpeed = 1;
  private pickedSuccessor = 0; private pickedSpecies: Species = 'human'; private pickedMap = 'valley';
  private previewUnit: UnitKind = 'leader'; private previewPose: PreviewPose = 'idle'; private previewGen = 1;
  private pickedBanner = '#27b7c6'; private pickedLeader = SPECIES.human.leader;
  private pickedChapter = 'ch1_embers'; private pickedDiff: CampaignDifficulty = 'standard';
  private mpModePick: MpMode = 'versus'; private mpMapPick = 'valley';
  private lastDrawerHtml = '';
  readonly preview3d = new Preview3D();
  readonly bub: Bubbles;
  readonly tutorial: TutorialController;
  private placeN = 0; private lastLaneH = -1;
  private prevRes: Record<string, number> = {}; private flash: Record<string, number> = {};

  constructor(private g: Game) {
    this.tutorial = new TutorialController(g);
    mp.bindCallbacks({
      onUpdate: () => {
        if (!$('modal').classList.contains('hidden') && document.getElementById('mp-lobby-root')) this.syncMpModal();
        if (mp.chatOpen) this.renderChatDrawer(true);
        this.lastDock = '';
      },
      onMatchStart: (room, peerSp) => {
        this.closeModal();
        if (typeof this.g.startMultiplayer === 'function') this.g.startMultiplayer(room, peerSp);
      },
      onToast: (t, k) => this.toast(t, k),
    });
    const app = $('app');
    app.addEventListener('pointerdown', () => initAudio(), { capture: true });
    app.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      if (t.dataset.why) { sfx.error(); this.toast(t.dataset.why, 'bad'); return; }
      sfx.click(); this.hideTip();
      this.act(t.dataset.act!);
    });
    app.addEventListener('keydown', (e) => {
      const t = e.target as HTMLInputElement;
      if (e.key === 'Enter' && (t?.id === 'mp-chat-input' || t?.id === 'drawer-chat-input')) {
        e.preventDefault();
        this.sendChatFromInput(t.id);
      }
      if (e.key === 'Enter' && t?.id === 'mp-room-code') {
        e.preventDefault();
        this.act('mp-join');
      }
    });
    if (window.matchMedia('(hover: hover)').matches) {
      app.addEventListener('mouseover', (e) => {
        const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip],[data-act]');
        if (t?.dataset.tip) this.showTip(t); else this.hideTip();
        if (t && (e.relatedTarget as HTMLElement | null)?.closest?.('[data-act]') !== t) sfx.hover();
      });
      app.addEventListener('mouseout', (e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('[data-tip]')) this.hideTip(); });
    }
    $('modal').addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.set === 'music' || t.dataset.set === 'sfx') { setSetting(t.dataset.set, Number(t.value) / 100); (t.nextElementSibling as HTMLElement).textContent = t.value; if (t.dataset.set === 'sfx') sfx.click(); }
      if (t.id === 'leader-name-input') { this.pickedLeader = t.value.trim() || SPECIES[this.pickedSpecies].leader; }
      if (t.id === 'mp-name-input') { mp.saveProfile(t.value); }
    });
    $<HTMLInputElement>('importfile').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const err = this.g.loadText(await f.text());
      (e.target as HTMLInputElement).value = '';
      if (err) this.toast(`Import failed: ${err}`, 'bad'); else { this.closeModal(); this.toast('Save imported.', 'good'); }
    });
    this.bub = new Bubbles(() => this.layout(), { notify: (m) => this.toast(m) });
    // HUD boxes never let a touch fall through to the map underneath
    for (const id of ['alertbtn', 'topbar', 'objectives', 'toasts', 'fab', 'bubble', 'jobs', 'panel', 'hud', 'dock', 'placebar', 'modal']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    // the first map touch while a transient window is open only dismisses it (it never also selects units)
    $('game').addEventListener('pointerdown', (e) => { if (this.dismissTransient()) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    this.renderTop();
    this.layout();
  }

  layout() {
    if (this.objOpen === null) this.objOpen = window.innerWidth >= 900 && window.innerHeight >= 560;
    const small = window.innerWidth < 900 || window.innerHeight < 560;
    if (this.bub?.phone) {
      const top = Math.ceil($('topbar').getBoundingClientRect().bottom);
      const card = $('bubble').classList.contains('hidden') ? 0 : $('bubble').getBoundingClientRect().height;
      this.g.cam.setInsets(top, Math.min(window.innerHeight * .55, $('dock').getBoundingClientRect().height + card + 8));
    } else this.g.cam.setInsets(small ? 44 : 60, small ? 120 : 196);
  }

  // ------------------------------------------------------------ tooltips & toasts
  private showTip(el: HTMLElement) {
    try {
      const d = JSON.parse(el.dataset.tip!) as { t: string; d: string; k?: string; c?: Cost };
      const tip = $('tip');
      tip.innerHTML = `<div class="th"><b>${esc(d.t)}</b>${d.k ? `<kbd>${esc(d.k)}</kbd>` : ''}</div><p>${esc(d.d)}</p>${d.c && Object.keys(d.c).length ? `<div class="tc">${chips(d.c, this.g.world ?? undefined)}</div>` : ''}`;
      tip.classList.remove('hidden');
      const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let x = r.left + r.width / 2 - tr.width / 2, y = r.top - tr.height - 10;
      if (y < 8) y = r.bottom + 10;
      if (r.right > window.innerWidth - 80 && r.top < window.innerHeight - 260) { x = r.left - tr.width - 10; y = r.top; }
      tip.style.left = `${Math.max(8, Math.min(window.innerWidth - tr.width - 8, x))}px`; tip.style.top = `${Math.max(8, y)}px`;
    } catch { /* malformed tip */ }
  }
  private hideTip() { $('tip').classList.add('hidden'); }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `${icon(kind === 'good' ? 'check' : kind === 'bad' ? 'warn' : 'info')}<span>${esc(text)}</span>`;
    const box = $('toasts'); box.appendChild(el);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => el.classList.add('out'), 4600);
    setTimeout(() => el.remove(), 5200);
  }
  private alertFlash() {
    const a = $('alert'); a.classList.remove('on'); void a.offsetWidth; a.classList.add('on');
  }

  /** Close fan menu, an unpinned Jobs window and any sheet; returns whether something was dismissed. */
  private dismissTransient(): boolean {
    if (this.g.menuOpen) return false;
    let closed = false;
    if ($('fab').classList.contains('open')) { this.bub.closeFab(); closed = true; }
    if (this.jobsOpen && !this.bub.jobsPinned) { this.closeJobs(); closed = true; }
    if (this.panel && this.g.mode !== 'place') { this.panel = null; this.renderPanel(true); closed = true; }
    return closed;
  }
  private closeJobs() { this.jobsOpen = false; this.lastJobs = ''; $('jobs').classList.add('hidden'); }

  panelOpen() { return this.panel !== null || this.jobsOpen; }
  closePanels() { this.panel = null; this.jobsOpen = false; this.renderPanel(true); this.lastJobs = ''; $('jobs').classList.add('hidden'); }
  togglePanel(p: Exclude<PanelId, null>) {
    this.jobsOpen = false; $('jobs').classList.add('hidden');
    this.panel = this.panel === p ? null : p;
    if (this.panel && this.g.mode === 'place') this.g.cancelPlace();
    this.renderPanel(true);
  }

  // ------------------------------------------------------------ actions
  act(a: string) {
    const g = this.g, w = g.world;
    const [cmd, arg] = a.split(':');
    switch (cmd) {
      case 'inspect':
        if (!w) break;
        this.bub.closeFab(); this.closeJobs(); this.inspecting = arg;
        this.panel = this.panel === 'inspect' && this.inspecting === $('panel').dataset.inspect ? null : 'inspect';
        $('panel').dataset.inspect = arg; this.renderPanel(true); break;
      case 'nextidle': {
        if (!w) break;
        this.closePanels();
        const idle = w.units.filter(u => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'idle');
        if (!idle.length) { this.toast('Everyone is working.'); break; }
        const index = idle.findIndex(u => u.id === this.idleCursor);
        const next = idle[(index + 1) % idle.length]; this.idleCursor = next.id;
        g.selectUnits([next.id]); g.cam.centerOn(next.x, next.y); break;
      }
      case 'work': this.closePanels(); this.workMode = true; g.mode = 'move'; this.toast('Tap a resource to gather, or a construction site to build.'); break;
      case 'pause': if (g.speed === 0) g.speed = this.lastSpeed || 1; else { this.lastSpeed = g.speed; g.speed = 0; } break;
      case 'speed': g.speed = g.speed === 0 ? 1 : g.speed >= 3 ? 1 : g.speed + 1; this.lastSpeed = g.speed; break;
      case 'sound': setSetting('muted', !settings.muted); this.renderTop(); break;
      case 'menu': this.openMenu(); break;
      case 'build': this.bub.closeFab(); this.togglePanel('build'); break;
      case 'disc': this.bub.closeFab(); this.togglePanel('disc'); break;
      case 'closepanel': this.closePanels(); break;
      case 'jobs': this.bub.closeFab(); this.panel = null; this.renderPanel(true); this.jobsOpen = !this.jobsOpen; this.lastJobs = ''; $('jobs').classList.toggle('hidden', !this.jobsOpen); this.bub.place(); break;
      case 'closejobs': this.closeJobs(); break;
      case 'desel': g.clearSelection(); break;
      case 'setrally': g.mode = g.mode === 'rally' ? 'normal' : 'rally'; if (g.mode === 'rally') this.toast('Tap where new recruits should gather.'); break;
      case 'gotoalert': { const a = w?.alert; if (a) { g.cam.centerOn(a.x, a.y); g.ping(a.x, a.y, 'rgba(255,90,70,.95)'); } else this.toast('No recent attacks.'); break; }
      case 'objtoggle': this.objOpen = !this.objOpen; this.lastObj = ''; break;
      case 'objrestore': this.closePanels(); this.objOpen = true; this.lastObj = ''; break;
      case 'placeb': g.startPlace(arg as BuildingKind); break;
      case 'place-ok': { const err = g.confirmPlace(); if (err) { sfx.error(); this.toast(err, 'bad'); } else { sfx.place(); this.toast('Construction started.', 'good'); } break; }
      case 'place-cancel': g.cancelPlace(); break;
      case 'move': this.closePanels(); this.workMode = false; g.mode = g.mode === 'move' ? 'normal' : 'move'; break;
      case 'amove': this.closePanels(); g.mode = g.mode === 'amove' ? 'normal' : 'amove'; break;
      case 'patrol': this.closePanels(); g.mode = g.mode === 'patrol' ? 'normal' : 'patrol'; break;
      case 'queue': g.queueMode = !g.queueMode; this.toast(g.queueMode ? 'Queue on: new orders wait their turn.' : 'Queue off.'); break;
      case 'hold': if (w) cmdHold(w, g.sel); break;
      case 'stop': if (w) cmdStop(w, g.sel); break;
      case 'retreat': if (w) cmdRetreat(w, g.sel); break;
      case 'rally': if (w && g.sel.length) { const l = g.sel.map((i) => w._u?.get(i)).find((u) => u?.kind === 'leader'); if (l) { const r = cmdRally(w, l.id); if (!r.ok) this.toast(r.reason, 'bad'); } } break;
      case 'bless': if (w && g.sel.length) { const el = g.sel.map((i) => w._u?.get(i)).find((u) => u?.kind === 'elder'); if (el) { const r = cmdBless(w, el.id); if (!r.ok) this.toast(r.reason, 'bad'); else sfx.good(); } } break;
      case 'flare': if (w && g.sel.length) { const sc = g.sel.map((i) => w._u?.get(i)).find((u) => u?.kind === 'scout' || u?.kind === 'stalker'); if (sc) { const r = cmdScoutFlare(w, sc.id); if (!r.ok) this.toast(r.reason, 'bad'); else sfx.good(); } } break;
      case 'warcry': if (w && g.sel.length) { const ch = g.sel.map((i) => w._u?.get(i)).find((u) => u?.kind === 'champion' || u?.kind === 'brute'); if (ch) { const r = cmdWarcry(w, ch.id); if (!r.ok) this.toast(r.reason, 'bad'); else sfx.good(); } } break;
      case 'repair': if (w && g.selB !== null) { const r = cmdRepair(w, g.selB); if (!r.ok) this.toast(r.reason, 'bad'); else sfx.click(); } break;
      case 'barter': if (w) { const r = cmdBarter(w, arg as 'wood2food' | 'food2wood' | 'stone2know'); if (!r.ok) { sfx.error(); this.toast(r.reason, 'bad'); } else sfx.good(); } break;
      case 'dragsel': g.selectMode = !g.selectMode; this.toast(g.selectMode ? 'Drag-select ON: drag on the map to box-select.' : 'Drag-select OFF: drag pans the map.'); break;
      case 'home': { const h = w?.buildings.find((b) => b.owner === 0 && b.kind === 'hearth'); if (h) { const c = bCenter(h); g.cam.centerOn(c.x, c.y); } break; }
      case 'idle': {
        if (!w) break;
        const idle = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'idle');
        if (!idle.length) { this.toast('No idle gatherers.'); break; }
        g.selectUnits(idle.map((u) => u.id)); g.cam.centerOn(idle[0].x, idle[0].y); break;
      }
      case 'army': {
        if (!w) break;
        const army = w.units.filter((u) => u.owner === 0 && ['scout', ...FIGHTERS].includes(u.kind));
        if (!army.length) { this.toast('No scouts or fighters yet.'); break; }
        g.selectUnits(army.map((u) => u.id)); break;
      }
      case 'selkind': if (w) g.selectUnits(g.sel.filter((id) => w._u?.get(id)?.kind === arg)); break;
      case 'train': {
        if (!w || g.selB === null) break;
        const r = cmdTrain(w, g.selB, arg as UnitKind); if (!r.ok) { sfx.error(); this.toast(r.reason, 'bad'); } break;
      }
      case 'upgrade': { if (!w || g.selB === null) break; const r = cmdUpgrade(w, g.selB); if (!r.ok) { sfx.error(); this.toast(r.reason, 'bad'); } else { sfx.place(); this.toast('Upgrade begun.', 'good'); } break; }
      case 'cancelupg': if (w && g.selB !== null) { cancelUpgrade(w, g.selB); this.toast('Upgrade cancelled (75% refunded).'); } break;
      case 'research': { if (!w || g.selB === null) break; const r = cmdResearch(w, g.selB, arg); if (!r.ok) { sfx.error(); this.toast(r.reason, 'bad'); } else this.toast(`Researching ${TECHS[arg].name}.`, 'good'); break; }
      case 'cancelres': if (w && g.selB !== null) { cancelResearch(w, g.selB); this.toast('Research cancelled (75% refunded).'); } break;
      case 'cancelsite': if (w && g.selB !== null) { cmdCancelSite(w, g.selB); g.clearSelection(); this.toast('Construction cancelled (75% refunded).'); } break;
      case 'gift': { if (!w) break; const r = cmdGift(w); if (!r.ok) { sfx.error(); this.toast(r.reason, 'bad'); } break; }
      case 'inv': { if (!w) break; const r = cmdInvestigate(w, arg as DiscoveryId); if (!r.ok) this.toast(r.reason, 'bad'); else this.toast('A gatherer begins investigating.', 'good'); break; }
      case 'teach': { if (!w) break; const r = cmdTeach(w, arg as DiscoveryId); if (!r.ok) this.toast(r.reason, 'bad'); else this.toast('An apprentice begins to learn.', 'good'); break; }
      case 'job': { if (!w) break; const r = cmdJob(w, arg as Res); if (!r.ok) this.toast(r.reason, 'bad'); break; }
      // ---- tutorial
      case 'tut-start':
        this.closeModal();
        if (typeof g.startTutorial === 'function') g.startTutorial();
        else this.tutorial.start(true);
        return;
      case 'tut-guide':
        this.closeModal();
        this.tutorial.start(true);
        return;
      case 'tut-show': this.tutorial.showMeCurrent(); return;
      case 'tut-skip': this.tutorial.nextStep(); return;
      case 'tut-close': this.tutorial.stop(true); return;
      // ---- campaign
      case 'campaign': this.openCampaign(); return;
      case 'camp-ch': this.pickedChapter = arg; this.openCampaign(); return;
      case 'camp-diff': this.pickedDiff = arg as CampaignDifficulty; this.openCampaign(); return;
      case 'camp-launch': {
        this.closeModal();
        if (typeof g.startCampaign === 'function') g.startCampaign(this.pickedChapter, this.pickedDiff);
        return;
      }
      case 'camp-next': {
        const curIdx = CAMPAIGN_CHAPTERS.findIndex((c) => c.id === w?.campaignId);
        const nextCh = CAMPAIGN_CHAPTERS[curIdx + 1] ?? CAMPAIGN_CHAPTERS[0];
        this.pickedChapter = nextCh.id;
        this.closeModal();
        if (typeof g.startCampaign === 'function') g.startCampaign(nextCh.id, (w?.campaignDiff as CampaignDifficulty) ?? this.pickedDiff);
        return;
      }
      // ---- multiplayer & chat rooms
      case 'multiplayer': this.openMultiplayer(); return;
      case 'mp-chan': mp.channel = arg as ChatChannel; mp.unread = 0; this.openMultiplayer(); return;
      case 'mp-sp': mp.saveProfile(undefined, arg as Species); this.openMultiplayer(); return;
      case 'mp-mode': this.mpModePick = arg as MpMode; this.openMultiplayer(); return;
      case 'mp-map': this.mpMapPick = arg; this.openMultiplayer(); return;
      case 'mp-send': this.sendChatFromInput('mp-chat-input'); return;
      case 'drawer-send': this.sendChatFromInput('drawer-chat-input'); return;
      case 'mp-quick': mp.sendChat(arg, mp.activeRoom ? 'room' : mp.channel); if (mp.chatOpen) this.renderChatDrawer(true); return;
      case 'mp-create': mp.createRoom(this.mpModePick, this.mpMapPick); this.openMultiplayer(); return;
      case 'mp-join': {
        const inp = document.getElementById('mp-room-code') as HTMLInputElement | null;
        const code = arg || inp?.value || '';
        if (!mp.joinRoom(code)) this.toast('Enter a 4–6 character Room Code.', 'bad');
        else this.openMultiplayer();
        return;
      }
      case 'mp-copy': {
        if (mp.activeRoom) {
          const url = `${window.location.origin}${window.location.pathname}?room=${mp.activeRoom.code}`;
          try { navigator.clipboard?.writeText(url); } catch { /* ignore */ }
          this.toast(`Copied Room Link (${mp.activeRoom.code}) to clipboard!`, 'good');
        }
        return;
      }
      case 'mp-leave': mp.leaveRoom(); this.openMultiplayer(); return;
      case 'mp-launch': mp.launchRoomMatch(); return;
      case 'mp-act': {
        if (!w) return;
        const [, subAct, subRes] = a.split(':');
        const res = mp.sendGameAction(w, subAct as 'tribute' | 'reinforce' | 'strike', subRes as Res | undefined);
        if (!res.ok) { sfx.error(); this.toast(res.reason, 'bad'); } else { sfx.good(); this.renderChatDrawer(true); }
        break;
      }
      case 'chatdrawer':
        mp.chatOpen = !mp.chatOpen;
        if (mp.chatOpen) mp.unread = 0;
        this.lastDock = '';
        this.renderChatDrawer(true);
        return;
      case 'chatdrawer-close':
        mp.chatOpen = false;
        this.lastDock = '';
        this.renderChatDrawer(true);
        return;
      // ---- menus
      case 'settings': this.openSettings(); return;
      case 'quality': setSetting('quality', arg as Quality); this.openSettings(); return;
      case 'toggle': setSetting(arg as 'edgePan' | 'muted' | 'hints' | 'voices' | 'bars', !settings[arg as 'edgePan' | 'muted' | 'hints' | 'voices' | 'bars']); this.openSettings(); this.renderTop(); return;
      case 'play': this.openClan(); return;
      case 'species': {
        this.pickedSpecies = arg as Species;
        this.pickedLeader = SPECIES[this.pickedSpecies].leader;
        const uDef = UNITS[this.previewUnit];
        if (uDef.only && uDef.only !== this.pickedSpecies) {
          this.previewUnit = this.pickedSpecies === 'human' ? 'slinger' : this.pickedSpecies === 'neanderthal' ? 'brute' : 'stalker';
        }
        this.openClan(); return;
      }
      case 'punit': this.previewUnit = arg as UnitKind; this.openClan(); return;
      case 'ppose': this.previewPose = arg as PreviewPose; this.openClan(); return;
      case 'pgen': this.previewGen = Number(arg); this.openClan(); return;
      case 'banner': this.pickedBanner = arg; this.openClan(); return;
      case 'randname': {
        const pool = CHIEF_NAMES[this.pickedSpecies].filter((n) => n !== this.pickedLeader);
        this.pickedLeader = pool[Math.floor(Math.random() * pool.length)] ?? SPECIES[this.pickedSpecies].leader;
        this.openClan(); return;
      }
      case 'map': this.pickedMap = arg; this.openClan(); return;
      case 'start': {
        const inp = document.getElementById('leader-name-input') as HTMLInputElement | null;
        if (inp && inp.value.trim()) this.pickedLeader = inp.value.trim();
        this.closeModal();
        g.startNew(this.pickedSpecies, this.pickedMap, { leaderName: this.pickedLeader, bannerColor: this.pickedBanner });
        return;
      }
      case 'continue': { const err = g.load(arg as SaveSlot); if (err) this.toast(err, 'bad'); else this.closeModal(); return; }
      case 'resume': this.closeModal(); break;
      case 'save': { const ok = g.save('manual'); this.toast(ok ? 'Game saved.' : 'Could not save (browser storage unavailable).', ok ? 'good' : 'bad'); this.openMenu(); return; }
      case 'export': g.exportSave(); break;
      case 'import': $('importfile').click(); break;
      case 'restartask': this.openModal(`<div class="dialog small"><h2>${icon('restart')}Restart scenario?</h2><p>Your current progress will be lost. Saved games are kept.</p><div class="row"><button data-act="restart" class="btn primary">Restart</button><button data-act="menu" class="btn">Back</button></div></div>`); return;
      case 'restart': this.closeModal(); g.restart(); return;
      case 'title': g.startShowcase(); this.openStart(); return;
      case 'help': this.openHelp(); return;
      case 'succession': this.openSuccession(); return;
      case 'pick': this.pickedSuccessor = Number(arg); this.openSuccession(); return;
      case 'succeed': {
        if (w && advanceGeneration(w, this.pickedSuccessor)) { this.closeModal(); g.clearSelection(); sfx.good(); this.toast(`Generation ${roman(w.gen)} begins.`, 'good'); }
        break;
      }
      case 'endless': {
        if (!w) break;
        w.endless = true;
        w.status = 'playing';
        if (w.gen < 3 && w.time < w.winter.end) w.winter.end = w.time;
        this.closeModal();
        if (canSucceed(w)) this.openSuccession();
        else this.toast('Your lineage continues toward mastery.', 'good');
        return;
      }
    }
    this.refresh(true);
  }

  private sendChatFromInput(inputId: string) {
    const inp = document.getElementById(inputId) as HTMLInputElement | null;
    if (!inp || !inp.value.trim()) return;
    const ch: ChatChannel = inputId === 'drawer-chat-input' && mp.activeRoom ? 'room' : mp.channel;
    mp.sendChat(inp.value, ch);
    inp.value = '';
    if (inputId === 'mp-chat-input') this.syncMpModal();
    else this.renderChatDrawer(true);
  }

  // ------------------------------------------------------------ modals & screens
  private openModal(html: string, kind = '') {
    const m = $('modal'); m.className = kind; m.innerHTML = html;
    this.g.menuOpen = true; this.hideTip();
  }
  closeModal() { const m = $('modal'); m.classList.add('hidden'); m.innerHTML = ''; this.g.menuOpen = !this.g.world || this.g.showcase; this.refresh(true); }

  openStart() {
    const g = this.g;
    const slot = (s: SaveSlot, label: string) => { const i = g.slotInfo(s); return i.ok ? `<button data-act="continue:${s}" class="tbtn">${icon('load')}<span>${label}<small>${esc(i.text)}</small></span></button>` : ''; };
    const prog = loadCampaignProgress();
    const doneChapters = Object.values(prog).filter(p => p.completed).length;
    this.openModal(`
      <div class="title">
        <div class="logo"><div class="mark">${icon('fire')}</div><h1>LINEAGE</h1><div class="rule"></div><p class="sub">AN EVOLUTION RTS</p></div>
        <div class="tmenu">
          <button data-act="campaign" class="tbtn primary">${icon('campaign')}<span>Story Campaign<small>Chronicles of the Three Fires (${doneChapters}/${CAMPAIGN_CHAPTERS.length})</small></span></button>
          <button data-act="play" class="tbtn">${icon('play')}<span>Custom Skirmish<small>Choose Clan, 3D Hero &amp; Land</small></span></button>
          <button data-act="multiplayer" class="tbtn">${icon('globe')}<span>Online &amp; Chat Rooms<small>1v1 Versus · 2P Co-op · Live Lobby</small></span></button>
          <button data-act="tut-start" class="tbtn">${icon('bulb')}<span>Interactive Tutorial<small>Guided Path of the First Fire</small></span></button>
          ${slot('auto', 'Continue')}${slot('manual', 'Load Game')}
          <button data-act="settings" class="tbtn">${icon('sparkle')}<span>Settings</span></button>
          <button data-act="help" class="tbtn">${icon('help')}<span>How to Play</span></button>
        </div>
        <p class="tag">Ancestors discover. Descendants find new uses.</p>
      </div>`, 'titlescreen');
  }

  private clanStageMeta() {
    const sp = this.pickedSpecies, rv = SPECIES[sp].rival;
    const uniqKind: UnitKind = sp === 'human' ? 'slinger' : sp === 'neanderthal' ? 'brute' : 'stalker';
    const roster: UnitKind[] = ['leader', uniqKind, 'gatherer', 'hunter', 'guard', 'elder', 'champion'];
    const uDef = UNITS[this.previewUnit];
    const st = speciesUnitStats(sp, this.previewUnit, this.previewGen);
    const fmtDelta = (pct: number) => pct === 0 ? '' : ` <em class="gen-boost ${pct < 0 ? 'neg' : ''}">${pct > 0 ? '+' : ''}${pct}%</em>`;
    const hpBadge = fmtDelta(st.hpBonusPct);
    const dmgBadge = fmtDelta(st.dmgBonusPct);
    const spdBadge = fmtDelta(st.speedBonusPct);
    const visBadge = st.visionBonus > 0 ? ` <em class="gen-boost">+${st.visionBonus}</em>` : '';
    const genInfo = this.previewGen === 1
      ? { era: 'Era I · Stone & Hide (The First Winter)', desc: `${SPECIES[sp].archetype} — Primal hide attire, flint & timber weapons, and foundational hearth fire.` }
      : this.previewGen === 2
      ? { era: 'Era II · Bone, Ochre & Portable Fire (+15% Might)', desc: `${SPECIES[sp].archetype} — Mammoth-tusk bone pauldrons, predator-fang gorget, portable fire torch & clay vessels.` }
      : { era: 'Era III · Sun-Bronze & High-Kiln Mastery (+30% Might)', desc: `${SPECIES[sp].archetype} — Gilded sun-bronze armor, twin ancestral clan war-banners, sun-disc medallion & temple braziers.` };
    return { sp, rv, uniqKind, roster, uDef, st, hpBadge, dmgBadge, spdBadge, visBadge, genInfo };
  }

  /** Smoothly update Clan & Character Showcase UI in-place without destroying the 3D WebGL canvas or flashing the modal. */
  private syncClanDOM(): boolean {
    const modal = $('modal');
    if (modal.classList.contains('hidden') || !document.getElementById('clan-stage-canvas')) return false;
    const { sp, rv, roster, uDef, st, hpBadge, dmgBadge, spdBadge, visBadge, genInfo } = this.clanStageMeta();

    const sub = modal.querySelector<HTMLElement>('.clan > .sub');
    if (sub) sub.textContent = `Your rival will be the ${SPECIES[rv].plural}. Sculpted 3D characters, asymmetric clan stats, and ancestral regalia.`;

    // Update clan cards active state & Chosen badge in-place
    for (const s of SPECIES_ORDER) {
      const btn = modal.querySelector<HTMLElement>(`.clancard[data-act="species:${s}"]`);
      if (!btn) continue;
      const on = s === sp;
      btn.classList.toggle('on', on);
      const badge = btn.querySelector('.chosen');
      if (on && !badge) {
        const span = document.createElement('span');
        span.className = 'chosen';
        span.innerHTML = `${icon('check')} Chosen`;
        btn.appendChild(span);
      } else if (!on && badge) {
        badge.remove();
      }
    }

    // Update stage header & Generation pills
    const kicker = document.getElementById('stage-kicker');
    if (kicker) kicker.textContent = `${SPECIES[sp].name} · ${SPECIES[sp].archetype} · Gen ${roman(this.previewGen)}`;
    const title = document.getElementById('stage-unit-title');
    if (title) title.innerHTML = `${uDef.name}${uDef.only ? ' <i class="uniq-pill">Clan Exclusive</i>' : ''}`;
    for (const g of [1, 2, 3]) {
      modal.querySelector<HTMLElement>(`.gpill[data-act="pgen:${g}"]`)?.classList.toggle('on', this.previewGen === g);
    }

    // Update pose pills
    for (const p of ['idle', 'walk', 'attack', 'work'] as PreviewPose[]) {
      modal.querySelector<HTMLElement>(`.ppill[data-act="ppose:${p}"]`)?.classList.toggle('on', this.previewPose === p);
    }

    // Update unit tabs (including Clan Exclusive unit when species changes)
    const tabsEl = document.getElementById('stage-unit-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = roster
        .map((k) => `<button data-act="punit:${k}" class="utab ${this.previewUnit === k ? 'on' : ''} ${UNITS[k].only ? 'uniq' : ''}" title="${esc(UNITS[k].name)}">${icon(KIND_ICON[k])}<span>${UNITS[k].name.split(' ').pop()}</span></button>`)
        .join('');
    }

    // Update Generation Era banner & Unit Stat readout
    const genBanner = document.getElementById('stage-gen-banner');
    if (genBanner) {
      genBanner.className = `gen-banner g-${this.previewGen}`;
      genBanner.innerHTML = `${icon(this.previewGen >= 3 ? 'kiln' : this.previewGen === 2 ? 'pottery' : 'fire')}<div><b>${esc(genInfo.era)}</b><small>${esc(genInfo.desc)}</small></div>`;
    }
    const unitInfo = document.getElementById('stage-unit-info');
    if (unitInfo) {
      unitInfo.innerHTML = `<div class="u-stats">
        <span>${icon('heart')}<b>${st.hp}</b> HP${hpBadge}</span>
        <span>${icon('attack')}<b>${st.dmg}</b> DMG${dmgBadge}</span>
        <span>${icon('move')}<b>${st.speed.toFixed(1)}</b> SPD${spdBadge}</span>
        <span>${icon('scout')}<b>${st.vision}</b> VIS${visBadge}</span>
      </div>
      <p>${esc(uDef.desc)}</p>`;
    }

    // Update Founder Leader input & War-paint swatches
    const inp = document.getElementById('leader-name-input') as HTMLInputElement | null;
    if (inp && document.activeElement !== inp) inp.value = this.pickedLeader;
    for (const c of BANNER_COLORS) {
      modal.querySelector<HTMLElement>(`.swatch[data-act="banner:${c.hex}"]`)?.classList.toggle('on', this.pickedBanner === c.hex);
    }

    // Update Map cards
    for (const id of MAP_ORDER) {
      modal.querySelector<HTMLElement>(`.mapcard[data-act="map:${id}"]`)?.classList.toggle('on', this.pickedMap === id);
    }
    return true;
  }

  openClan() {
    if (this.syncClanDOM()) return;
    const { sp, rv, roster, uDef, st, hpBadge, dmgBadge, spdBadge, visBadge, genInfo } = this.clanStageMeta();
    const mp = this.pickedMap;

    const card = (s: Species) => {
      const d = SPECIES[s], bars = CLAN_STATS[s];
      return `
      <button data-act="species:${s}" class="clancard ${sp === s ? 'on' : ''}">
        ${portrait(s)}
        <h3>${d.plural}</h3>
        <p class="ctag">${d.tag}</p>
        <div class="stat-bars">${bars.map((b) => `<div class="sbar"><span>${b.label}</span><div class="strack"><i style="width:${b.v}%;background:${d.band}"></i></div></div>`).join('')}</div>
        <ul>${d.perks.map((p) => `<li>${icon('check')}${p}</li>`).join('')}</ul>
        ${sp === s ? `<span class="chosen">${icon('check')} Chosen</span>` : ''}
      </button>`;
    };
    const mcard = (id: string) => { const m = MAPS[id]; return `
      <button data-act="map:${id}" class="mapcard b-${m.biome} ${mp === id ? 'on' : ''}">
        <span class="mthumb">${mapThumb(id)}</span><b>${m.name}</b><span class="mdiff d-${m.difficulty.toLowerCase()}">${m.difficulty}</span><small>${m.desc}</small><ul class="mfeat">${m.features.map((f) => `<li>${f}</li>`).join('')}</ul>
      </button>`; };
    this.openModal(`
      <div class="clan">
        <h2>Choose Your Lineage &amp; Hero</h2><p class="sub">Your rival will be the ${SPECIES[rv].plural}. Sculpted 3D characters, asymmetric clan stats, and ancestral regalia.</p>
        <div class="clan-top-grid">
          <div class="clancards three">${SPECIES_ORDER.map(card).join('')}</div>
          <div class="stage-card">
            <div class="stage-hdr">
              <div>
                <span id="stage-kicker" class="stage-kicker">${SPECIES[sp].name} · ${SPECIES[sp].archetype} · Gen ${roman(this.previewGen)}</span>
                <h3 id="stage-unit-title">${uDef.name}${uDef.only ? ' <i class="uniq-pill">Clan Exclusive</i>' : ''}</h3>
              </div>
              <div class="gen-pills" title="Preview Generation Regalia">
                ${[1, 2, 3].map((g) => `<button data-act="pgen:${g}" class="gpill ${this.previewGen === g ? 'on' : ''}">Gen ${roman(g)}</button>`).join('')}
              </div>
            </div>
            <div class="stage-viewport">
              <canvas id="clan-stage-canvas" width="380" height="320"></canvas>
              <span class="drag-hint">${icon('move')} Drag to rotate 3D model</span>
              <div class="pose-bar">
                ${(['idle', 'walk', 'attack', 'work'] as PreviewPose[]).map((p) => `<button data-act="ppose:${p}" class="ppill ${this.previewPose === p ? 'on' : ''}">${p}</button>`).join('')}
              </div>
            </div>
            <div id="stage-gen-banner" class="gen-banner g-${this.previewGen}">
              ${icon(this.previewGen >= 3 ? 'kiln' : this.previewGen === 2 ? 'pottery' : 'fire')}
              <div><b>${esc(genInfo.era)}</b><small>${esc(genInfo.desc)}</small></div>
            </div>
            <div id="stage-unit-tabs" class="unit-tabs">
              ${roster.map((k) => `<button data-act="punit:${k}" class="utab ${this.previewUnit === k ? 'on' : ''} ${UNITS[k].only ? 'uniq' : ''}" title="${esc(UNITS[k].name)}">${icon(KIND_ICON[k])}<span>${UNITS[k].name.split(' ').pop()}</span></button>`) .join('')}
            </div>
            <div id="stage-unit-info" class="stage-unit-info">
              <div class="u-stats">
                <span>${icon('heart')}<b>${st.hp}</b> HP${hpBadge}</span>
                <span>${icon('attack')}<b>${st.dmg}</b> DMG${dmgBadge}</span>
                <span>${icon('move')}<b>${st.speed.toFixed(1)}</b> SPD${spdBadge}</span>
                <span>${icon('scout')}<b>${st.vision}</b> VIS${visBadge}</span>
              </div>
              <p>${esc(uDef.desc)}</p>
            </div>
            <div class="custom-bar">
              <div class="cfield">
                <label for="leader-name-input">${icon('leader')}Founder</label>
                <div class="leader-input-row">
                  <input id="leader-name-input" type="text" maxlength="18" value="${esc(this.pickedLeader)}" placeholder="Leader name"/>
                  <button data-act="randname" class="mini" title="Randomize chieftain name">${icon('sparkle')}</button>
                </div>
              </div>
              <div class="cfield">
                <label>War-Paint</label>
                <div class="swatches">
                  ${BANNER_COLORS.map((c) => `<button data-act="banner:${c.hex}" class="swatch ${this.pickedBanner === c.hex ? 'on' : ''}" style="--sw:${c.hex}" title="${c.name}" aria-label="${c.name}"></button>`).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
        <h2 class="h2b">Choose Your Land</h2>
        <div class="mapcards">${MAP_ORDER.map(mcard).join('')}</div>
        <div class="row"><button data-act="title" class="btn">${icon('door')}Back</button><button data-act="start" class="btn primary big">${icon('play')}Begin</button></div>
      </div>`, 'titlescreen clanscreen');
  }

  openCampaign() {
    this.preview3d.unmountStage();
    const prog = loadCampaignProgress();
    const ch = getCampaignChapter(this.pickedChapter) ?? CAMPAIGN_CHAPTERS[0];
    this.pickedChapter = ch.id;
    const totalStars = Object.values(prog).reduce((a, b) => a + b.stars, 0);
    const maxStars = CAMPAIGN_CHAPTERS.length * 3;
    const sp = SPECIES[ch.species];
    const m = MAPS[ch.mapId];
    const spIcon = (s: Species) => (s === 'human' ? 'slinger' : s === 'neanderthal' ? 'brute' : 'stalker');
    const starsHtml = (n: number) => `<span class="camp-stars" aria-label="${n} of 3 stars">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;
    const card = (c: typeof ch) => {
      const done = prog[c.id];
      const on = c.id === ch.id;
      return `<button data-act="camp-ch:${c.id}" class="camp-card ${on ? 'on' : ''} ${done ? 'done' : ''}" style="--accent:${c.bannerColor}">
        <div class="camp-act">Act ${roman(c.act)} · Ch. ${c.chapterNum}</div>
        <div class="camp-head"><b>${esc(c.title)}</b>${starsHtml(done?.stars ?? 0)}</div>
        <small>${esc(c.subtitle)}</small>
        <div class="camp-tags">
          <span class="pill">${icon(spIcon(c.species))}${SPECIES[c.species].name}</span>
          <span class="pill">${esc(c.actName)}</span>
          ${done ? `<span class="pill ok">${icon('check')}${fmtTime(done.bestTime)}</span>` : ''}
        </div>
      </button>`;
    };
    const diffBtn = (d: CampaignDifficulty, label: string, sub: string) =>
      `<button data-act="camp-diff:${d}" class="btn ${this.pickedDiff === d ? 'primary' : ''}"><b>${label}</b><small>${sub}</small></button>`;
    this.openModal(`
      <div class="dialog camp-modal">
        <div class="camp-top">
          <div>
            <div class="kicker">STORY CAMPAIGN · CHRONICLES OF THE THREE FIRES</div>
            <h2>${icon('campaign')}The Ancestral Saga</h2>
          </div>
          <div class="camp-score">${icon('trophy')}<b>${totalStars} / ${maxStars} ★</b><small>Campaign Mastery</small></div>
        </div>
        <div class="camp-layout">
          <div class="camp-list">${CAMPAIGN_CHAPTERS.map(card).join('')}</div>
          <div class="camp-detail" style="--accent:${ch.bannerColor}">
            <div class="camp-kicker">Act ${roman(ch.act)}: ${esc(ch.actName)} · Chapter ${ch.chapterNum}</div>
            <h3>${esc(ch.title)}</h3>
            <p class="camp-lore">“${esc(ch.subtitle)}”</p>
            <p class="camp-brief">${esc(ch.lore)}</p>
            <div class="camp-meta">
              <div><small>PROTAGONIST</small><b>${icon('leader')}${esc(ch.leaderName)} (${sp.name})</b></div>
              <div><small>TERRITORY</small><b>${icon('map')}${esc(m.name)}</b></div>
              <div><small>RIVAL CLAN</small><b>${icon('swords')}${esc(SPECIES[ch.rivalSpecies].plural)}</b></div>
            </div>
            <div class="camp-objs">
              <h4>${icon('trophy')}Chapter Objectives</h4>
              <ul>${ch.objectives.map((o) => `<li>${icon('check')}<span>${esc(o.text)}</span></li>`).join('')}</ul>
            </div>
            <div class="camp-diffs">
              <label>Difficulty</label>
              <div class="diff-row">
                ${diffBtn('story', 'Story', '+35% start stores · Forgiving rivals')}
                ${diffBtn('standard', 'Standard', 'Balanced RTS challenge')}
                ${diffBtn('ancestral', 'Ancestral', 'Fierce rival warbands')}
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <button data-act="title" class="btn">${icon('door')}Back</button>
          <button data-act="tut-guide" class="btn">${icon('bulb')}Play Tutorial First</button>
          <button data-act="camp-launch" class="btn primary big">${icon('play')}Launch Chapter ${ch.chapterNum}</button>
        </div>
      </div>`, 'titlescreen camp-screen');
  }

  openMultiplayer() {
    this.preview3d.unmountStage();
    const ch = mp.channel;
    const msgs = mp.messages.filter((m) => m.channel === ch);
    const peers = Array.from(mp.peers.values());
    const rooms = Array.from(mp.rooms.values());
    const curRoom = mp.activeRoom;
    const spIcon = (s: Species) => (s === 'human' ? 'slinger' : s === 'neanderthal' ? 'brute' : 'stalker');
    const statusCls = mp.cloudConnected ? 'live' : 'local';
    const statusTxt = mp.cloudConnected
      ? `Cloud Relay Live (${peers.length + 1} clans online)`
      : `Valley Relay Ready (${peers.length + 1} clans in valley)`;
    const tab = (id: ChatChannel, label: string, sub: string) =>
      `<button data-act="mp-chan:${id}" class="mp-tab ${ch === id ? 'on' : ''}"><b>#${label}</b><small>${sub}</small></button>`;
    const msgHtml = msgs.map((m) => `
      <div class="cmsg ${m.system ? 'sys' : ''}">
        <span class="cbadge" style="--sw:${esc(m.banner)}">${icon(spIcon(m.species))}</span>
        <div class="cbody">
          <div class="chead"><b style="color:${esc(m.banner)}">${esc(m.senderName)}</b><small>${SPECIES[m.species].name} · ${new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>
          <p>${esc(m.text)}</p>
        </div>
      </div>`).join('');

    this.openModal(`
      <div id="mp-lobby-root" class="dialog mp-modal">
        <div class="mp-header">
          <div>
            <div class="kicker">GLOBAL HEARTH NETWORK · MULTIPLAYER &amp; CHAT ROOMS</div>
            <h2>${icon('globe')}Online Lobby &amp; Council Chambers</h2>
          </div>
          <div class="mp-status ${statusCls}"><i></i><span>${esc(statusTxt)}</span></div>
        </div>
        <div class="mp-profile-bar">
          <label>${icon('leader')}Your Callsign</label>
          <input id="mp-name-input" type="text" maxlength="18" value="${esc(mp.myName)}" placeholder="Chieftain name"/>
          <div class="mp-sp-picks">
            ${(['human', 'neanderthal', 'denisovan'] as Species[]).map((s) => `<button data-act="mp-sp:${s}" class="pill ${mp.mySpecies === s ? 'on' : ''}">${icon(spIcon(s))}${SPECIES[s].name}</button>`).join('')}
          </div>
        </div>
        <div class="mp-grid">
          <div class="mp-chat-col">
            <div class="mp-tabs">
              ${tab('global', 'global-hearth', 'General chat')}
              ${tab('matchmaking', 'war-council', 'Find 1v1 / Co-op')}
              ${tab('strategy', 'elder-lore', 'Tips & builds')}
              ${curRoom ? tab('room', `room-${curRoom.code}`, curRoom.hostName) : ''}
            </div>
            <div id="mp-chat-log" class="mp-chat-log">${msgHtml}</div>
            <div class="mp-chat-input">
              <input id="mp-chat-input" type="text" maxlength="220" placeholder="Message #${ch}… (Press Enter to send)"/>
              <button data-act="mp-send" class="btn primary">${icon('send')}Send</button>
            </div>
          </div>
          <div class="mp-side-col">
            <div class="mp-box">
              <h4>${icon('swords')}Matchmaking &amp; Custom Rooms</h4>
              ${curRoom ? `
                <div class="mp-active-room">
                  <div class="rm-head">
                    <div><small>ROOM CODE</small><b class="rm-code">${esc(curRoom.code)}</b></div>
                    <span class="pill on">${curRoom.mode === 'coop' ? '2P Co-op' : '1v1 Versus'}</span>
                  </div>
                  <p class="fine">Map: <b>${esc(MAPS[curRoom.mapId]?.name ?? curRoom.mapId)}</b> · Host: <b>${esc(curRoom.hostName)}</b> (${curRoom.players} in room)</p>
                  <p class="fine">In <b>${curRoom.mode === 'coop' ? 'Co-op' : 'Versus'}</b>, players share live room chat, send Resource Caravans, summon Allied Reinforcements, or launch Live Warband Strikes across connected sessions.</p>
                  <div class="row">
                    <button data-act="mp-copy" class="btn">${icon('export')}Invite Link</button>
                    <button data-act="mp-leave" class="btn">${icon('close')}Leave</button>
                  </div>
                  <button data-act="mp-launch" class="btn primary big">${icon('play')}Launch Online Match</button>
                </div>
              ` : `
                <div class="mp-create-row">
                  <button data-act="mp-mode:${this.mpModePick === 'coop' ? 'versus' : 'coop'}" class="btn">${icon(this.mpModePick === 'coop' ? 'gift' : 'swords')}Mode: ${this.mpModePick === 'coop' ? '2P Co-op' : '1v1 Versus'}</button>
                  <button data-act="mp-create" class="btn primary">${icon('plus')}Create Room</button>
                </div>
                <div class="mp-join-row">
                  <input id="mp-room-code" type="text" maxlength="6" placeholder="CODE (e.g. FROST1)"/>
                  <button data-act="mp-join" class="btn">${icon('play')}Join Code</button>
                </div>
                <div class="mp-room-list">
                  <small>OPEN LOBBIES (${rooms.length})</small>
                  ${rooms.map((r) => `
                    <div class="rm-item">
                      <div>
                        <b>${esc(r.hostName)} <span class="rm-tag">${esc(r.code)}</span></b>
                        <small>${r.mode === 'coop' ? 'Co-op' : '1v1 Versus'} · ${esc(MAPS[r.mapId]?.name ?? 'River Valley')} · ${r.players}/2</small>
                      </div>
                      <button data-act="mp-join:${r.code}" class="btn mini">Join</button>
                    </div>`).join('')}
                </div>
              `}
            </div>
            <div class="mp-box mp-peers">
              <h4>${icon('pop')}Clans Online (${peers.length + 1})</h4>
              <div class="peer-list">
                <div class="peer-row"><i style="background:${esc(mp.myBanner)}"></i><b>${esc(mp.myName)} (You)</b><small>${SPECIES[mp.mySpecies].name} · Online</small></div>
                ${peers.map((p) => `<div class="peer-row"><i style="background:${esc(p.banner)}"></i><b>${esc(p.name)}</b><small>${SPECIES[p.species].name} · Gen ${roman(p.gen)} · ${p.pingMs}ms${p.roomCode ? ` [${esc(p.roomCode)}]` : ''}</small></div>`).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <button data-act="${this.g.world && !this.g.showcase ? 'resume' : 'title'}" class="btn">${icon('door')}${this.g.world && !this.g.showcase ? 'Back to Match' : 'Title Screen'}</button>
          ${this.g.world && !this.g.showcase ? `<button data-act="chatdrawer" class="btn primary">${icon('chat')}Open In-Game Comms Drawer</button>` : ''}
        </div>
      </div>`, 'titlescreen mp-screen');

    const logEl = document.getElementById('mp-chat-log');
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  private syncMpModal() {
    const m = $('modal');
    if (m.classList.contains('mp-screen') && !m.classList.contains('hidden')) {
      const activeInput = document.activeElement as HTMLInputElement | null;
      const draft = (document.getElementById('mp-chat-input') as HTMLInputElement | null)?.value ?? '';
      const nickDraft = (document.getElementById('mp-name-input') as HTMLInputElement | null)?.value;
      const focusedId = activeInput?.id;
      this.openMultiplayer();
      if (nickDraft !== undefined) {
        const ni = document.getElementById('mp-name-input') as HTMLInputElement | null;
        if (ni) ni.value = nickDraft;
      }
      if (draft) {
        const ci = document.getElementById('mp-chat-input') as HTMLInputElement | null;
        if (ci) ci.value = draft;
      }
      if (focusedId) document.getElementById(focusedId)?.focus();
    }
  }

  renderChatDrawer(force = false) {
    let el = document.getElementById('chat-drawer');
    if (!mp.chatOpen || !this.g.world || this.g.showcase) {
      if (el) el.classList.add('hidden');
      return;
    }
    if (!el) {
      el = document.createElement('aside');
      el.id = 'chat-drawer';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      $('hud').appendChild(el);
    }
    el.classList.remove('hidden');
    const activeInput = document.activeElement as HTMLInputElement | null;
    if (!force && activeInput?.id === 'drawer-chat-input') return;
    const ch = mp.channel;
    const msgs = mp.messages.filter((m) => m.channel === ch).slice(-25);
    const room = mp.activeRoom;
    const html = `
      <div class="cd-head">
        <div><b>${icon('chat')}Clan Comms</b><small>${room ? `Room ${esc(room.code)} (${room.mode.toUpperCase()})` : `#${ch}`}</small></div>
        <div class="cd-head-btns">
          <button data-act="multiplayer" class="mini" title="Open Full Lobby">${icon('globe')}</button>
          <button data-act="chatdrawer-close" class="mini" title="Close">${icon('close')}</button>
        </div>
      </div>
      <div class="cd-tabs">
        <button data-act="mp-chan:global" class="${ch === 'global' ? 'on' : ''}">#global</button>
        <button data-act="mp-chan:matchmaking" class="${ch === 'matchmaking' ? 'on' : ''}">#council</button>
        <button data-act="mp-chan:strategy" class="${ch === 'strategy' ? 'on' : ''}">#lore</button>
        ${room ? `<button data-act="mp-chan:room" class="${ch === 'room' ? 'on' : ''}">#${esc(room.code)}</button>` : ''}
      </div>
      <div class="cd-ops">
        <button data-act="mp-act:tribute:food" class="btn mini" title="Send 30 Food caravan to allied clan">${icon('food')}Send Food</button>
        <button data-act="mp-act:tribute:wood" class="btn mini" title="Send 30 Wood caravan to allied clan">${icon('wood')}Send Wood</button>
        <button data-act="mp-act:reinforce" class="btn mini" title="Dispatch allied warband (35 Food, 20 Wood)">${icon('shield')}Reinforce</button>
        <button data-act="mp-act:strike" class="btn mini" title="Launch rival raiding party (40 Food, 15 Stone)">${icon('swords')}Warband Strike</button>
      </div>
      <div id="cd-log" class="cd-log">
        ${msgs.map((m) => `<div class="cd-msg ${m.system ? 'sys' : ''}"><b style="color:${esc(m.banner)}">${esc(m.senderName)}:</b> <span>${esc(m.text)}</span></div>`).join('')}
      </div>
      <div class="cd-input">
        <input id="drawer-chat-input" type="text" maxlength="180" placeholder="Send message…"/>
        <button data-act="drawer-send" class="btn primary mini">${icon('send')}</button>
      </div>`;
    if (force || html !== this.lastDrawerHtml) {
      el.innerHTML = html;
      this.lastDrawerHtml = html;
      const logEl = document.getElementById('cd-log');
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
    }
  }

  openMenu() {
    const g = this.g;
    const info = (s: SaveSlot) => { const i = g.slotInfo(s); return `<small>${esc(i.text)}</small>`; };
    this.openModal(`
      <div class="dialog menu">
        <h2>${icon('menu')}Paused</h2>
        <button data-act="resume" class="btn primary big">${icon('play')}Resume</button>
        <div class="grid2">
          <button data-act="save" class="btn">${icon('save')}<span>Save game${info('manual')}</span></button>
          <button data-act="continue:manual" class="btn">${icon('load')}<span>Load game</span></button>
          <button data-act="continue:auto" class="btn">${icon('clock')}<span>Load autosave${info('auto')}</span></button>
          <button data-act="tut-guide" class="btn">${icon('bulb')}<span>Interactive Tutorial</span></button>
          <button data-act="multiplayer" class="btn">${icon('globe')}<span>Online &amp; Chat Rooms</span></button>
          <button data-act="campaign" class="btn">${icon('campaign')}<span>Story Campaign</span></button>
          <button data-act="settings" class="btn">${icon('sparkle')}<span>Settings</span></button>
          <button data-act="help" class="btn">${icon('help')}<span>Field Manual</span></button>
          <button data-act="export" class="btn">${icon('export')}<span>Export save</span></button>
          <button data-act="import" class="btn">${icon('import')}<span>Import save</span></button>
          <button data-act="restartask" class="btn">${icon('restart')}<span>Restart</span></button>
          <button data-act="title" class="btn">${icon('door')}<span>Title screen</span></button>
        </div>
      </div>`);
  }

  openSettings() {
    const seg = (q: Quality, label: string) => `<button data-act="quality:${q}" class="btn ${settings.quality === q ? 'primary' : ''}">${label}</button>`;
    const sw = (k: 'edgePan' | 'muted' | 'voices' | 'bars', label: string, inv = false) => `<button data-act="toggle:${k}" class="switch ${(inv ? !settings[k] : settings[k]) ? 'on' : ''}" aria-pressed="${inv ? !settings[k] : settings[k]}"><i></i><span>${label}</span></button>`;
    this.openModal(`
      <div class="dialog">
        <h2>${icon('menu')}Settings</h2>
        <div class="srow"><label>${icon('sound')}Music</label><input type="range" min="0" max="100" value="${Math.round(settings.music * 100)}" data-set="music"><b>${Math.round(settings.music * 100)}</b></div>
        <div class="srow"><label>${icon('build')}Effects</label><input type="range" min="0" max="100" value="${Math.round(settings.sfx * 100)}" data-set="sfx"><b>${Math.round(settings.sfx * 100)}</b></div>
        <div class="srow"><label>${icon('mute')}Sound</label>${sw('muted', settings.muted ? 'Muted' : 'On', true)}</div>
        <div class="srow"><label>${icon('sparkle')}Graphics</label><div class="seg">${seg('auto', 'Auto')}${seg('high', 'High')}${seg('medium', 'Medium')}${seg('low', 'Low')}</div></div>
        <p class="fine">Auto lowers effects automatically if your device struggles. Low turns off shadows and post-processing.</p>
        <div class="srow"><label>${icon('move')}Edge scrolling</label>${sw('edgePan', settings.edgePan ? 'On' : 'Off')}</div>
        <div class="srow"><label>${icon('sound')}Unit voices</label>${sw('voices', settings.voices ? 'On' : 'Off')}</div>
        <div class="srow"><label>${icon('heart')}Health bars</label>${sw('bars', settings.bars ? 'Always' : 'Smart (hold Alt for all)')}</div>
        <div class="row"><button data-act="${this.g.showcase || !this.g.world ? 'title' : 'menu'}" class="btn primary">${icon('check')}Done</button></div>
      </div>`);
  }

  openHelp() {
    this.openModal(`
      <div class="dialog help">
        <h2>${icon('help')}Field Manual &amp; Controls</h2>
        <div class="hgrid">
          <section><h4>${icon('trophy')}Goal &amp; Modes</h4><p>Play the 6-chapter <b>Story Campaign</b>, jump into a <b>Skirmish</b>, or connect via <b>Online &amp; Chat</b>. Gather, build, discover <b>smoke preservation</b>, survive the winter, and pass the fire across generations.</p></section>
          <section><h4>${icon('dragsel')}Touch &amp; Mobile</h4><ul><li><b>Tap</b> to select; <b>double-tap</b> selects all of a type.</li><li>With units selected, <b>tap the map</b> to move, a tree/berry to gather, a damaged building to <b>repair</b>, or an enemy to attack.</li><li><b>Drag</b> pans, <b>pinch</b> zooms. <b>Select</b> button enables box-select.</li></ul></section>
          <section><h4>${icon('move')}Mouse &amp; Hotkeys</h4><ul><li><b>Left-click</b> select, <b>drag</b> box-select, <b>right-click</b> smart order (move/gather/repair/attack).</li><li><b>Wheel</b> zoom · <b>WASD</b>/arrows pan · <b>Space</b> pause.</li><li><b>B</b> build · <b>D</b> discoveries · <b>M A H S R</b> orders · <b>.</b> idle worker · Ctrl+1–9 groups.</li></ul></section>
          <section><h4>${icon('sparkle')}Specialist Abilities &amp; Mechanics</h4><ul><li><b>Chieftain Rally</b>, <b>Elder Blessing</b> (heal + knowledge), <b>Scout Signal Flare</b> (wide reveal), and <b>Champion/Brute Warcry</b>.</li><li><b>Stockpile Barter</b> trades surplus Wood, Food, or Stone.</li><li>Visit all 3 Landmarks: <b>Ember Cave</b>, <b>Sun-Baked Clay</b>, and the <b>Ancestral Megalith</b>.</li></ul></section>
        </div>
        <div class="row">
          <button data-act="tut-guide" class="btn">${icon('bulb')}Start Interactive Tutorial</button>
          <button data-act="${this.g.world && !this.g.showcase ? 'resume' : 'title'}" class="btn primary big">${icon('check')}Got it</button>
        </div>
      </div>`);
  }
  showHelpOnce() {
    let seen = false;
    try { seen = localStorage.getItem('lineage-rts:help') === '1'; localStorage.setItem('lineage-rts:help', '1'); } catch { /* ignore */ }
    if (!seen) this.tutorial.start(true);
  }

  openSuccession() {
    const w = this.g.world; if (!w) return;
    const c = successorCandidates(w), pre = inheritancePreview(w);
    const nb = w.buildings.filter((b) => b.owner === 0).length;
    const label = { preserved: 'Preserved — inherited intact', faded: 'Faded — relearn at 40% cost', known: 'Known', clue: 'Still a clue', hidden: 'Undiscovered' } as const;
    const tIcon = { logistics: 'provisions', recon: 'scout', teaching: 'knowledge' } as const;
    const rows = pre.filter((r) => r.from !== 'hidden' || (DISCOVERIES[r.id].minGen ?? 1) <= w.gen + 1);
    this.openModal(`
      <div class="dialog wide">
        <h2>${icon('fire')}Pass the fire</h2>
        <p>Winter is over. Your settlement (${nb} buildings), stores and territory carry forward into Generation ${roman(w.gen + 1)}. Elders retire and children grow into gatherers.</p>
        <h4>Inherited knowledge</h4>
        <ul class="inherit">${rows.map((r) => `<li class="${r.to}">${icon(DISC_ICON[r.id])}<b>${DISCOVERIES[r.id].name}</b><span>${label[r.to as keyof typeof label]}</span></li>`).join('')}</ul>
        <p class="fine">Discoveries you did not teach at a Teaching circle fade with their discoverers.</p>
        <h4>Choose your successor</h4>
        <div class="succ">${c.map((s, i) => `<button data-act="pick:${i}" class="scard ${i === this.pickedSuccessor ? 'on' : ''}">${icon(tIcon[s.trait])}<b>${s.name}</b><small>${s.note}</small></button>`).join('')}</div>
        <div class="row"><button data-act="resume" class="btn">Not yet</button><button data-act="succeed" class="btn primary big">${icon('play')}Begin generation ${roman(w.gen + 1)}</button></div>
      </div>`);
  }

  showEnd() {
    const w = this.g.world; if (!w) return;
    const won = w.status === 'won';
    won ? sfx.win() : sfx.lose();
    const curCh = w.campaignId ? getCampaignChapter(w.campaignId) : undefined;
    const nextCh = curCh ? CAMPAIGN_CHAPTERS.find((c) => c.chapterNum === curCh.chapterNum + 1) : undefined;
    const campNextBtn = won && nextCh ? `<button data-act="camp-next" class="btn primary big">${icon('play')}Next: Ch. ${nextCh.chapterNum} ${esc(nextCh.title)}</button>` : '';
    const contBtn = won && !w.endless && !campNextBtn ? `<button data-act="endless" class="btn primary big">${icon('fire')}Continue into Gen ${roman(Math.max(3, w.gen + 1))}</button>` : '';
    this.openModal(`
      <div class="dialog end ${won ? 'won' : 'lost'}">
        <div class="medal">${icon(won ? 'trophy' : 'skull')}</div>
        <h1 class="${won ? 'win' : 'lose'}">${won ? 'Victory' : 'Defeat'}</h1>
        <p>${esc(w.endMsg)}</p>
        <div class="stats"><div><b>${fmtTime(w.time)}</b><small>Time</small></div><div><b>${roman(w.gen)}</b><small>Generation</small></div><div><b>${w.stats.lost}</b><small>Clan lost</small></div><div><b>${w.stats.kills}</b><small>Rivals defeated</small></div></div>
        <p class="lineage">${w.lineage.map((l) => esc(l.name)).join(' → ')}</p>
        <div class="row">${campNextBtn}${contBtn}<button data-act="restart" class="btn ${campNextBtn || contBtn ? '' : 'primary big'}">${icon('restart')}Play again</button>${w.campaignId ? `<button data-act="campaign" class="btn">${icon('campaign')}Campaign</button>` : ''}<button data-act="title" class="btn">${icon('door')}Title screen</button></div>
      </div>`);
  }

  // ------------------------------------------------------------ periodic refresh
  refresh(force = false) {
    if (force) { this.lastTick = 0; this.lastCmds = ''; this.lastChips = ''; this.lastObj = ''; this.lastPanel = ''; this.lastSel = ''; this.lastDock = ''; this.lastClock = ''; this.lastDrawerHtml = ''; }
  }

  private renderTop() {
    const g = this.g;
    $('b-pause').innerHTML = icon(g.speed === 0 ? 'play' : 'pause');
    $('b-speed').textContent = `${g.speed || this.lastSpeed}×`;
    $('b-sound').innerHTML = icon(isMuted() ? 'mute' : 'sound');
    $('b-menu').innerHTML = icon('menu');
  }

  tick(now: number) {
    if (now - this.lastTick < 160) return;
    this.lastTick = now;
    const w = this.g.world; if (!w) return;
    this.renderTop(); this.renderChips(w, now); this.renderClock(w); this.renderObjectives(w); this.renderDock(w); this.renderSelection(w); this.renderCommands(w);
    this.history.sample(w);
    const selection = this.g.liveSel();
    this.bub.update(selection.length > 0 || this.g.selB !== null, selection.length ? selection.join(',') : `b:${this.g.selB}`, selection.length > 0);
    if (++this.placeN % 25 === 0) this.bub.place();
    { const a = w.alert, recent = !!a && !this.g.showcase && w.time - a.t < 15; const ab = $('alertbtn'); ab.classList.toggle('hidden', !recent); if (recent) ab.innerHTML = `${icon('warn')}<span>Under attack</span><kbd>F</kbd>`; }
    const laneH = $('toasts').offsetHeight;
    if (laneH !== this.lastLaneH) { this.lastLaneH = laneH; $('app').style.setProperty('--lane', `${laneH}px`); }
    this.renderPanel(); this.renderJobs(w); this.renderPlaceBar(); this.renderChatDrawer(); this.tutorial.update(); this.processLog(w);
    if (canSucceed(w) && !this.springToast) { this.springToast = true; this.toast('Spring has come. Open the objectives to advance the generation.', 'good'); sfx.good(); }
    if (!canSucceed(w)) this.springToast = false;
  }

  private processLog(w: World) {
    const key = (l: { t: number; text: string }) => `${l.t}|${l.text}`;
    const idx = this.lastLog ? w.log.findIndex((l) => key(l) === this.lastLog) : -1;
    const fresh = idx >= 0 ? w.log.slice(idx + 1) : this.lastLog ? w.log.slice(-3) : [];
    for (const l of fresh) {
      this.toast(l.text, l.kind);
      if (this.g.showcase) continue;
      if (l.kind === 'bad' && /attack|approach|warband|raid|spotted|destroyed/i.test(l.text)) { this.alertFlash(); sfx.alert(); }
      else if (l.kind === 'good' && !/Discovery:|completed|joins the clan|taught|preserved/i.test(l.text)) sfx.good();
    }
    if (w.log.length) this.lastLog = key(w.log[w.log.length - 1]);
  }

  // ------------------------------------------------------------ top bar
  private renderChips(w: World, now: number) {
    const plate = (r: string, label: string, v: number, extra = '') => {
      const n = Math.floor(v), prev = this.prevRes[r] ?? n;
      if (n > prev) this.flash[r] = now + 700; else if (n < prev) this.flash[r] = -(now + 500);
      this.prevRes[r] = n;
      const f = this.flash[r] ?? 0, cls = f > now ? 'up' : -f > now ? 'down' : '';
      const low = r === 'food' && n < 25 ? 'low' : '';
      return `<button type="button" data-act="inspect:${r}" aria-label="Inspect ${label}" aria-controls="panel" aria-haspopup="dialog" class="plate ${r} ${cls} ${low}" data-tip="${esc(JSON.stringify({ t: label, d: { food: 'Feeds the clan. Loose food rots in winter.', wood: 'Buildings, tools and fuel.', stone: 'Tools, weapons and construction.', knowledge: 'From the hearth, teaching circle and exploration. Fuels discoveries.', provisions: 'Smoked food that never spoils. Feeds expeditions beyond supply range.' }[r] ?? '' }))}">${icon(r)}<b>${n}</b>${extra}</button>`;
    };
    const cap = popCap(w), pop = popCount(w);
    const popPlate = `<button type="button" data-act="inspect:pop" aria-label="Inspect population" class="plate pop ${pop >= cap ? 'low' : ''}" data-tip="${esc(JSON.stringify({ t: 'Population', d: 'Clan members / housing. Build shelters to grow.' }))}">${icon('pop')}<b>${pop}<i>/${cap}</i></b></button>`;
    const idle = w.units.filter(u => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'idle').length;
    const idlePlate = `<button type="button" class="plate idle" data-act="nextidle" aria-label="Next idle worker (${idle})">${icon('idle')}<b>${idle}</b></button>`;
    const html = plate('food', 'Food', w.res.food) + plate('wood', 'Wood', w.res.wood) + plate('stone', 'Stone', w.res.stone) + plate('knowledge', 'Knowledge', w.res.knowledge) +
      (w.res.provisions > 0 || hasDisc(w, 'preservation') ? plate('provisions', 'Provisions', w.res.provisions) : '') + popPlate + idlePlate;
    if (html !== this.lastChips) {
      const template = document.createElement('template'); template.innerHTML = html;
      const chips = $('chips');
      for (const next of Array.from(template.content.children) as HTMLElement[]) {
        const current = chips.querySelector<HTMLElement>(`[data-act="${next.dataset.act}"]`);
        if (!current) chips.appendChild(next);
        else {
          for (const attribute of Array.from(next.attributes)) current.setAttribute(attribute.name, attribute.value);
          if (current.innerHTML !== next.innerHTML) current.innerHTML = next.innerHTML;
        }
      }
      for (const current of Array.from(chips.children) as HTMLElement[]) {
        if (!template.content.querySelector(`[data-act="${current.dataset.act}"]`) && !html.includes(`data-act="${current.dataset.act}"`)) current.remove();
      }
      this.lastChips = html;
    }
  }

  private renderClock(w: World) {
    const winter = isWinter(w), before = w.time < w.winter.start;
    const season = winter ? 'Winter' : before ? (w.gen === 1 ? 'Autumn' : 'Summer') : 'Spring';
    const sIcon = winter ? 'snow' : before ? (w.gen === 1 ? 'leaf' : 'sun') : 'sun';
    const left = winter ? `Spring in ${fmtTime(w.winter.end - w.time)}` : before ? `Winter in ${fmtTime(w.winter.start - w.time)}` : 'Winter has passed';
    const d0 = w.winter.start - 420, d1 = w.winter.end + 60, f = (t: number) => Math.max(0, Math.min(100, ((t - d0) / (d1 - d0)) * 100));
    const html = `<div class="medal ${winter ? 'cold' : ''}">${icon(sIcon)}</div>
      <div class="ctxt"><b>${season}</b><small>${left}</small></div>
      <div class="gen"><small>GENERATION</small><b>${roman(w.gen)}</b></div>
      <div class="tline" title="Season timeline"><i class="win" style="left:${f(w.winter.start)}%;width:${f(w.winter.end) - f(w.winter.start)}%"></i><i class="now" style="left:${f(w.time)}%"></i></div>`;
    if (html !== this.lastClock) { $('clock').innerHTML = html; this.lastClock = html; }
  }

  // ------------------------------------------------------------ objectives
  private hint(w: World): string {
    const has = (k: string) => w.buildings.some((b) => b.owner === 0 && b.kind === k && b.done);
    if (w.status !== 'playing') return '';
    if (w.gen === 1) {
      if (w.stats.food < 1 && w.time < 120) return 'Tap a gatherer, then tap a berry bush or tree to put them to work. Use Jobs to rebalance.';
      if (canSucceed(w)) return 'Spring has come — advance the generation below.';
      if (!has('stockpile')) return 'Build a Stockpile near the trees so gatherers walk less.';
      if (w.disc.cooking === 'clue' || w.disc.preservation === 'clue' || w.disc.portable === 'clue') return 'A clue is waiting: open Discoveries to investigate it.';
      if (!has('toolshelter')) return 'Build a Toolmaking shelter — tools and some discoveries need it.';
      if (!w.landmarks[0].visited) return `Send your scout ${compass(w, w.landmarks[0])} to the Ember Cave for a clue about carrying fire.`;
      if (hasDisc(w, 'preservation') && !has('rack')) return 'Build a Smoking rack. It turns food into provisions that never spoil.';
      if (has('rack') && !has('circle')) return 'Build a Teaching circle, then teach your discoveries so your descendants keep them.';
      if (w.time > w.winter.start - 60 && w.time < w.winter.start) return 'Winter is near: smoke food, build shelters and stay close to warmth.';
      if (isWinter(w)) return 'Winter: loose food rots and cold hurts units away from hearth and shelters.';
      return 'Train hunters and guards at a Hunting lodge to protect your workers.';
    }
    if (w.gen >= 3 || w.endless) {
      if (!hasDisc(w, 'kiln') && !hasDisc(w, 'irrigation')) return 'Investigate Generation III discoveries (High-heat kilns or Seasonal irrigation) to master the valley.';
      return 'Lead your warband against the rival clan\'s hearth to unite the valley.';
    }
    if (w.res.provisions < OUTPOST_REQUIRE) return `Smoke more food: you need ${OUTPOST_REQUIRE} provisions to supply an expedition.`;
    return 'Scout the north-east. Build a Watch post at the Far Meadow (the north ford is the quiet route). Keep gatherers supplied.';
  }

  private renderObjectives(w: World) {
    const list = objectiveList(w), cur = list.findIndex((o) => !o.done), open = !!this.objOpen, succ = canSucceed(w), hint = this.hint(w);
    const done = list.filter((o) => o.done).length;
    const ch = w.campaignId ? getCampaignChapter(w.campaignId) : undefined;
    const title = ch ? `Ch. ${ch.chapterNum}: ${ch.title}` : w.gen === 1 ? 'The First Winter' : w.gen === 2 && !w.endless ? 'The Far Meadow' : `Dawn of Civilization (Gen ${roman(w.gen)})`;
    const html = `<div class="oh" data-act="objtoggle">${icon('trophy')}<div><b>${esc(title)}</b><small>${done}/${list.length} objectives</small></div>${icon(open ? 'chevd' : 'chevr', 'chev')}</div>` +
      (open ? `<ul>${list.map((o, i) => `<li class="${o.done ? 'done' : i === cur ? 'cur' : ''}"><span class="ob">${o.done ? icon('check') : ''}</span>${esc(o.text)}</li>`).join('')}</ul>` : `<div class="one">${cur >= 0 ? esc(list[cur].text) : 'Objectives complete'}</div>`) +
      (hint && open ? `<p class="hint">${icon('bulb')}<span>${esc(hint)}</span></p>` : '') +
      (succ ? `<button data-act="succession" class="btn primary pulse">${icon('fire')}Advance generation</button>` : '');
    $('opill').innerHTML = `${icon('trophy')}<b>${done}/${list.length}</b>${succ ? '<i class="badge">!</i>' : ''}`;
    if (html !== this.lastObj) { $('obody').innerHTML = html; this.lastObj = html; }
  }

  // ------------------------------------------------------------ dock (global tools)
  private renderDock(w: World) {
    const g = this.g;
    const clueReady = DISC_ORDER.some((id) => {
      const req = DISCOVERIES[id].minGen ?? (DISCOVERIES[id].later ? 2 : 1);
      return (req <= w.gen && (w.disc[id] === 'clue' || w.disc[id] === 'faded')) || (w.disc[id] === 'known' && w.buildings.some((b) => b.owner === 0 && b.kind === 'circle' && b.done));
    });
    const idleN = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'idle').length;
    const dk = (act: string, ic: string, label: string, tip: string, o: { key?: string; on?: boolean; badge?: string; big?: boolean } = {}) =>
      `<button class="dk ${o.big ? 'big' : ''} ${o.on ? 'on' : ''}" data-act="${act}" data-tip="${esc(JSON.stringify({ t: label, d: tip, k: o.key }))}">${icon(ic)}<span>${label}</span>${o.badge ? `<i class="badge">${o.badge}</i>` : ''}</button>`;
    const html = dk('build', 'build', 'Build', 'Place buildings: shelters, stockpiles, tools, racks and defenses.', { key: 'B', on: this.panel === 'build', big: true }) +
      dk('disc', 'discover', 'Discover', 'Investigate clues, apply discoveries and teach them to the next generation.', { key: 'D', on: this.panel === 'disc', badge: clueReady ? '!' : undefined, big: true }) +
      dk('jobs', 'jobs', 'Jobs', 'Rebalance your gatherers between food, wood and stone.', { on: this.jobsOpen }) +
      dk('idle', 'idle', 'Idle', 'Select idle gatherers and jump to them.', { key: '.', badge: idleN ? String(idleN) : undefined }) +
      dk('army', 'army', 'Army', 'Select every scout and fighter.') +
      dk('dragsel', 'dragsel', 'Select', 'Toggle drag-to-box-select (for touch screens).', { on: g.selectMode }) +
      dk('home', 'home', 'Home', 'Jump the camera to your clan hearth.') +
      dk('gift', 'gift', w.time < w.truceUntil ? fmtTime(w.truceUntil - w.time) : 'Gift', 'Give the rival clan 40 food for three minutes of peace and an open pass.') +
      dk('chatdrawer', 'chat', 'Chat', 'Open clan chat rooms, online multiplayer tribute, and warband strikes.', { on: mp.chatOpen, badge: mp.unread > 0 ? String(mp.unread) : undefined });
    if (html !== this.lastDock) { $('dock').innerHTML = html; this.lastDock = html; }
  }

  // ------------------------------------------------------------ selection panel
  private renderSelection(w: World) {
    const g = this.g, ids = g.liveSel();
    let html = '';
    $('cmds').classList.toggle('unit-commands', ids.length > 0);
    if (ids.length) {
      const us = ids.map((i) => w._u!.get(i)!).filter(Boolean);
      if (us.length === 1) {
        const u = us[0], d = UNITS[u.kind], o = u.order;
        const uSp: Species = u.species ?? (u.owner === 1 ? w.rivalSpecies : w.species);
        const effSt = u.owner !== 2 ? speciesUnitStats(uSp, u.kind, u.gen) : { dmg: d.dmg, speed: d.speed, vision: d.vision };
        const spPrefix = u.owner !== 2 ? `${SPECIES[uSp].name} · ` : '';
        const doing = o.t === 'gather' ? `Gathering ${nodeById(w, o.node)?.res ?? ''}` : o.t === 'idle' ? 'Idle' : o.t === 'research' ? 'Researching' : o.t === 'build' ? 'Building / Repairing' : o.t === 'attack' ? 'Fighting' : o.t === 'move' ? 'Moving' : o.t === 'amove' ? 'Attack-moving' : o.t === 'hold' ? 'Holding' : o.t === 'patrol' ? 'Patrolling' : o.t;
        const pct = Math.max(0, u.hp / u.maxHp) * 100;
        const specs = w.specialists
          ? (Object.entries(w.specialists) as [DiscoveryId, number][])
              .filter(([id, uid]) => uid === u.id && w.disc[id] === 'known')
              .map(([id]) => DISCOVERIES[id].name)
          : [];
        const specNote = specs.length ? `<p class="fine">${icon('discover')}<b>Specialist:</b> ${esc(specs.join(', '))} (teach at a Circle or it fades if ${esc(u.name)} falls!)</p>` : '';
        const bCol = u.owner === 0 ? (w.bannerColor ?? '#27b7c6') : '#d84e28';
        html = `<div class="sp"><div class="pf p3d" style="--team:${bCol}"><canvas id="sel-portrait-canvas" width="128" height="128"></canvas><i class="pf-badge">${icon(KIND_ICON[u.kind])}</i></div>
          <div class="si"><h3>${esc(u.name)}<small>${spPrefix}${['', 'Veteran ', 'Elite '][rankOf(u)]}${d.name}${u.gen > 1 ? ' · Gen ' + roman(u.gen) : ''}${u.kills ? ` · ${u.kills} kills` : ''}</small><button class="mini clr" data-act="desel" aria-label="Deselect">${icon('close')}</button></h3>
          <div class="hp ${pct < 35 ? 'low' : ''}"><i style="width:${pct}%"></i><span>${icon('heart')}${Math.ceil(u.hp)} / ${u.maxHp}</span></div>
          <div class="stats"><span>${icon('attack')}${effSt.dmg}</span><span>${icon('move')}${effSt.speed.toFixed(1)}</span><span>${icon('scout')}${effSt.vision}</span>${u.carry.n ? `<span>${icon(u.carry.res!)}${u.carry.n}</span>` : ''}<span class="st">${doing}</span></div>
          <p class="desc">${esc(d.desc)}</p>${specNote}</div></div>`;
      } else {
        const counts: Record<string, number> = {}; for (const u of us) counts[u.kind] = (counts[u.kind] ?? 0) + 1;
        html = `<div class="sp multi"><div class="mh"><b>${us.length} selected</b><button class="mini clr" data-act="desel" aria-label="Deselect all" data-tip="${esc(JSON.stringify({ t: 'Deselect all', d: 'Clear the current selection.' }))}">${icon('close')}<span>Clear</span></button></div><div class="grp">${Object.entries(counts).map(([k, n]) => `<button class="gi" data-act="selkind:${k}" data-tip="${esc(JSON.stringify({ t: UNITS[k as UnitKind].name, d: `Select only the ${UNITS[k as UnitKind].name.toLowerCase()}s.` }))}">${icon(KIND_ICON[k])}<i class="badge">${n}</i><span>${UNITS[k as UnitKind].name}</span></button>`).join('')}</div></div>`;
      }
    } else if (g.selB !== null && w._b?.get(g.selB)) {
      const b = w._b.get(g.selB)!, d = BUILDINGS[b.kind], pct = (b.hp / b.maxHp) * 100;
      const q = Array.from({ length: 5 }, (_, i) => { const it = b.queue[i]; return `<span class="qs ${it ? 'full' : ''}">${it ? icon(KIND_ICON[it.kind]) : ''}${i === 0 && it ? `<i style="height:${Math.max(0, Math.min(100, (1 - it.t / UNITS[it.kind].time) * 100))}%"></i>` : ''}</span>`; }).join('');
      const prog = (label: string, t: number, total: number) => `<div class="job"><small>${label}</small><div class="jbar"><i style="width:${Math.max(0, Math.min(100, (1 - t / total) * 100))}%"></i></div></div>`;
      const tiers = d.upgrades?.length ? `<span class="tiers">${d.upgrades.map((_, i) => `<i class="${i < b.tier ? 'on' : ''}"></i>`).join('')}</span>` : '';
      const jobs = (b.upg ? prog(`Upgrading to ${nextUpgrade(b)!.name}`, b.upg.t, b.upg.total) : '') + (b.research ? prog(`Researching ${TECHS[b.research.tech].name}`, b.research.t, b.research.total) : '');
      html = `<div class="sp"><div class="pf bld">${icon(b.kind)}</div>
        <div class="si"><h3>${esc(buildingTitle(b))}${tiers}<small>${b.done ? 'Complete' : `Under construction ${Math.floor(b.progress * 100)}%`}</small><button class="mini clr" data-act="desel" aria-label="Deselect">${icon('close')}</button></h3>
        <div class="hp"><i style="width:${pct}%"></i><span>${icon('heart')}${Math.ceil(b.hp)} / ${b.maxHp}</span></div>
        <p class="desc">${esc(d.desc)}</p>${jobs}${d.trains.length && b.done ? `<div class="queue"><small>Training</small>${q}</div>` : ''}</div></div>`;
    } else {
      html = `<div class="sp empty"><div class="eh">${icon('info')}</div><p><b>Nothing selected</b>Tap a unit or building. Drag to pan, pinch or scroll to zoom. <span class="muted">Use the buttons on the right for Build and Discoveries.</span></p></div>`;
    }
    if (html !== this.lastSel) { $('selpanel').innerHTML = html; this.lastSel = html; }
  }

  // ------------------------------------------------------------ command card
  private renderCommands(w: World) {
    const g = this.g, ids = g.liveSel();
    if (g.mode !== 'move') this.workMode = false;
    let h = '';
    $('cmds').classList.toggle('unit-commands', ids.length > 0);
    if (ids.length) {
      const us = ids.map((i) => w._u!.get(i)!).filter(Boolean);
      h += cbtn({ act: 'move', ic: 'move', label: 'Move', key: 'M', on: g.mode === 'move' && !this.workMode, tip: { t: 'Move', d: 'Then tap the destination. You can also right-click or just tap.' } });
      if (us.some(u => u.kind === 'gatherer')) h += cbtn({ act: 'work', ic: 'jobs', label: 'Work', on: g.mode === 'move' && this.workMode, tip: { t: 'Work / Repair', d: 'Then tap a resource, an unfinished site, or a damaged building to repair.' } });
      if (us.some((u) => UNITS[u.kind].dmg > 3 || u.kind === 'hunter')) h += cbtn({ act: 'amove', ic: 'attack', label: 'Attack', key: 'A', on: g.mode === 'amove', tip: { t: 'Attack-move', d: 'Advance and engage anything on the way.' } });
      if (us.some((u) => UNITS[u.kind].dmg > 3)) h += cbtn({ act: 'patrol', ic: 'patrol', label: 'Patrol', key: 'P', on: g.mode === 'patrol', tip: { t: 'Patrol', d: 'Then tap a point: they walk back and forth between here and there, fighting anything they meet.' } });
      h += cbtn({ act: 'queue', ic: 'queue', label: 'Queue', key: '⇧', on: g.queueMode, tip: { t: 'Queue orders (Shift)', d: 'While on, each order is added after the current one instead of replacing it. With a mouse, just hold Shift.' } });
      h += cbtn({ act: 'hold', ic: 'hold', label: 'Hold', key: 'H', tip: { t: 'Hold position', d: 'Stand still and only attack what comes in range.' } });
      h += cbtn({ act: 'stop', ic: 'stop', label: 'Stop', key: 'S', tip: { t: 'Stop', d: 'Cancel current orders.' } });
      h += cbtn({ act: 'retreat', ic: 'retreat', label: 'Retreat', key: 'R', tip: { t: 'Retreat', d: 'Fall back to the clan hearth.' } });
      const l = us.find((u) => u.kind === 'leader');
      if (l) h += cbtn({ act: 'rally', ic: 'rally', label: 'Rally', cls: 'gold', why: l.ability > 0 ? `Rally ready in ${Math.ceil(l.ability)}s.` : undefined, badge: l.ability > 0 ? `${Math.ceil(l.ability)}` : undefined, cd: l.ability > 0 ? l.ability / 45 : 0, tip: { t: 'Rally', d: 'Heal nearby allies by 20% and boost their speed and damage for 8 seconds. 45s cooldown.' } });
      const elder = us.find((u) => u.kind === 'elder');
      if (elder) h += cbtn({ act: 'bless', ic: 'knowledge', label: 'Bless', cls: 'gold', why: elder.ability > 0 ? `Blessing ready in ${Math.ceil(elder.ability)}s.` : undefined, badge: elder.ability > 0 ? `${Math.ceil(elder.ability)}` : undefined, cd: elder.ability > 0 ? elder.ability / 35 : 0, tip: { t: 'Ancestral Blessing', d: 'Heal nearby clan members by 28% HP, warm them from cold, and inspire +12 Knowledge. 35s cooldown.' } });
      const scout = us.find((u) => u.kind === 'scout' || u.kind === 'stalker');
      if (scout) h += cbtn({ act: 'flare', ic: 'flare', label: 'Flare', cls: 'gold', why: scout.ability > 0 ? `Flare ready in ${Math.ceil(scout.ability)}s.` : undefined, badge: scout.ability > 0 ? `${Math.ceil(scout.ability)}` : undefined, cd: scout.ability > 0 ? scout.ability / 30 : 0, tip: { t: 'Signal Flare', d: 'Send up an ember flare to reveal a wide 14-tile radius through the fog of war and hasten the scout. 30s cooldown.' } });
      const champ = us.find((u) => u.kind === 'champion' || u.kind === 'brute');
      if (champ) h += cbtn({ act: 'warcry', ic: 'swords', label: 'Warcry', cls: 'gold', why: champ.ability > 0 ? `Warcry ready in ${Math.ceil(champ.ability)}s.` : undefined, badge: champ.ability > 0 ? `${Math.ceil(champ.ability)}` : undefined, cd: champ.ability > 0 ? champ.ability / 40 : 0, tip: { t: 'Warcry', d: 'Unleash a battle roar that empowers nearby warriors with +20% speed/damage for 10s and heals 12% HP. 40s cooldown.' } });
      if (us.some((u) => u.kind === 'gatherer')) h += cbtn({ act: 'build', ic: 'build', label: 'Build', key: 'B', tip: { t: 'Build', d: 'Open the construction menu. Selected gatherers will build.' } });
    } else if (g.selB !== null && w._b?.get(g.selB)) {
      const b = w._b.get(g.selB)!, d = BUILDINGS[b.kind];
      if (b.done) {
        if (b.hp < b.maxHp) {
          h += cbtn({ act: 'repair', ic: 'repair', label: 'Repair', cls: 'gold', tip: { t: 'Repair Structure', d: `Send gatherers to repair ${d.name} (${Math.ceil(b.hp)}/${b.maxHp} HP).` } });
        }
        for (const k of d.trains) {
          const ud = UNITS[k as UnitKind], c = trainCheck(w, b.id, k as UnitKind);
          if (ud.only && ud.only !== w.species) continue;
          const q0 = b.queue[0]; const tcd = q0 && q0.kind === k ? q0.t / ud.time : 0;
          h += cbtn({ act: `train:${k}`, ic: KIND_ICON[k], label: ud.name, cost: ud.cost, w, cd: tcd, badge: b.queue.filter((x) => x.kind === k).length > 0 ? String(b.queue.filter((x) => x.kind === k).length) : undefined, why: c.ok ? undefined : c.reason, tip: { t: ud.name, d: ud.desc, cost: ud.cost } });
        }
        if (d.trains.length) h += cbtn({ act: 'setrally', ic: 'rally', label: 'Rally', key: 'Y', on: g.mode === 'rally', tip: { t: 'Set rally point', d: 'Then tap the map (or right-click) where new recruits should go. Tap a tree, bush or rock and new gatherers go straight to work.' } });
        const up = nextUpgrade(b);
        if (b.upg) h += cbtn({ act: 'cancelupg', ic: 'close', label: 'Cancel', tip: { t: 'Cancel upgrade', d: '75% of the cost is refunded.' } });
        else if (up) { const c = upgradeCheck(w, b.id); h += cbtn({ act: 'upgrade', ic: 'upgrade', label: up.name, cost: up.cost, w, cls: 'gold', why: c.ok ? undefined : c.reason, tip: { t: `Upgrade: ${up.name}`, d: up.desc, cost: up.cost } }); }
        if (b.research) h += cbtn({ act: 'cancelres', ic: 'close', label: 'Cancel', tip: { t: 'Cancel research', d: '75% of the cost is refunded.' } });
        else for (const t of techsFor(b.kind)) {
          if (hasTech(w, t.id)) continue;
          const c = researchCheck(w, b.id, t.id);
          h += cbtn({ act: `research:${t.id}`, ic: 'tech', label: t.name, cost: t.cost, w, why: c.ok ? undefined : c.reason, tip: { t: t.name, d: t.desc, cost: t.cost } });
        }
        if (b.kind === 'stockpile') {
          h += cbtn({ act: 'barter:wood2food', ic: 'food', label: 'Trade Wood', cost: { wood: 30 }, w, why: w.res.wood < 30 ? 'Need 30 wood' : undefined, tip: { t: 'Barter Wood for Food', d: 'Trade 30 Wood for +20 Food.' } });
          h += cbtn({ act: 'barter:food2wood', ic: 'wood', label: 'Trade Food', cost: { food: 30 }, w, why: w.res.food < 30 ? 'Need 30 food' : undefined, tip: { t: 'Barter Food for Wood', d: 'Trade 30 Food for +20 Wood.' } });
          h += cbtn({ act: 'barter:stone2know', ic: 'knowledge', label: 'Trade Stone', cost: { stone: 20 }, w, why: w.res.stone < 20 ? 'Need 20 stone' : undefined, tip: { t: 'Carve Lore Tablets', d: 'Trade 20 Stone for +15 Knowledge.' } });
        }
        if (b.kind === 'circle') h += cbtn({ act: 'disc', ic: 'knowledge', label: 'Teach', tip: { t: 'Teach', d: 'Preserve discoveries for future generations.' } });
        if (['toolshelter', 'hearth'].includes(b.kind)) h += cbtn({ act: 'disc', ic: 'discover', label: 'Discover', tip: { t: 'Discoveries', d: 'Investigate discoveries that use this facility.' } });
      } else h += cbtn({ act: 'cancelsite', ic: 'close', label: 'Cancel', tip: { t: 'Cancel construction', d: '75% of the cost is refunded.' } });
    }
    if (h !== this.lastCmds) { $('cmds').innerHTML = h; this.lastCmds = h; }
  }

  private renderJobs(w: World) {
    if (!this.jobsOpen) return;
    const c = jobCounts(w);
    const row = (r: Res, label: string) => `<div class="jrow">${icon(r)}<span>${label}</span><b>${c[r]}</b><button data-act="job:${r}" class="mini" aria-label="Add worker to ${label}">${icon('plus')}</button></div>`;
    const html = `<h4>${icon('jobs')}Gatherer jobs</h4>${row('food', 'Food')}${row('wood', 'Wood')}${row('stone', 'Stone')}<div class="jrow">${icon('idle')}<span>Idle</span><b>${c.idle}</b><button data-act="idle" class="mini">Select</button></div><div class="jrow">${icon('build')}<span>Building / researching</span><b>${c.build}</b><i></i></div><p class="fine">+ moves an idle gatherer (or one from another job) here.</p>`;
    if (html !== this.lastJobs) { $('jbody').innerHTML = html; this.lastJobs = html; }
  }

  private renderPlaceBar() {
    const g = this.g, el = $('placebar');
    if (g.mode !== 'place' || !g.place) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const d = BUILDINGS[g.place.kind], ok = g.canPlaceNow();
    const html = `<div class="pi">${icon(g.place.kind)}<div><b>${d.name}</b><div class="cr">${chips(d.cost, g.world ?? undefined)}</div></div></div><button data-act="place-cancel" class="btn">${icon('close')}</button><button data-act="place-ok" class="btn primary big" ${ok ? '' : 'data-dim="1"'}>${icon('check')}Place</button>`;
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  }

  // ------------------------------------------------------------ build + discovery panels
  renderPanel(force = false) {
    const el = $('panel'), w = this.g.world;
    if (!this.panel || !w) { el.classList.add('hidden'); el.innerHTML = ''; this.lastPanel = ''; return; }
    const body = this.panel === 'build'
      ? `<h3>${icon('build')}Construction</h3><div class="bgrid">${BUILD_ORDER.map((k) => this.buildCard(k)).join('')}</div>`
      : this.panel === 'inspect' ? this.inspectPanel(w) : this.discPanel();
    const html = `<div class="sheet"><button data-act="closepanel" class="xbtn" aria-label="Close">${icon('close')}</button>${body}</div>`;
    if (force || html !== this.lastPanel) { el.innerHTML = html; this.lastPanel = html; }
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'panel-heading');
    el.querySelector('h3')?.setAttribute('id', 'panel-heading');
    el.classList.remove('hidden');
  }

  private inspectPanel(w: World) {
    const target = this.inspecting, jobs = jobCounts(w);
    const row = (label: string, value: string | number) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
    if (target === 'season') {
      const winter = isWinter(w), before = w.time < w.winter.start;
      const heading = winter ? 'Winter' : before ? 'Winter preparations' : 'Spring';
      const countdown = winter ? `Spring in ${fmtTime(w.winter.end - w.time)}` : before ? `Winter in ${fmtTime(w.winter.start - w.time)}` : 'Winter has passed';
      return `<h3>${icon(winter ? 'snow' : 'sun')}${heading}</h3><p>${countdown} · Generation ${roman(w.gen)}</p><p>Winter increases meal demand and spoils loose food. Keep units near warmth and preserve food for expeditions.</p><div class="row"><button class="btn" data-act="disc">Discoveries</button><button class="btn" data-act="objrestore">Objectives</button></div>`;
    }
    if (target === 'pop') {
      return `<h3>${icon('pop')}Population &amp; workers</h3><dl class="resource-grid">${row('Clan members', popCount(w))}${row('Housing capacity', popCap(w))}${row('Idle workers', jobs.idle)}${row('Building / researching', jobs.build)}</dl><div class="row"><button class="btn" data-act="nextidle">Next idle worker</button><button class="btn" data-act="jobs">Worker jobs</button><button class="btn" data-act="build">Build housing</button></div>`;
    }
    const resource = (['food','wood','stone','knowledge','provisions'].includes(target) ? target : 'food') as keyof World['res'];
    const labels: Record<keyof World['res'], string> = { food:'Food', wood:'Wood', stone:'Stone', knowledge:'Knowledge', provisions:'Provisions' };
    const rates = this.history.rates(w, resource);
    const rate = (n: number | null, signed = false) => n === null ? 'Measuring…' : `${signed && n > 0 ? '+' : ''}${n.toFixed(1)} / min`;
    let stats = row('Stored', Math.floor(w.res[resource])) + row('Recent net stock change', rate(rates.net, true));
    if (resource === 'food') stats += row('Gathered &amp; harvested before cooking', rate(rates.gathered)) + row('Meal demand', rate(rates.foodDemand)) + row('Food workers', jobs.food) + row('Food spoiled this campaign', Math.floor(w.stats.spoiled));
    else if (resource === 'wood' || resource === 'stone') stats += row('Assigned workers', jobs[resource]);
    const note = resource === 'food' ? 'Meal demand excludes spoilage and smoking. Gathered/harvested food is measured before cooking bonuses.' : resource === 'provisions' ? 'Smoking racks turn loose food into provisions. Provisions do not spoil and support expeditions.' : resource === 'knowledge' ? 'Hearths and teaching circles generate knowledge; investigations and teaching spend it.' : 'Workers collect resources and deliver them to a nearby drop-off.';
    return `<h3>${icon(resource)}${labels[resource]}</h3><dl class="resource-grid">${stats}</dl><p>${note}</p><p class="fine">Recent change uses up to 30 seconds of simulation time and includes income, spending and upkeep.</p><div class="row"><button class="btn" data-act="jobs">Worker jobs</button>${['food','wood','stone'].includes(resource) ? `<button class="btn primary" data-act="job:${resource}">Assign a worker</button>` : `<button class="btn" data-act="disc">Discoveries</button>`}</div>`;
  }

  private buildCard(k: BuildingKind) {
    const w = this.g.world!, d = BUILDINGS[k];
    let why = '', locked = false;
    if (d.requires && !hasDisc(w, d.requires as DiscoveryId)) { why = `Locked: discover ${DISCOVERIES[d.requires as DiscoveryId].name}.`; locked = true; }
    else for (const r of Object.keys(d.cost) as Res[]) if (w.res[r] < (d.cost[r] ?? 0)) { why = `Not enough ${r} (need ${d.cost[r]}).`; break; }
    return `<button data-act="placeb:${k}" class="bcard ${why ? 'dis' : ''} ${locked ? 'locked' : ''}" ${why ? `data-why="${esc(why)}"` : ''}>
      <div class="bic">${icon(k)}</div><div class="bt"><b>${d.name}</b><span class="bd">${esc(d.desc)}</span><div class="cr">${chips(d.cost, w)}</div></div>${locked ? `<div class="lockv">${icon('lock')}</div>` : ''}</button>`;
  }

  private discPanel() {
    const w = this.g.world!;
    const card = (id: DiscoveryId, sub = false) => {
      const d = DISCOVERIES[id], st = w.disc[id], act = w.activities.find((a) => a.disc === id);
      const reqGen = d.minGen ?? (d.later ? 2 : 1);
      const pip = (n: string, on: boolean) => `<span class="pip ${on ? 'on' : ''}"><i></i>${n}</span>`;
      const pips = pip('Observe', st !== 'hidden') + pip('Investigate', st === 'known' || st === 'preserved' || !!act) + pip('Apply', st === 'known' || st === 'preserved') + pip('Preserve', st === 'preserved');
      const status = st === 'hidden' ? 'Undiscovered' : act ? (act.kind === 'teach' ? 'Teaching…' : 'Investigating…') : st === 'clue' ? 'Clue found' : st === 'known' ? 'Discovered' : st === 'preserved' ? 'Preserved ✓' : 'Forgotten';
      let body = '';
      if (st === 'hidden') body = `<p class="muted">${icon('lock')}How to find a clue: ${esc(d.clueHint)}</p>`;
      else {
        body = `<p>${esc(d.clue)}</p><p class="eff">${icon('sparkle')}${esc(d.effect)}</p>`;
        if (st === 'known' || st === 'preserved') {
          if (st === 'known') {
            const c = teachCheck(w, id);
            const specId = w.specialists?.[id];
            const specU = specId ? unitById(w, specId) : undefined;
            const specMsg = specU
              ? `Only <b>${esc(specU.name)}</b> knows this secret — if ${esc(specU.name)} falls before teaching an apprentice, it will fade!`
              : 'Only the discoverers know this. Teach apprentices so it survives succession.';
            body += `<p class="fine">${specMsg}</p>` + (act ? this.prog(act.progress / act.total, 'Teaching…') : `<button data-act="teach:${id}" class="btn ${c.ok ? 'primary' : 'dis'}" ${c.ok ? '' : `data-why="${esc(c.reason)}"`}>${icon('knowledge')}Teach apprentices <span class="cr">${chips({ knowledge: 10 }, w)}</span></button>`);
          } else body += `<p class="good">${icon('check')}Preserved — inherited by descendants.</p>`;
        } else if (act) body += this.prog(act.progress / act.total, 'Investigating…');
        else {
          const c = investigateCheck(w, id), cost = discCost(w, id), mult = costMultiplier(w, id);
          const m = st === 'faded'
            ? '<p class="fine">Forgotten with the ancestors, but clues remain: 60% cheaper.</p>'
            : mult <= 0.6
              ? '<p class="fine">Deep ancestral mastery (2 generations preserved): 45% cheaper and faster.</p>'
              : mult < 1
                ? '<p class="fine">Inherited expertise: 30% cheaper and faster.</p>'
                : '';
          body += `${m}<div class="need"><span>Needs ${d.needs.map((n) => BUILDINGS[n].name).join(' + ')}</span><span class="cr">${chips(cost, w)}</span><span>${icon('clock')}${Math.round(discTime(w, id))}s</span></div><button data-act="inv:${id}" class="btn ${c.ok ? 'primary' : 'dis'}" ${c.ok ? '' : `data-why="${esc(c.reason)}"`}>${icon('discover')}${st === 'faded' ? 'Relearn' : 'Investigate'}</button>${c.ok ? '' : `<p class="why">${esc(c.reason)}</p>`}`;
        }
      }
      const genTag = reqGen > 1 ? ` <small>Gen ${roman(reqGen)}+${d.parent ? ' · from ' + DISCOVERIES[d.parent].name : ''}</small>` : '';
      return `<div class="disc s-${st} ${sub ? 'sub' : ''}"><div class="dh"><div class="dic">${icon(DISC_ICON[id])}</div><div><h4>${d.name}${genTag}</h4><span class="status">${status}</span></div></div><div class="pips">${pips}</div>${body}</div>`;
    };
    const lin = w.lineage.map((l) => `${esc(l.name)} <small>gen ${roman(l.gen)}${l.trait ? ' · ' + esc(l.trait) : ''}</small>`).join(' → ');
    return `<h3>${icon('discover')}Discoveries</h3>
      <div class="tree">
        <div class="root">${icon('fire')}<b>Era I — Maintain Fire</b><small>Generation I foundations</small></div>
        <div class="branches">${card('cooking')}${card('preservation')}${card('portable')}</div>
        <div class="root">${icon('pottery')}<b>Era II — Shaping Earth, Seed &amp; Water</b><small>Generation II+ branches (30% discount if parent is preserved)</small></div>
        <div class="branches">${card('heat', true)}${card('pottery', true)}${card('farming', true)}${card('boats', true)}</div>
        <div class="root">${icon('kiln')}<b>Era III — Civilization Foundations</b><small>Generation III+ mastery (45% discount if ancestral chain is preserved)</small></div>
        <div class="branches">${card('kiln', true)}${card('irrigation', true)}</div>
      </div>
      <p class="fine lin">Lineage: ${lin}</p>`;
  }

  private prog(f: number, label: string) {
    return `<div class="prog"><div style="width:${Math.round(f * 100)}%"></div><span>${label} ${Math.round(f * 100)}%</span></div>`;
  }

  frame3D(nowSec: number) {
    const modalOpen = !$('modal').classList.contains('hidden');
    const stageCanvas = modalOpen ? document.getElementById('clan-stage-canvas') : null;
    const portraitCanvas = !modalOpen ? document.getElementById('sel-portrait-canvas') : null;
    if (!stageCanvas && !portraitCanvas) return;

    const w = this.g.world;
    const ids = w && portraitCanvas ? this.g.liveSel() : [];
    const liveUnit = w && ids.length === 1 ? (w._u?.get(ids[0]) ?? null) : null;

    this.preview3d.renderFrame(
      nowSec,
      stageCanvas ? {
        species: this.pickedSpecies,
        unitKind: this.previewUnit,
        pose: this.previewPose,
        bannerColor: this.pickedBanner,
        gen: this.previewGen,
        variant: 0,
      } : null,
      liveUnit,
      w,
    );
  }
}
