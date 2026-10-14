import { BUILDINGS, BUILD_ORDER } from '../data/buildings';
import { DISCOVERIES, DISC_ORDER } from '../data/discoveries';
import { UNITS } from '../data/units';
import { TECHS, techsFor } from '../data/techs';
import {
  cmdCancelSite, cmdGift, cmdHold, cmdInvestigate, cmdJob, cmdRally, cmdRetreat, cmdStop, cmdTeach, cmdTrain, jobCounts, trainCheck,
} from '../sim/commands';
import { discCost, discTime, investigateCheck, teachCheck } from '../sim/discovery';
import { objectiveList } from '../sim/objectives';
import { hasDisc, hasTech, popCap, popCount, rankOf, FIGHTERS } from '../sim/rules';
import { cancelResearch, cancelUpgrade, cmdResearch, cmdUpgrade, nextUpgrade, researchCheck, upgradeCheck } from '../sim/upgrades';
import { advanceGeneration, canSucceed, inheritancePreview, successorCandidates } from '../sim/succession';
import type { BuildingKind, DiscoveryId, Res, Species, UnitKind, World } from '../sim/types';
import { bCenter, fmtTime, isWinter, nodeById } from '../sim/util';
import { OUTPOST_REQUIRE } from '../sim/world';
import { initAudio, isMuted, sfx } from './audio';
import { setSetting, settings } from './settings';
import type { Quality } from './settings';
import type { Game, SaveSlot } from './game';
import { icon } from './icons';
import { Bubbles } from './bubbles';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
type PanelId = 'build' | 'disc' | null;
type Cost = Partial<Record<string, number>>;

const KIND_ICON: Record<string, string> = { gatherer: 'gatherer', scout: 'scout', hunter: 'hunter', guard: 'guard', raider: 'raider', leader: 'leader', elder: 'elder', slinger: 'slinger', brute: 'brute', champion: 'champion', deer: 'deer', wolf: 'wolf' };
const DISC_ICON: Record<DiscoveryId, string> = { cooking: 'food', preservation: 'rack', portable: 'discover', heat: 'build' };

function chips(cost: Cost, w?: World): string {
  const parts = Object.entries(cost).filter(([, v]) => v);
  if (!parts.length) return '<span class="cc free">Free</span>';
  return parts.map(([k, v]) => `<span class="cc ${w && w.res[k as Res] < (v ?? 0) ? 'short' : ''}">${icon(k)}<b>${v}</b></span>`).join('');
}

interface BtnOpts { act: string; ic: string; label: string; key?: string; why?: string; on?: boolean; badge?: string; cost?: Cost; w?: World; tip?: { t: string; d: string; k?: string; cost?: Cost }; cls?: string }
const buildingTitle = (b: { kind: BuildingKind; tier: number }) => (b.tier > 0 ? BUILDINGS[b.kind].upgrades![b.tier - 1].name : BUILDINGS[b.kind].name);

function cbtn(o: BtnOpts): string {
  const tip = o.tip ? ` data-tip="${esc(JSON.stringify({ t: o.tip.t, d: o.tip.d, k: o.tip.k ?? o.key, c: o.tip.cost ?? o.cost }))}"` : '';
  return `<button class="cb ${o.on ? 'on' : ''} ${o.why ? 'dis' : ''} ${o.cls ?? ''}" data-act="${o.act}" ${o.why ? `data-why="${esc(o.why)}"` : ''}${tip}>
    ${icon(o.ic)}<span class="cl">${o.label}</span>${o.key ? `<kbd>${o.key}</kbd>` : ''}${o.cost ? `<span class="cr">${chips(o.cost, o.w)}</span>` : ''}${o.badge ? `<i class="badge">${o.badge}</i>` : ''}</button>`;
}

