import { Camera } from '../render/camera';
import { Renderer } from '../render/renderer';
import type { Overlay } from '../render/renderer';
import { voice } from './voice';
import { settings } from './settings';
import { cmdContext, cmdPlace, placeCheck } from '../sim/commands';
import { updateFog } from '../sim/fog';
import { deserialize, serialize } from '../sim/save';
import type { Hit } from '../sim/query';
import { targetAt } from '../sim/query';
import { step } from '../sim/step';
import { autoWork, DT } from '../sim/units';
import type { BuildingKind, Species, World } from '../sim/types';
import { isVisible } from '../sim/rules';
import { createWorld } from '../sim/world';
import { bCenter } from '../sim/util';
import { playEvent, setListener, updateAmbience } from './audio';
import { Hud } from './hud';
import { Input } from './input';
import { music } from './music';
import type { MoodName } from './music';

export const SAVE_KEYS = { manual: 'lineage-rts:save:manual', auto: 'lineage-rts:save:auto' } as const;
export type SaveSlot = keyof typeof SAVE_KEYS;
export type Mode = 'normal' | 'move' | 'amove' | 'place' | 'rally' | 'patrol';

export class Game {
  world: World | null = null;
  cam = new Camera();
  renderer: Renderer;
  hud: Hud;
  input: Input;
  speed = 1;               // 0 = paused
  menuOpen = true;
  sel: number[] = [];
  selB: number | null = null;
  mode: Mode = 'normal';
  place: { kind: BuildingKind; tx: number; ty: number } | null = null;
  selectMode = false;
  queueMode = false;       // touch: queue orders as if Shift were held
  showBars = false;        // Alt held: show every health bar      // touch: drag to box-select
  box: Overlay['box'] = null;
  pings: Overlay['pings'] = [];
  groups: Record<string, number[]> = {};
  private acc = 0;
  private last = performance.now();
  private lastAuto = performance.now();
  species: Species = 'human';
  mapId = 'valley';
  endShown = false;
  showcase = false;        // title-screen demo world (never saved)
  private moodT = 0; private dangerUntil = 0; private stung = false;

