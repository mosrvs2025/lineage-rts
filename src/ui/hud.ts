import { BUILDINGS, BUILD_ORDER } from '../data/buildings';
import { DISCOVERIES, DISC_ORDER } from '../data/discoveries';
import { UNITS } from '../data/units';
import {
  cmdCancelSite, cmdGift, cmdHold, cmdInvestigate, cmdJob, cmdRally, cmdRetreat, cmdStop, cmdTeach, cmdTrain, jobCounts, trainCheck,
} from '../sim/commands';
import { discCost, discTime, investigateCheck, teachCheck } from '../sim/discovery';
import { objectiveList } from '../sim/objectives';
import { hasDisc, popCap, popCount } from '../sim/rules';
import { advanceGeneration, canSucceed, inheritancePreview, successorCandidates } from '../sim/succession';
import type { BuildingKind, DiscoveryId, Res, UnitKind } from '../sim/types';
import { bCenter, fmtTime, isWinter, nodeById } from '../sim/util';
import { OUTPOST_REQUIRE } from '../sim/world';
import type { Game, SaveSlot } from './game';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

type PanelId = 'build' | 'disc' | null;

function costStr(cost: Partial<Record<string, number>>): string {
  const parts = Object.entries(cost).filter(([, v]) => v).map(([k, v]) => `<span class="c-${k}">${v} ${k}</span>`);
  return parts.length ? parts.join(' · ') : '<span class="c-free">free</span>';
}

export class Hud {
  private panel: PanelId = null;
  private lastChips = ''; private lastCmds = ''; private lastObj = ''; private lastPanel = ''; private lastJobs = '';
  private lastLog = ''; private lastTick = 0; private jobsOpen = false; private objOpen: boolean | null = null;
  private springToast = false; private lastSpeed = 1;
  private pickedSuccessor = 0; private pickedSpecies: 'human' | 'neanderthal' = 'human';