function portrait(species: Species) {
  const neo = species === 'neanderthal';
  const skin = neo ? '#d9a888' : '#e6bd94', hair = neo ? '#2a1c14' : '#46301e';
  return `<svg viewBox="0 0 120 120" class="portrait"><defs><radialGradient id="pg${species}" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="${neo ? '#6a5a44' : '#4a6a8a'}"/><stop offset="1" stop-color="#14110d"/></radialGradient></defs>
    <rect width="120" height="120" fill="url(#pg${species})"/>
    <path d="M10 120c0-26 20-40 50-40s50 14 50 40z" fill="#8a5a36"/><path d="M40 84l20 18 20-18" fill="none" stroke="#3a2418" stroke-width="3"/>
    <ellipse cx="60" cy="52" rx="${neo ? 27 : 24}" ry="${neo ? 29 : 30}" fill="${skin}"/>
    <path d="M${neo ? 30 : 33} 44c0-22 14-30 ${neo ? 30 : 27}-30s${neo ? 30 : 27} 8 ${neo ? 30 : 27} 30c-6-8-14-12-${neo ? 30 : 27}-12s-${neo ? 24 : 21} 4-${neo ? 30 : 27} 12z" fill="${hair}"/>
    ${neo ? '<path d="M36 50h48v6c-12-3-36-3-48 0z" fill="#4a2c1c" opacity=".55"/><path d="M42 72c6 10 30 10 36 0 0 10-6 16-18 16s-18-6-18-16z" fill="#3a2418"/>' : '<path d="M44 72c6 6 26 6 32 0" stroke="#8a4a3a" stroke-width="2" fill="none"/>'}
    <circle cx="50" cy="57" r="2.6" fill="#1a1210"/><circle cx="70" cy="57" r="2.6" fill="#1a1210"/>
    <rect x="34" y="40" width="52" height="5" fill="#27b7c6"/></svg>`;
}

export class Hud {
  private panel: PanelId = null;
  private lastChips = ''; private lastCmds = ''; private lastObj = ''; private lastPanel = ''; private lastJobs = ''; private lastSel = ''; private lastDock = ''; private lastClock = '';
  private lastLog = ''; private lastTick = 0; private jobsOpen = false; private objOpen: boolean | null = null;
  private springToast = false; private lastSpeed = 1;
  private pickedSuccessor = 0; private pickedSpecies: Species = 'human';
  readonly bub: Bubbles;
  private placeN = 0;
  private prevRes: Record<string, number> = {}; private flash: Record<string, number> = {};

