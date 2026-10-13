import { cmdHold, cmdRetreat, cmdStop, cmdMove } from '../sim/commands';
import { entityAt, targetAt, unitsInRect } from '../sim/query';
import type { Game } from './game';

interface Ptr { x: number; y: number; sx: number; sy: number; type: string; button: number; moved: boolean; t: number }

export class Input {
  private ptrs = new Map<number, Ptr>();
  private pinch: { d: number; cx: number; cy: number } | null = null;
  private lastTap = { t: 0, id: -1 };
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, inside: false };
  private boxing = false;

  constructor(private g: Game) {
    const c = g.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = null; this.g.box = null; });
    c.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      g.cam.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    g.minimap.addEventListener('pointerdown', (e) => this.mini(e));
    g.minimap.addEventListener('pointermove', (e) => { if (e.buttons) this.mini(e); });
  }

  private pos(e: PointerEvent) {
    const r = this.g.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private mini(e: PointerEvent) {
    const w = this.g.world; if (!w) return;
    const r = this.g.minimap.getBoundingClientRect();
    this.g.cam.centerOn(((e.clientX - r.left) / r.width) * w.W, ((e.clientY - r.top) / r.height) * w.H);
    e.preventDefault();
  }

  private tol(type: string) { return type === 'touch' ? Math.max(0.55, 22 / this.g.cam.zoom) : 0.25; }

  private down(e: PointerEvent) {
    if (!this.g.world || this.g.menuOpen) return;
    const p = this.pos(e);
    this.ptrs.set(e.pointerId, { ...p, sx: p.x, sy: p.y, type: e.pointerType, button: e.button, moved: false, t: performance.now() });
    this.g.canvas.setPointerCapture(e.pointerId);
    this.mouse = { ...p, inside: true };
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this.g.box = null; this.boxing = false;
    }
    e.preventDefault();
  }

  private move(e: PointerEvent) {
    const g = this.g, p = this.pos(e);
    if (e.pointerType === 'mouse') this.mouse = { ...p, inside: true };
    const s = this.ptrs.get(e.pointerId);
    if (!s) {
      if (e.pointerType === 'mouse' && g.mode === 'place' && g.world) { const w = g.cam.toWorld(p.x, p.y); g.movePlace(w.x, w.y); }
      return;
    }
    const dx = p.x - s.x, dy = p.y - s.y;
    s.x = p.x; s.y = p.y;
    if (!s.moved && Math.hypot(p.x - s.sx, p.y - s.sy) > (s.type === 'touch' ? 10 : 5)) s.moved = true;
    if (this.ptrs.size >= 2 && this.pinch) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      g.cam.zoomAt(d / this.pinch.d, cx, cy);
      g.cam.pan(cx - this.pinch.cx, cy - this.pinch.cy);
      this.pinch = { d, cx, cy };
      return;
    }
    if (!s.moved) return;
    const w = g.cam.toWorld(p.x, p.y);
    if (s.type === 'mouse') {
      if (s.button === 1 || s.button === 2) g.cam.pan(dx, dy);
      else if (g.mode === 'place') g.movePlace(w.x, w.y);
      else { this.boxing = true; g.box = { x0: s.sx, y0: s.sy, x1: p.x, y1: p.y }; }
    } else if (g.mode === 'place') {
      g.movePlace(w.x, w.y, 1.4);
    } else if (g.selectMode) {
      this.boxing = true; g.box = { x0: s.sx, y0: s.sy, x1: p.x, y1: p.y };
    } else {
      g.cam.pan(dx, dy);
    }
  }

  private up(e: PointerEvent) {
    const g = this.g;
    const s = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (!s || !g.world) return;
    const wasMulti = this.ptrs.size > 0;
    if (this.boxing && g.box) {
      const a = g.cam.toWorld(g.box.x0, g.box.y0), b = g.cam.toWorld(g.box.x1, g.box.y1);
      const ids = unitsInRect(g.world, a.x, a.y, b.x, b.y).map((u) => u.id);
      g.box = null; this.boxing = false;
      if (ids.length) g.selectUnits(ids, e.shiftKey);
      return;
    }
    g.box = null; this.boxing = false;
    if (s.moved || wasMulti) return;
    this.tap(s, e);
  }

  private tap(s: Ptr, e: PointerEvent) {
    const g = this.g, w = g.world!;
    const wp = g.cam.toWorld(s.x, s.y);
    const touch = s.type !== 'mouse';
    const right = s.button === 2;

    if (g.mode === 'place') {
      if (right) { g.cancelPlace(); return; }
      g.movePlace(wp.x, wp.y, touch ? 1.4 : 0);
      if (!touch) { const err = g.confirmPlace(); if (err) g.hud.toast(err, 'bad'); }
      return;
    }
    const hit = entityAt(w, wp.x, wp.y, this.tol(s.type));      // for selecting things
    const tgt = targetAt(w, wp.x, wp.y, this.tol(s.type));      // for giving orders (never your own units)
    if (g.mode === 'move' || g.mode === 'amove') {
      const attack = g.mode === 'amove';
      if (g.liveSel().length) {
        if (attack) { cmdMove(w, g.sel, wp.x, wp.y, true); g.ping(wp.x, wp.y, 'rgba(255,110,90,.95)'); }
        else g.orderAt(wp.x, wp.y, tgt);
      }
      if (!e.shiftKey) g.mode = 'normal';
      g.hud.refresh(true);
      return;
    }
    const hasUnits = g.liveSel().length > 0;
    if (right) { if (hasUnits) g.orderAt(wp.x, wp.y, tgt); else g.clearSelection(); return; }

    if (hit?.type === 'unit' && hit.unit.owner === 0) {
      // a tap that lands closer to a resource or enemy than to a unit is an order, not a selection
      const exact = Math.hypot(hit.unit.x - wp.x, hit.unit.y - wp.y) < 0.45;
      if (!(hasUnits && touch && tgt && !exact)) {
        const now = performance.now();
        if (now - this.lastTap.t < 350 && this.lastTap.id === hit.unit.id) {
          const a = g.cam.toWorld(0, 0), b = g.cam.toWorld(g.cam.vw, g.cam.vh);
          g.selectUnits(unitsInRect(w, a.x, a.y, b.x, b.y).filter((u) => u.kind === hit.unit.kind).map((u) => u.id));
        } else g.selectUnits([hit.unit.id], e.shiftKey || e.ctrlKey);
        this.lastTap = { t: now, id: hit.unit.id };
        return;
      }
    }
    if (hit?.type === 'building' && hit.building.owner === 0) {
      if (hasUnits && !hit.building.done) { g.orderAt(wp.x, wp.y, tgt); return; }
      g.selectBuilding(hit.building.id); return;
    }
    if (hit && hit.type === 'unit' && hit.unit.owner !== 0 && !hasUnits) {
      g.hud.toast(`${hit.unit.owner === 1 ? 'Rival ' : ''}${hit.unit.kind} · HP ${Math.ceil(hit.unit.hp)}/${hit.unit.maxHp}`); return;
    }
    if (hasUnits) {
      // touch always orders on tap; a mouse left-click only orders on a target and otherwise deselects
      if (touch || tgt) { g.orderAt(wp.x, wp.y, tgt); return; }
    }
    g.clearSelection();
  }

  private key(e: KeyboardEvent, down: boolean) {
    const g = this.g;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down || !g.world) return;
    if (k === 'escape') {
      if (g.hud.panelOpen()) g.hud.closePanels();
      else if (g.mode !== 'normal') { g.mode = 'normal'; g.place = null; g.hud.refresh(true); }
      else if (g.sel.length || g.selB) g.clearSelection();
      else g.hud.openMenu();
      return;
    }
    if (g.menuOpen) return;
    const ids = g.liveSel();
    if (k === ' ' || k === 'p') { g.speed = g.speed === 0 ? 1 : 0; g.hud.refresh(true); e.preventDefault(); }
    else if (k === 'b') g.hud.togglePanel('build');
    else if (k === 'd') g.hud.togglePanel('disc');
    else if (k === 'm' && ids.length) { g.mode = 'move'; g.hud.refresh(true); }
    else if (k === 'a' && ids.length) { g.mode = 'amove'; g.hud.refresh(true); }
    else if (k === 'h' && ids.length) cmdHold(g.world, ids);
    else if (k === 's' && ids.length && !e.ctrlKey) cmdStop(g.world, ids);
    else if (k === 'r' && ids.length) cmdRetreat(g.world, ids);
    else if (k === '.') g.hud.act('idle');
    else if (k === 'enter' && g.mode === 'place') { const err = g.confirmPlace(); if (err) g.hud.toast(err, 'bad'); }
    else if (/^[1-9]$/.test(k)) {
      if (e.ctrlKey || e.metaKey) { g.groups[k] = [...ids]; g.hud.toast(`Group ${k} set`); e.preventDefault(); }
      else if (g.groups[k]?.length) g.selectUnits(g.groups[k].filter((id) => g.world!._u?.get(id)));
    }
  }

  /** Keyboard + screen-edge panning. */
  update(dt: number) {
    const g = this.g; if (!g.world || g.menuOpen) return;
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has('arrowleft')) dx -= 1;
    if (k.has('arrowright')) dx += 1;
    if (k.has('arrowup')) dy -= 1;
    if (k.has('arrowdown')) dy += 1;
    if (!g.sel.length) { if (k.has('w')) dy -= 1; if (k.has('s')) dy += 1; if (k.has('a')) dx -= 1; if (k.has('d')) dx += 1; }
    if (this.mouse.inside && this.ptrs.size === 0) {
      const m = this.mouse, e = 6;
      if (m.x < e) dx -= 1; if (m.x > g.cam.vw - e) dx += 1; if (m.y < e) dy -= 1; if (m.y > g.cam.vh - e) dy += 1;
    }
    if (dx || dy) g.cam.pan(-dx * 700 * dt, -dy * 700 * dt);
  }
}
