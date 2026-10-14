/** Phone-portrait interface: a draggable action bubble that fans out the dock, a pinnable selection card, and draggable HUD panels. */
import { icon } from './icons';

const MQ = '(max-width: 560px) and (orientation: portrait)';
const KEY = 'lineage.hud.v2';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Saved { pos: Record<string, [number, number]>; pinned: boolean; folded: boolean; jobsPinned: boolean; objMin: boolean }

export interface BubbleHooks {
  /** A sub-window (Build, Discover, Jobs) is open. */
  subOpen(): boolean;
  closeSub(): void;
  notify(msg: string): void;
}

export class Bubbles {
  phone = false;
  private saved: Saved = { pos: {}, pinned: false, folded: false, jobsPinned: false, objMin: false };
  private mq = window.matchMedia(MQ);
  private panels: { id: string; el: HTMLElement; ymin: number }[] = [];

  constructor(private onChange: () => void, private hooks: BubbleHooks) {
    try { Object.assign(this.saved, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* corrupt or unavailable */ }
    if (!this.saved.pos) this.saved.pos = {};

    this.draggable($('bgrip'), $('bubble'), 'bubble', () => !this.saved.pinned);
    this.draggable($('fabbtn'), $('fab'), 'fab', () => true, () => this.fabTap());
    this.draggable($('ogrip'), $('objectives'), 'objectives', () => true);
    this.draggable($('jgrip'), $('jobs'), 'jobs', () => true);

    $('bpin').addEventListener('click', () => {
      this.saved.pinned = !this.saved.pinned; this.persist(); this.paint(); this.onChange();
      this.hooks.notify(this.saved.pinned ? 'Panel pinned: position locked, stays open.' : 'Panel unpinned: drag it anywhere; it hides when nothing is selected.');
    });
    $('bfold').addEventListener('click', () => { this.saved.folded = !this.saved.folded; this.persist(); this.paint(); });
    $('jpin').addEventListener('click', () => {
      this.saved.jobsPinned = !this.saved.jobsPinned; this.persist(); this.paint();
      this.hooks.notify(this.saved.jobsPinned ? 'Jobs window pinned: it stays open while you play.' : 'Jobs window unpinned: tapping the map closes it.');
    });
    $('omin').addEventListener('click', () => { this.saved.objMin = !this.saved.objMin; this.persist(); this.paint(); });
    document.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('#fab')) this.closeFab(); }, true);
    this.mq.addEventListener?.('change', () => this.apply());
    window.addEventListener('resize', () => this.place());
    this.apply();
  }

  get jobsPinned() { return this.saved.jobsPinned; }
  get objMin() { return this.saved.objMin; }

  private persist() { try { localStorage.setItem(KEY, JSON.stringify(this.saved)); } catch { /* storage unavailable */ } }

  /** Move the shared panels between the desktop console and the phone bubbles. */
  apply() {
    const phone = this.mq.matches;
    const app = $('app');
    if (phone !== this.phone || !$('fab').dataset.init) {
      this.phone = phone; $('fab').dataset.init = '1';
      app.classList.toggle('pp', phone);
      if (phone) { $('bbody').append($('selpanel'), $('cmdcard')); $('fab').insertBefore($('dock'), $('fabbtn')); }
      else { $('hud').append($('selpanel'), $('cmdcard')); app.insertBefore($('dock'), $('fab')); this.closeFab(); }
      $('fab').classList.toggle('hidden', !phone);
      this.onChange();
    }
    this.paint(); this.place();
  }

  paint() {
    const s = this.saved;
    $('bpin').innerHTML = `${icon(s.pinned ? 'pin' : 'pinoff')}<em>${s.pinned ? 'Pinned' : ''}</em>`;
    $('bpin').classList.toggle('on', s.pinned);
    $('bfold').innerHTML = icon(s.folded ? 'chevup' : 'chevdown');
    $('bubble').classList.toggle('folded', s.folded);
    $('bubble').classList.toggle('pinned', s.pinned);
    $('fabbtn').innerHTML = icon($('fab').classList.contains('open') ? 'close' : 'discover');
    $('jpin').innerHTML = `${icon(s.jobsPinned ? 'pin' : 'pinoff')}`; $('jpin').classList.toggle('on', s.jobsPinned);
    $('jclose').innerHTML = icon('close');
    $('omin').innerHTML = icon(s.objMin ? 'chevd' : 'chevup');
    $('objectives').classList.toggle('pill', s.objMin);
  }

  /** Show the selection card only while something is selected (or the player pinned it open). */
  update(hasSelection: boolean) {
    if (!this.phone) return;
    $('bubble').classList.toggle('hidden', !(hasSelection || this.saved.pinned));
  }

  private clamp(el: HTMLElement, x: number, y: number, ymin: number) {
    const r = el.getBoundingClientRect();
    return { x: Math.max(4, Math.min(window.innerWidth - r.width - 4, x)), y: Math.max(ymin, Math.min(window.innerHeight - r.height - 4, y)) };
  }

  /** Re-apply remembered positions (called on resize, rotation and panel changes). */
  place() {
    const W = window.innerWidth, H = window.innerHeight;
    for (const p of this.panels) {
      if (p.el.classList.contains('moving')) continue;
      if (p.id === 'fab' && !this.phone) continue;
      if (p.id === 'bubble' && !this.phone) continue;
      const sv = this.saved.pos[p.id];
      if (p.id === 'fab') {
        const [fx, fy] = sv ?? [1 - 66 / W, 150 / H];
        const q = this.clamp(p.el, fx * W, fy * H, p.ymin); p.el.style.left = `${q.x}px`; p.el.style.top = `${q.y}px`; continue;
      }
      if (!sv || p.el.classList.contains('hidden')) continue;
      p.el.classList.add('dragged');
      const q = this.clamp(p.el, sv[0] * W, sv[1] * H, p.ymin); p.el.style.left = `${q.x}px`; p.el.style.top = `${q.y}px`;
    }
  }

  /** Tapping the bubble closes any open sub-window first; otherwise it toggles the fan. */
  private fabTap() {
    if (this.hooks.subOpen()) { this.hooks.closeSub(); this.closeFab(); return; }
    this.toggleFab();
  }

  toggleFab() { if ($('fab').classList.contains('open')) this.closeFab(); else this.openFab(); }

  /** Place each action on the best free spot around the bubble: nearest to the screen centre, on screen, clear of other HUD boxes and of each other (wider rings when crowded). */
  openFab() {
    const f = $('fab'), r = f.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const W = window.innerWidth, H = window.innerHeight, M = 32, ITEM = 27;
    const toward = Math.atan2(H * 0.55 - cy, W / 2 - cx) * 180 / Math.PI;
    const boxes: DOMRect[] = [];
    for (const id of ['objectives', 'jobs', 'bubble', 'topbar']) {
      const el = $(id); if (el.classList.contains('hidden')) continue;
      const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0) boxes.push(b);
    }
    const tl = $('toasts'); if (tl.children.length) boxes.push(tl.getBoundingClientRect());
    const placed: [number, number][] = [];
    const ok = (x: number, y: number) => x >= M && x <= W - M && y >= M && y <= H - M
      && !boxes.some((b) => x > b.left - ITEM && x < b.right + ITEM && y > b.top - ITEM && y < b.bottom + ITEM)
      && placed.every((p) => Math.hypot(p[0] - x, p[1] - y) >= ITEM * 2 + 2);
    const dock = $('dock');
    for (let i = 0; i < 8; i++) {
      let spot: [number, number] | null = null;
      for (const R of [104, 152, 200, 248]) {
        for (let k = 0; k <= 72 && !spot; k++) {            // alternate either side of the preferred direction: 0, +5, -5, +10 ...
          const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 5, a = (toward + d) * Math.PI / 180;
          const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
          if (ok(x, y)) spot = [x, y];
        }
        if (spot) break;
      }
      const a = (toward + (i - 3.5) * 22) * Math.PI / 180;
      const [px, py] = spot ?? [cx + Math.cos(a) * 104, cy + Math.sin(a) * 104];
      placed.push([px, py]);
      dock.style.setProperty(`--x${i}`, `${Math.round(px - cx)}px`); dock.style.setProperty(`--y${i}`, `${Math.round(py - cy)}px`);
    }
    f.classList.add('open'); this.paint();
  }
  closeFab() { const f = $('fab'); if (f.classList.contains('open')) { f.classList.remove('open'); this.paint(); } }

  /** Make `target` draggable by `handle`; a plain tap calls `onTap`. Positions are remembered as screen fractions. */
  private draggable(handle: HTMLElement, target: HTMLElement, id: string, enabled: () => boolean, onTap?: () => void) {
    const ymin = id === 'fab' || id === 'bubble' ? 70 : 46;
    this.panels.push({ id, el: target, ymin });
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, ptr = -1;
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button.mini')) return;
      e.stopPropagation();
      ptr = e.pointerId; moved = false; sx = e.clientX; sy = e.clientY;
      try { handle.setPointerCapture(ptr); } catch { /* synthetic pointer */ }
      const r = target.getBoundingClientRect(); ox = r.left; oy = r.top;
    });
    handle.addEventListener('pointermove', (e) => {
      if (e.pointerId !== ptr || !enabled()) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 7) return;
      if (!moved) { moved = true; target.classList.add('dragged', 'moving'); if (id === 'fab') this.closeFab(); }
      const p = this.clamp(target, ox + e.clientX - sx, oy + e.clientY - sy, ymin);
      target.style.left = `${p.x}px`; target.style.top = `${p.y}px`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== ptr) return; ptr = -1; target.classList.remove('moving');
      if (moved) {
        const r = target.getBoundingClientRect();
        this.saved.pos[id] = [r.left / window.innerWidth, r.top / window.innerHeight]; this.persist();
      } else onTap?.();
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
}