  constructor(public canvas: HTMLCanvasElement, public minimap: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.cam);
    this.hud = new Hud(this);
    this.input = new Input(this);
    this.renderer.resize();
    this.hud.layout();
    window.addEventListener('resize', () => { this.renderer.resize(); this.hud.layout(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.autosave(); if (this.world?.status === 'playing') { this.speed = 0; this.hud.refresh(true); } } });
    requestAnimationFrame((t) => this.frame(t));
  }

  get paused() { return this.speed === 0 || (this.menuOpen && !this.showcase); }

  // ------------------------------------------------------------ lifecycle
  startNew(species: Species, mapId = this.mapId) {
    this.species = species; this.mapId = mapId;
    const w = createWorld(species, 1337 + Math.floor(Math.random() * 100000), mapId);
    updateFog(w);
    for (const u of w.units) if (u.owner === 0 && u.kind === 'gatherer') autoWork(w, u);
    this.setWorld(w);
    this.hud.showHelpOnce();
  }

  /** A living, slowly orbiting world behind the title menu. */
  startShowcase() {
    if (this.world && !this.showcase) this.autosave();
    const w = createWorld('human', 4242);
    updateFog(w);
    for (const u of w.units) if (u.owner === 0 && u.kind === 'gatherer') autoWork(w, u);
    this.world = w; this.showcase = true;
    this.sel = []; this.selB = null; this.mode = 'normal'; this.place = null; this.box = null; this.endShown = false;
    this.speed = 1; this.menuOpen = true; this.acc = 0;
    this.renderer.terrain = null;
    document.getElementById('app')?.classList.add('noworld');
    this.hud.closePanels();
  }

  setWorld(w: World) {
    this.showcase = false; this.cam.yaw = 0;
    this.world = w;
    document.getElementById('app')?.classList.remove('noworld');
    updateFog(w);
    this.sel = []; this.selB = null; this.mode = 'normal'; this.place = null; this.box = null; this.endShown = false;
    this.speed = 1; this.menuOpen = false; this.acc = 0;
    this.species = w.species;
    this.renderer.terrain = null;
    const h = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth');
    if (h) { const c = bCenter(h); const small = window.innerWidth < 760 || window.innerHeight < 520; this.cam.zoom = Math.max(this.cam.minZoom(), small ? 24 : 32); this.cam.centerOn(c.x + 3, c.y + 2); }
    this.hud.closePanels();
    this.hud.refresh(true);
  }

  restart() { this.startNew(this.species); }

  // ------------------------------------------------------------ persistence
  save(slot: SaveSlot): boolean {
    if (!this.world) return false;
    try { localStorage.setItem(SAVE_KEYS[slot], serialize(this.world)); return true; } catch { return false; }
  }
  autosave() {
    if (this.world && !this.showcase && this.world.status === 'playing') this.save('auto');
    this.lastAuto = performance.now();
  }
  slotInfo(slot: SaveSlot): { ok: boolean; text: string } {
    let raw: string | null = null;
    try { raw = localStorage.getItem(SAVE_KEYS[slot]); } catch { /* storage unavailable */ }
    if (!raw) return { ok: false, text: 'empty' };
    const r = deserialize(raw);
    if (!r.ok) return { ok: false, text: `unreadable (${r.error})` };
    const m = Math.floor(r.world.time / 60);
    return { ok: true, text: `Gen ${r.world.gen} · ${m} min · ${r.world.species}` };
  }
  load(slot: SaveSlot): string | null {
    let raw: string | null = null;
    try { raw = localStorage.getItem(SAVE_KEYS[slot]); } catch { return 'Browser storage is unavailable.'; }
    if (!raw) return 'No save in that slot.';
    return this.loadText(raw);
  }
  loadText(text: string): string | null {
    const r = deserialize(text);
    if (!r.ok) return r.error;
    this.setWorld(r.world);
    return null;
  }
  exportSave() {
    if (!this.world) return;
    const blob = new Blob([serialize(this.world)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `lineage-gen${this.world.gen}-${Math.floor(this.world.time)}s.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ------------------------------------------------------------ selection & orders
  selectUnits(ids: number[], add = false) {
    this.sel = add ? Array.from(new Set([...this.sel, ...ids])) : ids;
    this.selB = null; this.hud.refresh(true);
    const w = this.world, u = w && ids.length ? w._u?.get(ids[0]) : undefined;
    if (u && u.owner === 0 && !this.showcase) voice(u.kind, w!.species, 'select', u.id);
  }

  /** Issue an order through `fn`; with `queue`, append it to each unit's queue instead of replacing the current order. */
  issue(queue: boolean, fn: () => void) {
    const w = this.world; if (!w) return;
    const us = this.liveSel().map((id) => w._u!.get(id)!).filter((u) => u.owner === 0);
    const before = new Map(us.map((u) => [u.id, { o: u.order, q: [...(u.q ?? [])] }]));
    fn();
    if (!queue) return;
    for (const u of us) {
      const b = before.get(u.id)!; if (b.o.t === 'idle' || b.o.t === 'hold') continue;
      const next = u.order; u.order = b.o; u.path = null; u.q = [...b.q, next];
    }
  }
  selectBuilding(id: number | null) { this.sel = []; this.selB = id; this.hud.refresh(true); }
  clearSelection() { this.sel = []; this.selB = null; this.mode = 'normal'; this.place = null; this.hud.refresh(true); }
  liveSel() {
    const w = this.world; if (!w) return [];
    this.sel = this.sel.filter((id) => w._u?.get(id) && w._u.get(id)!.hp > 0);
    return this.sel;
  }
  ping(x: number, y: number, c = 'rgba(255,255,255,.9)') { this.pings.push({ x, y, age: 0, c }); }

  orderAt(x: number, y: number, hit?: Hit, queue = false) {
    const w = this.world; if (!w || !this.liveSel().length) return;
    let kind = 'move';
    this.issue(queue || this.queueMode, () => { kind = cmdContext(w, this.sel, x, y, hit ?? targetAt(w, x, y, 0.4)); });
    const u = w._u?.get(this.sel[0]); if (u) voice(u.kind, w.species, kind === 'attack' ? 'attack' : kind === 'gather' ? 'work' : kind === 'build' ? 'build' : 'move', u.id);
    this.ping(x, y, kind === 'attack' ? 'rgba(255,110,90,.95)' : kind === 'gather' ? 'rgba(150,255,160,.95)' : kind === 'build' ? 'rgba(255,220,120,.95)' : 'rgba(255,255,255,.9)');
  }

  startPlace(kind: BuildingKind) {
    const w = this.world; if (!w) return;
    this.mode = 'place';
    const c = this.cam;
    const t = c.toWorld(c.vw / 2, c.vh / 2);
    this.place = { kind, tx: Math.floor(t.x), ty: Math.floor(t.y) };
    this.hud.closePanels(); this.hud.refresh(true);
  }
  movePlace(wx: number, wy: number, yOffset = 0) {
    if (!this.place) return;
    const d = { shelter: [2, 2], stockpile: [2, 2], toolshelter: [2, 2], lodge: [3, 2], circle: [3, 3], rack: [2, 2], watch: [2, 2], palisade: [1, 1], hearth: [3, 3] }[this.place.kind];
    this.place.tx = Math.round(wx - d[0] / 2);
    this.place.ty = Math.round(wy - d[1] / 2 - yOffset);
  }
  confirmPlace(): string | null {
    const w = this.world; if (!w || !this.place) return null;
    const { kind, tx, ty } = this.place;
    const r = cmdPlace(w, kind, tx, ty, this.liveSel());
    if (!r.ok) return r.reason;
    if (kind !== 'palisade') { this.mode = 'normal'; this.place = null; }
    this.hud.refresh(true);
    return null;
  }
  cancelPlace() { this.mode = 'normal'; this.place = null; this.hud.refresh(true); }
  canPlaceNow() { const w = this.world; return !!(w && this.place && placeCheck(w, this.place.kind, this.place.tx, this.place.ty).ok); }

  /** Step the simulation without rendering (used by automated tests). */
  advance(seconds: number) {
    const w = this.world; if (!w) return;
    for (let i = 0; i < Math.round(seconds / DT) && w.status === 'playing'; i++) step(w);
    this.hud.refresh(true);
  }

  /** Choose the score from what is happening: title, calm autumn, cold winter, or danger when enemies close in. */
  private updateMusic(w: World, now: number) {
    let mood: MoodName = 'calm';
    if (this.showcase) mood = 'title';
    else if (w.status !== 'playing') { mood = 'off'; if (!this.stung) { this.stung = true; music.stinger(w.status === 'won' ? 'win' : 'lose'); } }
    else {
      this.stung = false;
      let near = false;
      outer: for (const e of w.units) {
        if (e.owner === 0 || e.hp <= 0 || e.kind === 'deer' || !isVisible(w, e.x, e.y)) continue;
        for (const f of w.units) if (f.owner === 0 && Math.hypot(f.x - e.x, f.y - e.y) < 11) { near = true; break outer; }
      }
      if (near) this.dangerUntil = now + 9000;
      mood = now < this.dangerUntil ? 'danger' : this.renderer.winterLevel > 0.5 ? 'winter' : 'calm';
    }
    music.setMood(mood);
  }

  // ------------------------------------------------------------ loop
  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    this.input.update(dt);
    for (const p of this.pings) p.age += dt;
    this.pings = this.pings.filter((p) => p.age < 0.7);
    if (w && this.showcase) {
      w._vis?.fill(2); w._exp?.fill(1);
      const t = now / 1000, h = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth');
      this.cam.zoom = Math.max(this.cam.minZoom(), 36); this.cam.yaw = Math.sin(t * 0.07) * 0.75;
      if (h) this.cam.centerOn(h.x + 5 + Math.cos(t * 0.05) * 3, h.y + 1 + Math.sin(t * 0.04) * 2);
      if (w.time > 600) this.startShowcase();
    }
    if (w) {
      if (!this.paused && w.status === 'playing') {
        this.acc += dt * this.speed;
        let n = 0;
        while (this.acc >= DT && n < 12) { step(w); this.acc -= DT; n++; }
        if (n === 12) this.acc = 0;
      }
      // ---- presentation events -> effects + spatial audio; ambience; adaptive music
      const evs = w._ev ?? []; w._ev = [];
      if (evs.length) this.renderer.onEvents(w, evs, now / 1000);
      setListener(this.cam.x, this.cam.y, this.cam.zoom);
      for (const e of evs) if (e.owner === 0 || e.owner === undefined || isVisible(w, e.x, e.y)) playEvent(e);
      updateAmbience({ dt, winter: this.renderer.winterLevel, night: this.renderer.night, fire: this.renderer.fireNear(w), paused: this.paused && !this.showcase });
      if (now - this.moodT > 1000) { this.moodT = now; this.updateMusic(w, now); }
      if (now - this.lastAuto > 30000) this.autosave();
      this.renderer.draw(w, {
        selUnits: this.liveSel(), allBars: this.showBars || settings.bars, selBuilding: this.selB, box: this.box, place: this.mode === 'place' ? this.place : null,
        alpha: this.paused ? 1 : Math.min(1, this.acc / DT), pings: this.pings,
      }, now / 1000);
      this.renderer.drawMinimap(w, this.minimap);
      this.hud.tick(now);
      if (w.status !== 'playing' && !this.endShown) { this.endShown = true; this.hud.showEnd(); }
    } else {
      this.renderer.clear();
    }
    requestAnimationFrame((t) => this.frame(t));
  }
}