  constructor(private g: Game) {
    $('app').addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      if (t.dataset.why) { this.toast(t.dataset.why, 'bad'); return; }
      this.act(t.dataset.act!);
    });
    $<HTMLInputElement>('importfile').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const err = this.g.loadText(await f.text());
      (e.target as HTMLInputElement).value = '';
      if (err) this.toast(`Import failed: ${err}`, 'bad'); else { this.closeModal(); this.toast('Save imported.', 'good'); }
    });
    this.layout();
  }

  layout() {
    if (this.objOpen === null) this.objOpen = window.innerWidth >= 760 && window.innerHeight >= 520;
    const small = window.innerWidth < 760 || window.innerHeight < 520;
    this.g.cam.setInsets(small ? 40 : 56, small ? 96 : 104);
  }

  // ------------------------------------------------------------ small helpers
  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`; el.textContent = text;
    const box = $('toasts'); box.appendChild(el);
    while (box.children.length > 4) box.firstChild!.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }
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
      case 'menu': this.openMenu(); break;
      case 'build': this.togglePanel('build'); break;
      case 'disc': this.togglePanel('disc'); break;
      case 'closepanel': this.closePanels(); break;
      case 'jobs': this.panel = null; this.renderPanel(true); this.jobsOpen = !this.jobsOpen; this.lastJobs = ''; $('jobs').classList.toggle('hidden', !this.jobsOpen); break;
      case 'objtoggle': this.objOpen = !this.objOpen; this.lastObj = ''; break;
      case 'placeb': g.startPlace(arg as BuildingKind); break;
      case 'place-ok': { const err = g.confirmPlace(); if (err) this.toast(err, 'bad'); else this.toast('Construction started.', 'good'); break; }
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
        const army = w.units.filter((u) => u.owner === 0 && ['hunter', 'guard', 'raider', 'leader', 'scout'].includes(u.kind));
        if (!army.length) { this.toast('No scouts or fighters yet.'); break; }
        g.selectUnits(army.map((u) => u.id)); break;
      }
      case 'train': {
        if (!w || g.selB === null) break;
        const r = cmdTrain(w, g.selB, arg as UnitKind); if (!r.ok) this.toast(r.reason, 'bad'); break;
      }
      case 'cancelsite': if (w && g.selB !== null) { cmdCancelSite(w, g.selB); g.clearSelection(); this.toast('Construction cancelled (75% refunded).'); } break;
      case 'gift': { if (!w) break; const r = cmdGift(w); if (!r.ok) this.toast(r.reason, 'bad'); break; }
      case 'inv': { if (!w) break; const r = cmdInvestigate(w, arg as DiscoveryId); if (!r.ok) this.toast(r.reason, 'bad'); else this.toast('A gatherer begins investigating.', 'good'); break; }
      case 'teach': { if (!w) break; const r = cmdTeach(w, arg as DiscoveryId); if (!r.ok) this.toast(r.reason, 'bad'); else this.toast('An apprentice begins to learn.', 'good'); break; }
      case 'job': { if (!w) break; const r = cmdJob(w, arg as Res); if (!r.ok) this.toast(r.reason, 'bad'); break; }
      // ---- modals
      case 'species': this.pickedSpecies = arg as 'human' | 'neanderthal'; this.openStart(); return;
      case 'start': this.closeModal(); g.startNew(this.pickedSpecies); return;
      case 'continue': { const err = g.load(arg as SaveSlot); if (err) this.toast(err, 'bad'); else this.closeModal(); return; }
      case 'resume': this.closeModal(); break;
      case 'save': { const ok = g.save('manual'); this.toast(ok ? 'Game saved.' : 'Could not save (browser storage unavailable).', ok ? 'good' : 'bad'); this.openMenu(); return; }
      case 'export': g.exportSave(); break;
      case 'import': $('importfile').click(); break;
      case 'restartask': this.openModal(`<h2>Restart scenario?</h2><p>Your current progress will be lost (saves are kept).</p><div class="row"><button data-act="restart">Restart</button><button data-act="menu" class="alt">Back</button></div>`); return;
      case 'restart': this.closeModal(); g.restart(); return;
      case 'title': this.openStart(); return;
      case 'help': this.openHelp(); return;
      case 'succession': this.openSuccession(); return;
      case 'pick': this.pickedSuccessor = Number(arg); this.openSuccession(); return;
      case 'succeed': {
        if (w && advanceGeneration(w, this.pickedSuccessor)) { this.closeModal(); g.clearSelection(); this.toast('A new generation begins.', 'good'); }
        break;
      }
    }
    this.refresh(true);
  }

  // ------------------------------------------------------------ modals
  private openModal(html: string) {
    const m = $('modal'); m.innerHTML = `<div class="dialog">${html}</div>`; m.classList.remove('hidden');
    this.g.menuOpen = true;
  }
  closeModal() { $('modal').classList.add('hidden'); this.g.menuOpen = !this.g.world; this.refresh(true); }

  openStart() {
    const g = this.g;
    const slot = (s: SaveSlot, label: string) => { const i = g.slotInfo(s); return i.ok ? `<button data-act="continue:${s}" class="alt">${label}<small>${esc(i.text)}</small></button>` : ''; };
    const sp = this.pickedSpecies;
    this.openModal(`
      <h1>LINEAGE</h1>
      <p class="tag">An evolution RTS. Ancestors discover. Descendants find new uses.</p>
      <h3>The First Winter</h3>
      <p>Lead a small clan beside the river. Learn to preserve food before winter, protect your supplies from wolves and a rival clan, then pass the fire to the next generation and raise an outpost beyond the valley.</p>
      <div class="species">
        <button data-act="species:human" class="${sp === 'human' ? 'on' : ''}"><b>Humans</b><small>Gatherers work 10% faster.</small></button>
        <button data-act="species:neanderthal" class="${sp === 'neanderthal' ? 'on' : ''}"><b>Neanderthals</b><small>Leaders, guards and raiders +15% health; suffer 35% less cold damage.</small></button>
      </div>
      <div class="row"><button data-act="start" class="primary">Begin</button>${slot('auto', 'Continue autosave')}${slot('manual', 'Load saved game')}<button data-act="help" class="alt">How to play</button></div>
      <p class="fine">Playable with mouse or touch. Your rival clan is the ${sp === 'human' ? 'Neanderthals' : 'humans'}.</p>`);
  }

  openMenu() {
    const g = this.g;
    const info = (s: SaveSlot) => { const i = g.slotInfo(s); return i.ok ? `<small>${esc(i.text)}</small>` : `<small>${esc(i.text)}</small>`; };
    this.openModal(`
      <h2>Paused</h2>
      <div class="menu">
        <button data-act="resume" class="primary">Resume</button>
        <button data-act="save">Save game${info('manual')}</button>
        <button data-act="continue:manual" class="alt">Load saved game</button>
        <button data-act="continue:auto" class="alt">Load autosave${info('auto')}</button>
        <button data-act="export" class="alt">Export save file</button>
        <button data-act="import" class="alt">Import save file</button>
        <button data-act="help" class="alt">How to play</button>
        <button data-act="restartask" class="alt">Restart scenario</button>
        <button data-act="title" class="alt">Title screen</button>
      </div>`);
  }

  openHelp() {
    this.openModal(`
      <h2>How to play</h2>
      <div class="help">
        <h4>Goal</h4>
        <p>Gather food and wood, build, discover <b>smoke preservation</b>, survive the winter, then advance the generation and raise an <b>outpost at the Far Meadow</b> using smoked provisions.</p>
        <h4>Touch</h4>
        <ul><li><b>Tap</b> a unit or building to select. <b>Double-tap</b> selects all of that type on screen.</li>
        <li>With units selected, <b>tap the map</b>: move; tap a tree/berry/rock: gather; tap an enemy: attack; tap a building site: build.</li>
        <li><b>Drag</b> pans. <b>Pinch</b> zooms. Turn on <b>Drag-select</b> to box-select.</li>
        <li><b>Build</b>: pick a building, drag to position it, then tap <b>Place</b>.</li></ul>
        <h4>Mouse &amp; keyboard</h4>
        <ul><li><b>Left-click</b> selects; <b>drag</b> box-selects; <b>right-click</b> orders (or use the Move/Attack buttons then left-click).</li>
        <li><b>Wheel</b> zooms. <b>WASD</b>/arrows/screen edge pan. <b>Space</b> pause. <b>B</b> build. <b>D</b> discoveries. <b>A</b>ttack-move, <b>M</b>ove, <b>H</b>old, <b>S</b>top, <b>R</b>etreat, <b>.</b> idle gatherer. Ctrl+1-9 sets control groups.</li></ul>
        <h4>Good to know</h4>
        <ul><li>Dotted rings show your <b>supply range</b>. Beyond it, units burn <b>provisions</b> (smoked food) or take exposure damage.</li>
        <li>Discoveries need a <b>clue</b>, the right <b>buildings</b> and resources. <b>Teach</b> them at a Teaching circle or they fade at succession.</li>
        <li>In winter loose food rots and units outside warmth (hearth, shelters) take cold damage.</li>
        <li>A <b>gift</b> of food buys a few minutes of peace with the rival clan.</li></ul>
      </div>
      <div class="row"><button data-act="${this.g.world ? 'resume' : 'title'}" class="primary">Got it</button></div>`);
  }
  showHelpOnce() {
    let seen = false;
    try { seen = localStorage.getItem('lineage-rts:help') === '1'; localStorage.setItem('lineage-rts:help', '1'); } catch { /* ignore */ }
    if (!seen) { this.openHelp(); }
  }

  openSuccession() {
    const w = this.g.world; if (!w) return;
    const c = successorCandidates(w), pre = inheritancePreview(w);
    const nb = w.buildings.filter((b) => b.owner === 0).length;
    const label = { preserved: 'Preserved — inherited intact', faded: 'Faded — remembered clue, relearn at 40% cost', known: 'Known', clue: 'Still a clue', hidden: 'Undiscovered' } as const;
    this.openModal(`
      <h2>Pass the fire</h2>
      <p>Winter is over. Your settlement (${nb} buildings), stores and territory carry forward. Elders retire and children grow into gatherers.</p>
      <h4>Inherited knowledge</h4>
      <ul class="inherit">${pre.map((r) => `<li class="${r.to}"><b>${DISCOVERIES[r.id].name}</b> <span>${label[r.to as keyof typeof label]}</span></li>`).join('')}</ul>
      <p class="fine">Discoveries you did not teach at a Teaching circle fade with their discoverers.</p>
      <h4>Choose your successor</h4>
      <div class="succ">${c.map((s, i) => `<button data-act="pick:${i}" class="${i === this.pickedSuccessor ? 'on' : ''}"><b>${s.name}</b><small>${s.note}</small></button>`).join('')}</div>
      <div class="row"><button data-act="succeed" class="primary">Begin generation 2</button><button data-act="resume" class="alt">Not yet</button></div>`);
  }

  showEnd() {
    const w = this.g.world; if (!w) return;
    const won = w.status === 'won';
    this.openModal(`
      <h1 class="${won ? 'win' : 'lose'}">${won ? 'Victory' : 'Defeat'}</h1>
      <p>${esc(w.endMsg)}</p>
      <ul class="stats"><li>Time <b>${fmtTime(w.time)}</b></li><li>Generation <b>${w.gen}</b></li><li>Lost <b>${w.stats.lost}</b></li><li>Rivals defeated <b>${w.stats.kills}</b></li>
      <li>Lineage <b>${w.lineage.map((l) => l.name).join(' → ')}</b></li></ul>
      <div class="row"><button data-act="restart" class="primary">Play again</button><button data-act="title" class="alt">Title screen</button></div>`);
  }

  // ------------------------------------------------------------ periodic refresh
  refresh(force = false) {
    if (force) { this.lastTick = 0; this.lastCmds = ''; this.lastChips = ''; this.lastObj = ''; this.lastPanel = ''; }
  }

  tick(now: number) {
    if (now - this.lastTick < 180) return;
    this.lastTick = now;
    const w = this.g.world; if (!w) return;
    this.renderChips(); this.renderObjectives(); this.renderBottom(); this.renderPanel(); this.renderJobs(); this.renderPlaceBar(); this.processLog();
    $('b-pause').textContent = this.g.speed === 0 ? '▶' : 'II';
    $('b-speed').textContent = `${this.g.speed || this.lastSpeed}x`;
    if (canSucceed(w) && !this.springToast) { this.springToast = true; this.toast('Spring has come. Open the objectives to advance the generation.', 'good'); }
    if (!canSucceed(w)) this.springToast = w.gen > 1 || this.springToast && w.time >= w.winter.end;
  }

  private processLog() {
    const w = this.g.world!;
    const key = (l: { t: number; text: string }) => `${l.t}|${l.text}`;
    const idx = this.lastLog ? w.log.findIndex((l) => key(l) === this.lastLog) : -1;
    const fresh = idx >= 0 ? w.log.slice(idx + 1) : this.lastLog ? w.log.slice(-3) : [];
    for (const l of fresh) this.toast(l.text, l.kind);
    if (w.log.length) this.lastLog = key(w.log[w.log.length - 1]);
  }

  private renderChips() {
    const w = this.g.world!;
    const winter = isWinter(w);
    const season = winter ? 'Winter' : w.time < w.winter.start ? (w.gen === 1 ? 'Autumn' : 'Summer') : 'Spring';
    const left = winter ? `spring in ${fmtTime(w.winter.end - w.time)}` : w.time < w.winter.start ? `winter in ${fmtTime(w.winter.start - w.time)}` : '';
    const chip = (cls: string, label: string, val: string, title = '') => `<span class="chip" title="${title}"><i class="dot ${cls}"></i><small>${label}</small><b>${val}</b></span>`;
    const prov = w.res.provisions > 0 || hasDisc(w, 'preservation');
    const html =
      chip('food', 'Food', String(Math.floor(w.res.food)), 'Food: feeds the clan; rots in winter') +
      chip('wood', 'Wood', String(Math.floor(w.res.wood))) +
      chip('stone', 'Stone', String(Math.floor(w.res.stone))) +
      chip('know', 'Knowledge', String(Math.floor(w.res.knowledge)), 'Knowledge: from the hearth, teaching circle and exploration') +
      (prov ? chip('prov', 'Provisions', String(Math.floor(w.res.provisions)), 'Smoked food: never spoils; feeds expeditions') : '') +
      chip('pop', 'Pop', `${popCount(w)}/${popCap(w)}`) +
      `<span class="chip time ${winter ? 'cold' : ''}"><small>Gen ${w.gen}</small><b>${season}</b><small>${left} · ${fmtTime(w.time)}</small></span>`;
    if (html !== this.lastChips) { $('chips').innerHTML = html; this.lastChips = html; }
  }

  private hint(): string {
    const w = this.g.world!;
    const has = (k: string) => w.buildings.some((b) => b.owner === 0 && b.kind === k && b.done);
    if (w.status !== 'playing') return '';
    if (w.gen === 1) {
      if (w.stats.food < 1 && w.time < 120) return 'Tap a gatherer, then tap a berry bush or tree to put them to work. Use Jobs to rebalance.';
      if (canSucceed(w)) return 'Spring has come — advance the generation below.';
      if (!has('stockpile')) return 'Build a Stockpile near the trees so gatherers walk less (Build).';
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

  private renderObjectives() {
    const w = this.g.world!;
    const list = objectiveList(w);
    const cur = list.findIndex((o) => !o.done);
    const open = !!this.objOpen;
    const succ = canSucceed(w);
    const hint = this.hint();
    const html = `<div class="oh" data-act="objtoggle"><b>${w.gen === 1 ? 'The First Winter' : 'The Far Meadow'}</b><small>${open ? '▾' : '▸'}</small></div>` +
      (open ? `<ul>${list.map((o, i) => `<li class="${o.done ? 'done' : i === cur ? 'cur' : ''}">${o.done ? '✓' : '○'} ${esc(o.text)}</li>`).join('')}</ul>` : `<div class="one">${cur >= 0 ? esc(list[cur].text) : 'Objectives complete'}</div>`) +
      (hint && open ? `<p class="hint">${esc(hint)}</p>` : '') +
      (succ ? `<button data-act="succession" class="primary pulse">Advance generation</button>` : '');
    if (html !== this.lastObj) { $('objectives').innerHTML = html; this.lastObj = html; }
  }

  private renderJobs() {
    const w = this.g.world!;
    if (!this.jobsOpen) return;
    const c = jobCounts(w);
    const row = (r: Res, label: string) => `<div class="jrow"><span>${label}</span><b>${c[r]}</b><button data-act="job:${r}" aria-label="Add worker to ${label}">+</button></div>`;
    const html = `<h4>Gatherer jobs</h4>${row('food', 'Food')}${row('wood', 'Wood')}${row('stone', 'Stone')}<div class="jrow"><span>Idle</span><b>${c.idle}</b><button data-act="idle">Select</button></div><div class="jrow"><span>Building / researching</span><b>${c.build}</b><span></span></div><p class="fine">+ moves an idle gatherer (or one from another job) here.</p>`;
    if (html !== this.lastJobs) { $('jobs').innerHTML = html; this.lastJobs = html; }
  }

  private renderPlaceBar() {
    const g = this.g, el = $('placebar');
    if (g.mode !== 'place' || !g.place) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const d = BUILDINGS[g.place.kind];
    const ok = g.canPlaceNow();
    const html = `<span><b>${d.name}</b> · ${costStr(d.cost)}</span><button data-act="place-ok" class="primary" ${ok ? '' : 'data-dim="1"'}>Place</button><button data-act="place-cancel" class="alt">Cancel</button>`;
    if (el.dataset.h !== html) { el.innerHTML = html; el.dataset.h = html; }
  }

  // ------------------------------------------------------------ bottom bar
  private btn(act: string, label: string, opts: { sub?: string; why?: string; on?: boolean; badge?: string; cls?: string } = {}) {
    return `<button data-act="${act}" class="${opts.cls ?? ''} ${opts.on ? 'on' : ''} ${opts.why ? 'dis' : ''}" ${opts.why ? `data-why="${esc(opts.why)}"` : ''}>${label}${opts.sub ? `<small>${opts.sub}</small>` : ''}${opts.badge ? `<i class="badge">${opts.badge}</i>` : ''}</button>`;
  }

  private renderBottom() {
    const g = this.g, w = g.world!;
    const ids = g.liveSel();
    let info = '', ctx = '';
    if (ids.length) {
      const us = ids.map((i) => w._u!.get(i)!).filter(Boolean);
      const one = us.length === 1 ? us[0] : null;
      if (one) {
        const d = UNITS[one.kind];
        const o = one.order;
        const doing = o.t === 'gather' ? `gathering ${nodeById(w, o.node)?.res ?? ''}` : o.t === 'idle' ? 'idle' : o.t === 'research' ? 'researching' : o.t === 'build' ? 'building' : o.t === 'attack' ? 'fighting' : o.t;
        info = `<b>${one.name}</b> the ${d.name.toLowerCase()} · HP ${Math.ceil(one.hp)}/${one.maxHp} · ${doing}${one.carry.n ? ` · carrying ${one.carry.n} ${one.carry.res}` : ''}${one.gen > 1 ? ' · gen ' + one.gen : ''}`;
      } else {
        const counts: Record<string, number> = {}; for (const u of us) counts[u.kind] = (counts[u.kind] ?? 0) + 1;
        info = `<b>${us.length} selected</b>: ${Object.entries(counts).map(([k, n]) => `${UNITS[k as UnitKind].name} ×${n}`).join(', ')}`;
      }
      ctx += this.btn('move', 'Move', { on: g.mode === 'move', sub: 'M' });
      if (us.some((u) => UNITS[u.kind].dmg > 3 || u.kind === 'hunter')) ctx += this.btn('amove', 'Attack', { on: g.mode === 'amove', sub: 'A' });
      ctx += this.btn('hold', 'Hold', { sub: 'H' }) + this.btn('stop', 'Stop', { sub: 'S' }) + this.btn('retreat', 'Retreat', { sub: 'R' });
      if (us.some((u) => u.kind === 'leader')) { const l = us.find((u) => u.kind === 'leader')!; ctx += this.btn('rally', 'Rally', { cls: 'accent', why: l.ability > 0 ? `Rally ready in ${Math.ceil(l.ability)}s.` : undefined, sub: l.ability > 0 ? `${Math.ceil(l.ability)}s` : 'heal + speed' }); }
      if (us.some((u) => u.kind === 'gatherer')) ctx += this.btn('build', 'Build…');
      if (g.mode === 'move') info += ' — tap the destination';
      if (g.mode === 'amove') info += ' — tap where to attack-move';
    } else if (g.selB !== null && w._b?.get(g.selB)) {
      const b = w._b.get(g.selB)!, d = BUILDINGS[b.kind];
      info = `<b>${d.name}</b>${b.done ? '' : ` (building ${Math.floor(b.progress * 100)}%)`} · HP ${Math.ceil(b.hp)}/${b.maxHp}${b.queue.length ? ` · training ${b.queue.length}` : ''} — ${esc(d.desc)}`;
      if (b.done) {
        for (const k of d.trains) {
          const ud = UNITS[k as UnitKind];
          const c = trainCheck(w, b.id, k as UnitKind);
          ctx += this.btn(`train:${k}`, ud.name, { sub: costStr(ud.cost).replace(/<[^>]+>/g, ''), why: c.ok ? undefined : c.reason });
        }
        if (b.kind === 'circle') ctx += this.btn('disc', 'Teach…');
        if (['toolshelter', 'hearth'].includes(b.kind)) ctx += this.btn('disc', 'Research…');
      } else ctx += this.btn('cancelsite', 'Cancel site', { sub: '75% refund' });
    } else {
      info = g.mode === 'place' ? 'Position the building, then confirm.' : 'Tap a unit or building. Drag to pan, pinch to zoom.';
    }
    // global buttons
    const clueReady = DISC_ORDER.some((id) => w.disc[id] === 'clue' || w.disc[id] === 'faded' || (w.disc[id] === 'known' && w.buildings.some((b) => b.owner === 0 && b.kind === 'circle' && b.done)));
    const idleN = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'idle').length;
    const gift = this.btn('gift', 'Gift rival', { sub: w.time < w.truceUntil ? `peace ${fmtTime(w.truceUntil - w.time)}` : '40 food', cls: 'alt' });
    const glob = '<span class="sep"></span>' + this.btn('build', 'Build', { sub: 'B', on: this.panel === 'build' }) +
      this.btn('disc', 'Discoveries', { sub: 'D', on: this.panel === 'disc', badge: clueReady ? '!' : undefined }) +
      this.btn('jobs', 'Jobs', { on: this.jobsOpen }) + this.btn('idle', 'Idle', { badge: idleN ? String(idleN) : undefined }) +
      this.btn('army', 'Army') + this.btn('dragsel', 'Drag-select', { on: g.selectMode }) + this.btn('home', 'Home') + gift;
    const html = ctx + glob;
    if (html !== this.lastCmds) { $('cmds').innerHTML = html; this.lastCmds = html; }
    if ($('info').innerHTML !== info) $('info').innerHTML = info;
  }

  // ------------------------------------------------------------ panels
  renderPanel(force = false) {
    const el = $('panel'), w = this.g.world;
    if (!this.panel || !w) { el.classList.add('hidden'); el.innerHTML = ''; this.lastPanel = ''; return; }
    let body = '';
    if (this.panel === 'build') {
      body = `<h3>Build</h3><div class="grid">${BUILD_ORDER.map((k) => this.buildCard(k)).join('')}</div>`;
    } else {
      body = this.discPanel();
    }
    const html = `<div class="sh"><button data-act="closepanel" aria-label="Close">✕</button></div>${body}`;
    if (force || html !== this.lastPanel) { el.innerHTML = html; this.lastPanel = html; }
    el.classList.remove('hidden');
  }

  private buildCard(k: BuildingKind) {
    const w = this.g.world!, d = BUILDINGS[k];
    let why = '';
    if (d.requires && !hasDisc(w, d.requires as DiscoveryId)) why = `Locked: discover ${DISCOVERIES[d.requires as DiscoveryId].name}.`;
    else for (const r of Object.keys(d.cost) as Res[]) if (w.res[r] < (d.cost[r] ?? 0)) { why = `Not enough ${r} (need ${d.cost[r]}).`; break; }
    return `<button data-act="placeb:${k}" class="card-btn ${why ? 'dis' : ''}" ${why ? `data-why="${esc(why)}"` : ''}><b>${d.name}</b><span class="cost">${costStr(d.cost)}</span><small>${esc(d.desc)}</small>${why ? `<em>${esc(why)}</em>` : ''}</button>`;
  }

  private discPanel() {
    const w = this.g.world!;
    const rows = DISC_ORDER.map((id) => {
      const d = DISCOVERIES[id], st = w.disc[id];
      const act = w.activities.find((a) => a.disc === id);
      const step = (n: string, on: boolean) => `<span class="step ${on ? 'on' : ''}">${n}</span>`;
      const steps = step('Observe', st !== 'hidden') + step('Investigate', st === 'known' || st === 'preserved' || !!act) + step('Apply', st === 'known' || st === 'preserved') + step('Preserve', st === 'preserved');
      let body = '';
      if (st === 'hidden') body = `<p class="muted">???</p><p class="fine">How to find a clue: ${esc(d.clueHint)}</p>`;
      else {
        body = `<p>${esc(d.clue)}</p><p class="eff">Effect: ${esc(d.effect)}</p>`;
        if (st === 'known' || st === 'preserved') {
          if (st === 'known') {
            const c = teachCheck(w, id);
            body += `<p class="fine">Only the discoverers know this. Teach apprentices so it survives succession.</p>` + (act ? this.prog(act.progress / act.total, 'Teaching…') : `<button data-act="teach:${id}" class="${c.ok ? 'primary' : 'dis'}" ${c.ok ? '' : `data-why="${esc(c.reason)}"`}>Teach apprentices <small>10 knowledge</small></button>`);
          } else body += `<p class="good">✓ Preserved — inherited by descendants.</p>`;
        } else if (act) body += this.prog(act.progress / act.total, 'Investigating…');
        else {
          const c = investigateCheck(w, id), cost = discCost(w, id);
          const m = st === 'faded' ? '<p class="fine">Forgotten with the ancestors, but clues remain: 60% cheaper.</p>' : w.gen >= 2 && d.parent && w.disc[d.parent] === 'preserved' ? '<p class="fine">Inherited expertise: 30% cheaper and faster.</p>' : '';
          body += `${m}<p class="cost">Needs ${d.needs.map((n) => BUILDINGS[n].name).join(' + ')} · ${costStr(cost)} · ${Math.round(discTime(w, id))}s</p><button data-act="inv:${id}" class="${c.ok ? 'primary' : 'dis'}" ${c.ok ? '' : `data-why="${esc(c.reason)}"`}>${st === 'faded' ? 'Relearn' : 'Investigate'}</button>${c.ok ? '' : `<p class="why">${esc(c.reason)}</p>`}`;
        }
      }
      return `<div class="disc ${st}"><h4>${d.name}${d.later ? ' <small>(later generation)</small>' : ''}</h4><div class="steps">${steps}</div>${body}</div>`;
    }).join('');
    const lin = w.lineage.map((l) => `${esc(l.name)} <small>gen ${l.gen}${l.trait ? ' · ' + esc(l.trait) : ''}</small>`).join(' → ');
    return `<h3>Discoveries <small>Maintain fire</small></h3><div class="discs">${rows}</div><p class="fine">Lineage: ${lin}</p>`;
  }

  private prog(f: number, label: string) {
    return `<div class="prog"><div style="width:${Math.round(f * 100)}%"></div><span>${label} ${Math.round(f * 100)}%</span></div>`;
  }
}