  constructor(private g: Game) {
    const app = $('app');
    app.addEventListener('pointerdown', () => initAudio(), { capture: true });
    app.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      if (t.dataset.why) { sfx.error(); this.toast(t.dataset.why, 'bad'); return; }
      sfx.click(); this.hideTip();
      this.act(t.dataset.act!);
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
    });
    $<HTMLInputElement>('importfile').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const err = this.g.loadText(await f.text());
      (e.target as HTMLInputElement).value = '';
      if (err) this.toast(`Import failed: ${err}`, 'bad'); else { this.closeModal(); this.toast('Save imported.', 'good'); }
    });
    this.bub = new Bubbles(() => this.layout(), { subOpen: () => this.panelOpen(), closeSub: () => this.closePanels(), notify: (m) => this.toast(m) });
    // HUD boxes never let a touch fall through to the map underneath
    for (const id of ['topbar', 'objectives', 'toasts', 'fab', 'bubble', 'jobs', 'panel', 'hud', 'dock', 'placebar', 'modal']) $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    // the first map touch while a transient window is open only dismisses it (it never also selects units)
    $('game').addEventListener('pointerdown', (e) => { if (this.dismissTransient()) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    this.renderTop();
    this.layout();
  }

  layout() {
    if (this.objOpen === null) this.objOpen = window.innerWidth >= 900 && window.innerHeight >= 560;
    const small = window.innerWidth < 900 || window.innerHeight < 560;
    if (this.bub?.phone) this.g.cam.setInsets(104, 96); else this.g.cam.setInsets(small ? 44 : 60, small ? 120 : 196);
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
      case 'objtoggle': this.objOpen = !this.objOpen; this.lastObj = ''; break;
      case 'objrestore': this.objOpen = true; this.lastObj = ''; break;
      case 'placeb': g.startPlace(arg as BuildingKind); break;
      case 'place-ok': { const err = g.confirmPlace(); if (err) { sfx.error(); this.toast(err, 'bad'); } else { sfx.place(); this.toast('Construction started.', 'good'); } break; }
      case 'place-cancel': g.cancelPlace(); break;
      case 'move': g.mode = g.mode === 'move' ? 'normal' : 'move'; break;
      case 'amove': g.mode = g.mode === 'amove' ? 'normal' : 'amove'; break;
      case 'hold': if (w) cmdHold(w, g.sel); break;
      case 'stop': if (w) cmdStop(w, g.sel); break;
      case 'retreat': if (w) cmdRetreat(w, g.sel); break;
      case 'rally': if (w && g.sel.length) { const l = g.sel.map((i) => w._u?.get(i)).find((u) => u?.kind === 'leader'); if (l) { const r = cmdRally(w, l.id); if (!r.ok) this.toast(r.reason, 'bad'); } } break;
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
      // ---- menus
      case 'settings': this.openSettings(); return;
      case 'quality': setSetting('quality', arg as Quality); this.openSettings(); return;
      case 'toggle': setSetting(arg as 'edgePan' | 'muted' | 'hints', !settings[arg as 'edgePan' | 'muted' | 'hints']); this.openSettings(); this.renderTop(); return;
      case 'play': this.openClan(); return;
      case 'species': this.pickedSpecies = arg as Species; this.openClan(); return;
      case 'start': this.closeModal(); g.startNew(this.pickedSpecies); return;
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
        if (w && advanceGeneration(w, this.pickedSuccessor)) { this.closeModal(); g.clearSelection(); sfx.good(); this.toast('A new generation begins.', 'good'); }
        break;
      }
    }
    this.refresh(true);
  }

  // ------------------------------------------------------------ modals & screens
  private openModal(html: string, kind = '') {
    const m = $('modal'); m.className = kind; m.innerHTML = html;
    this.g.menuOpen = true; this.hideTip();
  }
  closeModal() { $('modal').classList.add('hidden'); this.g.menuOpen = !this.g.world || this.g.showcase; this.refresh(true); }

  openStart() {
    const g = this.g;
    const slot = (s: SaveSlot, label: string) => { const i = g.slotInfo(s); return i.ok ? `<button data-act="continue:${s}" class="tbtn">${icon('load')}<span>${label}<small>${esc(i.text)}</small></span></button>` : ''; };
    this.openModal(`
      <div class="title">
        <div class="logo"><div class="mark">${icon('fire')}</div><h1>LINEAGE</h1><div class="rule"></div><p class="sub">AN EVOLUTION RTS</p></div>
        <div class="tmenu">
          <button data-act="play" class="tbtn primary">${icon('play')}<span>New Campaign<small>The First Winter</small></span></button>
          ${slot('auto', 'Continue')}${slot('manual', 'Load Game')}
          <button data-act="settings" class="tbtn">${icon('sparkle')}<span>Settings</span></button>
          <button data-act="help" class="tbtn">${icon('help')}<span>How to Play</span></button>
        </div>
        <p class="tag">Ancestors discover. Descendants find new uses.</p>
      </div>`, 'titlescreen');
  }

  openClan() {
    const sp = this.pickedSpecies;
    const card = (s: Species, name: string, tag: string, perks: string[]) => `
      <button data-act="species:${s}" class="clancard ${sp === s ? 'on' : ''}">
        ${portrait(s)}<h3>${name}</h3><p class="ctag">${tag}</p>
        <ul>${perks.map((p) => `<li>${icon('check')}${p}</li>`).join('')}</ul>${sp === s ? `<span class="chosen">${icon('check')} Chosen</span>` : ''}
      </button>`;
    this.openModal(`
      <div class="clan">
        <h2>Choose your clan</h2><p class="sub">Your rival will be the ${sp === 'human' ? 'Neanderthals' : 'humans'}. Differences are modest — both can win.</p>
        <div class="clancards">
          ${card('human', 'Humans', 'Wide-ranging foragers', ['Gatherers work 10% faster', 'Quick to adapt to new ground'])}
          ${card('neanderthal', 'Neanderthals', 'Hardy cold-weather hunters', ['Leaders, guards and raiders +15% health', 'Take 35% less cold damage'])}
        </div>
        <div class="row"><button data-act="title" class="btn">${icon('door')}Back</button><button data-act="start" class="btn primary big">${icon('play')}Begin</button></div>
      </div>`, 'titlescreen clanscreen');
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
          <button data-act="settings" class="btn">${icon('sparkle')}<span>Settings</span></button>
          <button data-act="help" class="btn">${icon('help')}<span>How to play</span></button>
          <button data-act="export" class="btn">${icon('export')}<span>Export save</span></button>
          <button data-act="import" class="btn">${icon('import')}<span>Import save</span></button>
          <button data-act="restartask" class="btn">${icon('restart')}<span>Restart</span></button>
          <button data-act="title" class="btn">${icon('door')}<span>Title screen</span></button>
        </div>
      </div>`);
  }

  openSettings() {
    const seg = (q: Quality, label: string) => `<button data-act="quality:${q}" class="btn ${settings.quality === q ? 'primary' : ''}">${label}</button>`;
    const sw = (k: 'edgePan' | 'muted', label: string, inv = false) => `<button data-act="toggle:${k}" class="switch ${(inv ? !settings[k] : settings[k]) ? 'on' : ''}" aria-pressed="${inv ? !settings[k] : settings[k]}"><i></i><span>${label}</span></button>`;
    this.openModal(`
      <div class="dialog">
        <h2>${icon('menu')}Settings</h2>
        <div class="srow"><label>${icon('sound')}Music</label><input type="range" min="0" max="100" value="${Math.round(settings.music * 100)}" data-set="music"><b>${Math.round(settings.music * 100)}</b></div>
        <div class="srow"><label>${icon('build')}Effects</label><input type="range" min="0" max="100" value="${Math.round(settings.sfx * 100)}" data-set="sfx"><b>${Math.round(settings.sfx * 100)}</b></div>
        <div class="srow"><label>${icon('mute')}Sound</label>${sw('muted', settings.muted ? 'Muted' : 'On', true)}</div>
        <div class="srow"><label>${icon('sparkle')}Graphics</label><div class="seg">${seg('auto', 'Auto')}${seg('high', 'High')}${seg('medium', 'Medium')}${seg('low', 'Low')}</div></div>
        <p class="fine">Auto lowers effects automatically if your device struggles. Low turns off shadows and post-processing.</p>
        <div class="srow"><label>${icon('move')}Edge scrolling</label>${sw('edgePan', settings.edgePan ? 'On' : 'Off')}</div>
        <div class="row"><button data-act="${this.g.showcase || !this.g.world ? 'title' : 'menu'}" class="btn primary">${icon('check')}Done</button></div>
      </div>`);
  }

  openHelp() {
    this.openModal(`
      <div class="dialog help">
        <h2>${icon('help')}How to play</h2>
        <div class="hgrid">
          <section><h4>${icon('trophy')}Goal</h4><p>Gather, build, discover <b>smoke preservation</b>, survive the winter, then advance the generation and raise an <b>outpost at the Far Meadow</b> with smoked provisions.</p></section>
          <section><h4>${icon('dragsel')}Touch</h4><ul><li><b>Tap</b> to select; <b>double-tap</b> selects all of a type.</li><li>With units selected, <b>tap the map</b> to move, a tree/berry to gather, an enemy to attack.</li><li><b>Drag</b> pans, <b>pinch</b> zooms. <b>Select</b> button enables box-select.</li><li><b>Build</b>: choose, drag the ghost, tap <b>Place</b>.</li></ul></section>
          <section><h4>${icon('move')}Mouse &amp; keys</h4><ul><li><b>Left-click</b> select, <b>drag</b> box-select, <b>right-click</b> order (or Move/Attack + click).</li><li><b>Wheel</b> zoom · <b>WASD</b>/arrows/edges pan · <b>Space</b> pause.</li><li><b>B</b> build · <b>D</b> discoveries · <b>M A H S R</b> orders · <b>.</b> idle worker · Ctrl+1–9 groups.</li></ul></section>
          <section><h4>${icon('provisions')}Good to know</h4><ul><li>Dotted rings are your <b>supply range</b>; beyond it units burn provisions or take exposure damage.</li><li><b>Teach</b> discoveries at a Teaching circle or they fade at succession.</li><li>Winter spoils loose food and chills units away from warmth.</li><li>A <b>gift</b> of food buys peace with the rival.</li></ul></section>
        </div>
        <div class="row"><button data-act="${this.g.world && !this.g.showcase ? 'resume' : 'title'}" class="btn primary big">${icon('check')}Got it</button></div>
      </div>`);
  }
  showHelpOnce() {
    let seen = false;
    try { seen = localStorage.getItem('lineage-rts:help') === '1'; localStorage.setItem('lineage-rts:help', '1'); } catch { /* ignore */ }
    if (!seen) this.openHelp();
  }

  openSuccession() {
    const w = this.g.world; if (!w) return;
    const c = successorCandidates(w), pre = inheritancePreview(w);
    const nb = w.buildings.filter((b) => b.owner === 0).length;
    const label = { preserved: 'Preserved — inherited intact', faded: 'Faded — relearn at 40% cost', known: 'Known', clue: 'Still a clue', hidden: 'Undiscovered' } as const;
    const tIcon = { logistics: 'provisions', recon: 'scout', teaching: 'knowledge' } as const;
    this.openModal(`
      <div class="dialog wide">
        <h2>${icon('fire')}Pass the fire</h2>
        <p>Winter is over. Your settlement (${nb} buildings), stores and territory carry forward. Elders retire and children grow into gatherers.</p>
        <h4>Inherited knowledge</h4>
        <ul class="inherit">${pre.map((r) => `<li class="${r.to}">${icon(DISC_ICON[r.id])}<b>${DISCOVERIES[r.id].name}</b><span>${label[r.to as keyof typeof label]}</span></li>`).join('')}</ul>
        <p class="fine">Discoveries you did not teach at a Teaching circle fade with their discoverers.</p>
        <h4>Choose your successor</h4>
        <div class="succ">${c.map((s, i) => `<button data-act="pick:${i}" class="scard ${i === this.pickedSuccessor ? 'on' : ''}">${icon(tIcon[s.trait])}<b>${s.name}</b><small>${s.note}</small></button>`).join('')}</div>
        <div class="row"><button data-act="resume" class="btn">Not yet</button><button data-act="succeed" class="btn primary big">${icon('play')}Begin generation II</button></div>
      </div>`);
  }

  showEnd() {
    const w = this.g.world; if (!w) return;
    const won = w.status === 'won';
    won ? sfx.win() : sfx.lose();
    this.openModal(`
      <div class="dialog end ${won ? 'won' : 'lost'}">
        <div class="medal">${icon(won ? 'trophy' : 'skull')}</div>
        <h1 class="${won ? 'win' : 'lose'}">${won ? 'Victory' : 'Defeat'}</h1>
        <p>${esc(w.endMsg)}</p>
        <div class="stats"><div><b>${fmtTime(w.time)}</b><small>Time</small></div><div><b>${ROMAN[w.gen]}</b><small>Generation</small></div><div><b>${w.stats.lost}</b><small>Clan lost</small></div><div><b>${w.stats.kills}</b><small>Rivals defeated</small></div></div>
        <p class="lineage">${w.lineage.map((l) => esc(l.name)).join(' → ')}</p>
        <div class="row"><button data-act="restart" class="btn primary big">${icon('restart')}Play again</button><button data-act="title" class="btn">${icon('door')}Title screen</button></div>
      </div>`);
  }

  // ------------------------------------------------------------ periodic refresh
  refresh(force = false) {
    if (force) { this.lastTick = 0; this.lastCmds = ''; this.lastChips = ''; this.lastObj = ''; this.lastPanel = ''; this.lastSel = ''; this.lastDock = ''; this.lastClock = ''; }
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
    this.bub.update(this.g.liveSel().length > 0 || this.g.selB !== null);
    if (++this.placeN % 25 === 0) this.bub.place();
    $('app').style.setProperty('--lane', `${$('toasts').offsetHeight}px`);
    this.renderPanel(); this.renderJobs(w); this.renderPlaceBar(); this.processLog(w);
    if (canSucceed(w) && !this.springToast) { this.springToast = true; this.toast('Spring has come. Open the objectives to advance the generation.', 'good'); sfx.good(); }
    if (!canSucceed(w)) this.springToast = w.gen > 1 || (this.springToast && w.time >= w.winter.end);
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
      return `<div class="plate ${r} ${cls} ${low}" data-tip="${esc(JSON.stringify({ t: label, d: { food: 'Feeds the clan. Loose food rots in winter.', wood: 'Buildings, tools and fuel.', stone: 'Tools, weapons and construction.', knowledge: 'From the hearth, teaching circle and exploration. Fuels discoveries.', provisions: 'Smoked food that never spoils. Feeds expeditions beyond supply range.' }[r] ?? '' }))}">${icon(r)}<b>${n}</b>${extra}</div>`;
    };
    const cap = popCap(w), pop = popCount(w);
    const popPlate = `<div class="plate pop ${pop >= cap ? 'low' : ''}" data-tip="${esc(JSON.stringify({ t: 'Population', d: 'Clan members / housing. Build shelters to grow.' }))}">${icon('pop')}<b>${pop}<i>/${cap}</i></b></div>`;
    const html = plate('food', 'Food', w.res.food) + plate('wood', 'Wood', w.res.wood) + plate('stone', 'Stone', w.res.stone) + plate('knowledge', 'Knowledge', w.res.knowledge) +
      (w.res.provisions > 0 || hasDisc(w, 'preservation') ? plate('provisions', 'Provisions', w.res.provisions) : '') + popPlate;
    if (html !== this.lastChips) { $('chips').innerHTML = html; this.lastChips = html; }
  }

  private renderClock(w: World) {
    const winter = isWinter(w), before = w.time < w.winter.start;
    const season = winter ? 'Winter' : before ? (w.gen === 1 ? 'Autumn' : 'Summer') : 'Spring';
    const sIcon = winter ? 'snow' : before ? (w.gen === 1 ? 'leaf' : 'sun') : 'sun';
    const left = winter ? `Spring in ${fmtTime(w.winter.end - w.time)}` : before ? `Winter in ${fmtTime(w.winter.start - w.time)}` : 'Winter has passed';
    const d0 = w.winter.start - 420, d1 = w.winter.end + 60, f = (t: number) => Math.max(0, Math.min(100, ((t - d0) / (d1 - d0)) * 100));
    const html = `<div class="medal ${winter ? 'cold' : ''}">${icon(sIcon)}</div>
      <div class="ctxt"><b>${season}</b><small>${left}</small></div>
      <div class="gen"><small>GENERATION</small><b>${ROMAN[w.gen]}</b></div>
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
      if (!w.landmarks[0].visited) return 'Send your scout north-west to the Ember Cave for a clue about carrying fire.';
      if (hasDisc(w, 'preservation') && !has('rack')) return 'Build a Smoking rack. It turns food into provisions that never spoil.';
      if (has('rack') && !has('circle')) return 'Build a Teaching circle, then teach your discoveries so your descendants keep them.';
      if (w.time > w.winter.start - 60 && w.time < w.winter.start) return 'Winter is near: smoke food, build shelters and stay close to warmth.';
      if (isWinter(w)) return 'Winter: loose food rots and cold hurts units away from hearth and shelters.';
      return 'Train hunters and guards at a Hunting lodge to protect your workers.';
    }
    if (w.res.provisions < OUTPOST_REQUIRE) return `Smoke more food: you need ${OUTPOST_REQUIRE} provisions to supply an expedition.`;
    return 'Scout the north-east. Build a Watch post at the Far Meadow (the north ford is the quiet route). Keep gatherers supplied.';
  }

  private renderObjectives(w: World) {
    const list = objectiveList(w), cur = list.findIndex((o) => !o.done), open = !!this.objOpen, succ = canSucceed(w), hint = this.hint(w);
    const done = list.filter((o) => o.done).length;
    const html = `<div class="oh" data-act="objtoggle">${icon('trophy')}<div><b>${w.gen === 1 ? 'The First Winter' : 'The Far Meadow'}</b><small>${done}/${list.length} objectives</small></div>${icon(open ? 'chevd' : 'chevr', 'chev')}</div>` +
      (open ? `<ul>${list.map((o, i) => `<li class="${o.done ? 'done' : i === cur ? 'cur' : ''}"><span class="ob">${o.done ? icon('check') : ''}</span>${esc(o.text)}</li>`).join('')}</ul>` : `<div class="one">${cur >= 0 ? esc(list[cur].text) : 'Objectives complete'}</div>`) +
      (hint && open ? `<p class="hint">${icon('bulb')}<span>${esc(hint)}</span></p>` : '') +
      (succ ? `<button data-act="succession" class="btn primary pulse">${icon('fire')}Advance generation</button>` : '');
    $('opill').innerHTML = `${icon('trophy')}<b>${done}/${list.length}</b>${succ ? '<i class="badge">!</i>' : ''}`;
    if (html !== this.lastObj) { $('obody').innerHTML = html; this.lastObj = html; }
  }

  // ------------------------------------------------------------ dock (global tools)
  private renderDock(w: World) {
    const g = this.g;
    const clueReady = DISC_ORDER.some((id) => w.disc[id] === 'clue' || w.disc[id] === 'faded' || (w.disc[id] === 'known' && w.buildings.some((b) => b.owner === 0 && b.kind === 'circle' && b.done)));
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
      dk('gift', 'gift', w.time < w.truceUntil ? fmtTime(w.truceUntil - w.time) : 'Gift', 'Give the rival clan 40 food for three minutes of peace and an open pass.');
    if (html !== this.lastDock) { $('dock').innerHTML = html; this.lastDock = html; }
  }

  // ------------------------------------------------------------ selection panel
  private renderSelection(w: World) {
    const g = this.g, ids = g.liveSel();
    let html = '';
    if (ids.length) {
      const us = ids.map((i) => w._u!.get(i)!).filter(Boolean);
      if (us.length === 1) {
        const u = us[0], d = UNITS[u.kind], o = u.order;
        const doing = o.t === 'gather' ? `Gathering ${nodeById(w, o.node)?.res ?? ''}` : o.t === 'idle' ? 'Idle' : o.t === 'research' ? 'Researching' : o.t === 'build' ? 'Building' : o.t === 'attack' ? 'Fighting' : o.t === 'move' ? 'Moving' : o.t === 'amove' ? 'Attack-moving' : o.t === 'hold' ? 'Holding' : o.t;
        const pct = Math.max(0, u.hp / u.maxHp) * 100;
        html = `<div class="sp"><div class="pf">${icon(KIND_ICON[u.kind])}</div>
          <div class="si"><h3>${esc(u.name)}<small>${['', 'Veteran ', 'Elite '][rankOf(u)]}${d.name}${u.gen > 1 ? ' · Gen ' + ROMAN[u.gen] : ''}${u.kills ? ` · ${u.kills} kills` : ''}</small><button class="mini clr" data-act="desel" aria-label="Deselect">${icon('close')}</button></h3>
          <div class="hp ${pct < 35 ? 'low' : ''}"><i style="width:${pct}%"></i><span>${icon('heart')}${Math.ceil(u.hp)} / ${u.maxHp}</span></div>
          <div class="stats"><span>${icon('attack')}${d.dmg}</span><span>${icon('move')}${d.speed.toFixed(1)}</span>${u.carry.n ? `<span>${icon(u.carry.res!)}${u.carry.n}</span>` : ''}<span class="st">${doing}</span></div>
          <p class="desc">${esc(d.desc)}</p></div></div>`;
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
    let h = '';
    if (ids.length) {
      const us = ids.map((i) => w._u!.get(i)!).filter(Boolean);
      h += cbtn({ act: 'move', ic: 'move', label: 'Move', key: 'M', on: g.mode === 'move', tip: { t: 'Move', d: 'Then tap the destination. You can also right-click or just tap.' } });
      if (us.some((u) => UNITS[u.kind].dmg > 3 || u.kind === 'hunter')) h += cbtn({ act: 'amove', ic: 'attack', label: 'Attack', key: 'A', on: g.mode === 'amove', tip: { t: 'Attack-move', d: 'Advance and engage anything on the way.' } });
      h += cbtn({ act: 'hold', ic: 'hold', label: 'Hold', key: 'H', tip: { t: 'Hold position', d: 'Stand still and only attack what comes in range.' } });
      h += cbtn({ act: 'stop', ic: 'stop', label: 'Stop', key: 'S', tip: { t: 'Stop', d: 'Cancel current orders.' } });
      h += cbtn({ act: 'retreat', ic: 'retreat', label: 'Retreat', key: 'R', tip: { t: 'Retreat', d: 'Fall back to the clan hearth.' } });
      const l = us.find((u) => u.kind === 'leader');
      if (l) h += cbtn({ act: 'rally', ic: 'rally', label: 'Rally', cls: 'gold', why: l.ability > 0 ? `Rally ready in ${Math.ceil(l.ability)}s.` : undefined, badge: l.ability > 0 ? `${Math.ceil(l.ability)}` : undefined, tip: { t: 'Rally', d: 'Heal nearby allies by 20% and boost their speed and damage for 8 seconds. 45s cooldown.' } });
      if (us.some((u) => u.kind === 'gatherer')) h += cbtn({ act: 'build', ic: 'build', label: 'Build', key: 'B', tip: { t: 'Build', d: 'Open the construction menu. Selected gatherers will build.' } });
    } else if (g.selB !== null && w._b?.get(g.selB)) {
      const b = w._b.get(g.selB)!, d = BUILDINGS[b.kind];
      if (b.done) {
        for (const k of d.trains) {
          const ud = UNITS[k as UnitKind], c = trainCheck(w, b.id, k as UnitKind);
          if (ud.only && ud.only !== w.species) continue;
          h += cbtn({ act: `train:${k}`, ic: KIND_ICON[k], label: ud.name, cost: ud.cost, w, why: c.ok ? undefined : c.reason, tip: { t: ud.name, d: ud.desc, cost: ud.cost } });
        }
        const up = nextUpgrade(b);
        if (b.upg) h += cbtn({ act: 'cancelupg', ic: 'close', label: 'Cancel', tip: { t: 'Cancel upgrade', d: '75% of the cost is refunded.' } });
        else if (up) { const c = upgradeCheck(w, b.id); h += cbtn({ act: 'upgrade', ic: 'upgrade', label: up.name, cost: up.cost, w, cls: 'gold', why: c.ok ? undefined : c.reason, tip: { t: `Upgrade: ${up.name}`, d: up.desc, cost: up.cost } }); }
        if (b.research) h += cbtn({ act: 'cancelres', ic: 'close', label: 'Cancel', tip: { t: 'Cancel research', d: '75% of the cost is refunded.' } });
        else for (const t of techsFor(b.kind)) {
          if (hasTech(w, t.id)) continue;
          const c = researchCheck(w, b.id, t.id);
          h += cbtn({ act: `research:${t.id}`, ic: 'tech', label: t.name, cost: t.cost, w, why: c.ok ? undefined : c.reason, tip: { t: t.name, d: t.desc, cost: t.cost } });
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
      : this.discPanel();
    const html = `<div class="sheet"><button data-act="closepanel" class="xbtn" aria-label="Close">${icon('close')}</button>${body}</div>`;
    if (force || html !== this.lastPanel) { el.innerHTML = html; this.lastPanel = html; }
    el.classList.remove('hidden');
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
            body += `<p class="fine">Only the discoverers know this. Teach apprentices so it survives succession.</p>` + (act ? this.prog(act.progress / act.total, 'Teaching…') : `<button data-act="teach:${id}" class="btn ${c.ok ? 'primary' : 'dis'}" ${c.ok ? '' : `data-why="${esc(c.reason)}"`}>${icon('knowledge')}Teach apprentices <span class="cr">${chips({ knowledge: 10 }, w)}</span></button>`);
          } else body += `<p class="good">${icon('check')}Preserved — inherited by descendants.</p>`;
        } else if (act) body += this.prog(act.progress / act.total, 'Investigating…');
        else {
          const c = investigateCheck(w, id), cost = discCost(w, id);
          const m = st === 'faded' ? '<p class="fine">Forgotten with the ancestors, but clues remain: 60% cheaper.</p>' : w.gen >= 2 && d.parent && w.disc[d.parent] === 'preserved' ? '<p class="fine">Inherited expertise: 30% cheaper and faster.</p>' : '';
          body += `${m}<div class="need"><span>Needs ${d.needs.map((n) => BUILDINGS[n].name).join(' + ')}</span><span class="cr">${chips(cost, w)}</span><span>${icon('clock')}${Math.round(discTime(w, id))}s</span></div><button data-act="inv:${id}" class="btn ${c.ok ? 'primary' : 'dis'}" ${c.ok ? '' : `data-why="${esc(c.reason)}"`}>${icon('discover')}${st === 'faded' ? 'Relearn' : 'Investigate'}</button>${c.ok ? '' : `<p class="why">${esc(c.reason)}</p>`}`;
        }
      }
      return `<div class="disc s-${st} ${sub ? 'sub' : ''}"><div class="dh"><div class="dic">${icon(DISC_ICON[id])}</div><div><h4>${d.name}${d.later ? ' <small>later generation</small>' : ''}</h4><span class="status">${status}</span></div></div><div class="pips">${pips}</div>${body}</div>`;
    };
    const lin = w.lineage.map((l) => `${esc(l.name)} <small>gen ${ROMAN[l.gen]}${l.trait ? ' · ' + esc(l.trait) : ''}</small>`).join(' → ');
    return `<h3>${icon('discover')}Discoveries</h3>
      <div class="tree"><div class="root">${icon('fire')}<b>Maintain fire</b><small>Inherited from your ancestors</small></div>
      <div class="branches">${card('cooking')}${card('preservation')}${card('portable')}${card('heat', true)}</div></div>
      <p class="fine lin">Lineage: ${lin}</p>`;
  }

  private prog(f: number, label: string) {
    return `<div class="prog"><div style="width:${Math.round(f * 100)}%"></div><span>${label} ${Math.round(f * 100)}%</span></div>`;
  }
}
