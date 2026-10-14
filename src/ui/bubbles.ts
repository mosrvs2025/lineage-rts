/** Phone-portrait interface: a draggable action bubble that fans out the dock, and a draggable, pinnable selection card. */
import { icon } from './icons';

const MQ = '(max-width: 560px) and (orientation: portrait)';
const KEY = 'lineage.bubbles';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Saved { bx?: number; by?: number; fx?: number; fy?: number; pinned?: boolean; folded?: boolean }

export class Bubbles {
  phone = false;
  private saved: Saved = {};
  private mq = window.matchMedia(MQ);

  constructor(private onChange: () => void) {
    try { this.saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Saved; } catch { this.saved = {}; }
    this.drag($('bgrip'), $('bubble'), 'b');
    this.drag($('fabbtn'), $('fab'), 'f', () => this.toggleFab());
    $('bpin').addEventListener('click', () => { this.saved.pinned = !this.saved.pinned; this.persist(); this.paint(); this.onChange(); });
    $('bfold').addEventListener('click', () => { this.saved.folded = !this.saved.folded; this.persist(); this.paint(); });
    document.addEventListener('pointerdown', (e) => { if (!(e.target as HTMLElement).closest('#fab')) this.closeFab(); }, true);
    this.mq.addEventListener?.('change', () => this.apply());
    window.addEventListener('resize', () => { this.place(); });
    this.apply();
  }

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
    $('bpin').innerHTML = icon(this.saved.pinned ? 'pin' : 'pinoff');
    $('bpin').classList.toggle('on', !!this.saved.pinned);
    $('bfold').innerHTML = icon(this.saved.folded ? 'chevup' : 'chevdown');
    $('bubble').classList.toggle('folded', !!this.saved.folded);
    $('fabbtn').innerHTML = icon($('fab').classList.contains('open') ? 'close' : 'discover');
  }

  /** Show the selection card only while something is selected (or the player pinned it open). */
  update(hasSelection: boolean) {
    if (!this.phone) return;
    $('bubble').classList.toggle('hidden', !(hasSelection || this.saved.pinned));
  }

  private clamp(el: HTMLElement, x: number, y: number) {
    const r = el.getBoundingClientRect();
    return { x: Math.max(4, Math.min(window.innerWidth - r.width - 4, x)), y: Math.max(70, Math.min(window.innerHeight - r.height - 4, y)) };
  }

  private place() {
    if (!this.phone) return;
    const fab = $('fab'), W = window.innerWidth, H = window.innerHeight;
    const fx = this.saved.fx ?? 1 - 66 / W, fy = this.saved.fy ?? 150 / H;
    const p = this.clamp(fab, fx * W, fy * H); fab.style.left = `${p.x}px`; fab.style.top = `${p.y}px`;
    if (this.saved.bx !== undefined && this.saved.by !== undefined) {
      const b = $('bubble'); b.classList.add('dragged');
      const q = this.clamp(b, this.saved.bx * W, this.saved.by * H); b.style.left = `${q.x}px`; b.style.top = `${q.y}px`;
    }
  }

  toggleFab() { const f = $('fab'); if (f.classList.contains('open')) this.closeFab(); else this.openFab(); }
  openFab() {
    const f = $('fab'), r = f.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const W = window.innerWidth, H = window.innerHeight, R = 122, M = 34;
    const toward = Math.atan2(H * 0.55 - cy, W / 2 - cx) * 180 / Math.PI; // prefer fanning toward the middle of the screen
    // choose the arc centre that keeps every button on screen, closest to that preference
    let best = toward, bestScore = -Infinity;
    for (let d = 0; d < 360; d += 5) {
      const c = toward + (d <= 180 ? d : d - 360);
      let off = 0;
      for (let i = 0; i < 8; i++) {
        const a = (c - 80 + (160 / 7) * i) * Math.PI / 180, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        off += Math.max(0, M - x) + Math.max(0, x - (W - M)) + Math.max(0, 112 - y) + Math.max(0, y - (H - M));
      }
      const score = -off * 10 - Math.abs(d <= 180 ? d : 360 - d);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    const dock = $('dock'); dock.style.setProperty('--start', `${best - 80}deg`); dock.style.setProperty('--step', `${160 / 7}deg`);
    f.classList.add('open'); this.paint();
  }
  closeFab() { const f = $('fab'); if (f.classList.contains('open')) { f.classList.remove('open'); this.paint(); } }

  /** Drag a handle to move `target`; a plain tap calls `onTap`. Positions are remembered as screen fractions. */
  private drag(handle: HTMLElement, target: HTMLElement, key: 'b' | 'f', onTap?: () => void) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, id = -1;
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button.mini')) return;
      id = e.pointerId; handle.setPointerCapture(id); moved = false; sx = e.clientX; sy = e.clientY;
      const r = target.getBoundingClientRect(); ox = r.left; oy = r.top; e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 7) return;
      if (!moved) { moved = true; target.classList.add('dragged'); target.classList.add('moving'); if (key === 'f') this.closeFab(); }
      const p = this.clamp(target, ox + e.clientX - sx, oy + e.clientY - sy);
      target.style.left = `${p.x}px`; target.style.top = `${p.y}px`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return; id = -1; target.classList.remove('moving');
      if (moved) {
        const r = target.getBoundingClientRect();
        this.saved[key === 'b' ? 'bx' : 'fx'] = r.left / window.innerWidth; this.saved[key === 'b' ? 'by' : 'fy'] = r.top / window.innerHeight; this.persist();
      } else onTap?.();
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
}
