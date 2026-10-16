/** Bottom-anchored portrait controls, advanced command disclosure, and movable auxiliary panels. */
import { icon } from './icons';

const MQ = '(max-width: 560px) and (orientation: portrait)';
const KEY = 'lineage.hud.v2';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Saved { pos: Record<string, [number, number]>; pinned: boolean; folded: boolean; jobsPinned: boolean; objMin: boolean }

export interface BubbleHooks {
  notify(msg: string): void;
}

export class Bubbles {
  phone = false;
  private saved: Saved = { pos: {}, pinned: false, folded: false, jobsPinned: false, objMin: false };
  private selectionKey = '';
  private selectionHeight = -1;
  private mq = window.matchMedia(MQ);
  private panels: { id: string; el: HTMLElement; ymin: number }[] = [];

  constructor(private onChange: () => void, private hooks: BubbleHooks) {
    try { Object.assign(this.saved, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { /* corrupt or unavailable */ }
    if (!this.saved.pos) this.saved.pos = {};

    // Legacy floating-card positions never override the new bottom-anchored command dock.
    this.saved.folded = true;
    this.draggable($('ogrip'), $('objectives'), 'objectives');
    this.draggable($('jgrip'), $('jobs'), 'jobs');

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
    window.addEventListener('resize', () => { this.place(); this.onChange(); });
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
      if (phone) { $('bbody').append($('selpanel'), $('cmdcard')); app.insertBefore($('dock'), $('fab'));  }
      else { $('hud').append($('selpanel'), $('cmdcard')); app.insertBefore($('dock'), $('fab')); this.closeFab(); }
      $('fab').classList.add('hidden');
      this.onChange();
    }
    this.paint(); this.place();
  }

  paint() {
    const s = this.saved;
    $('bpin').innerHTML = `${icon(s.pinned ? 'pin' : 'pinoff')}<em>${s.pinned ? 'Pinned' : ''}</em>`;
    $('bpin').classList.toggle('on', s.pinned);
    $('bfold').innerHTML = `${icon(s.folded ? 'chevup' : 'chevdown')}<span>${s.folded ? 'More' : 'Less'}</span>`;
    $('bfold').setAttribute('aria-label', s.folded ? 'More commands' : 'Fewer commands');
    $('bfold').setAttribute('aria-expanded', String(!s.folded));
    $('bfold').setAttribute('aria-controls', 'cmds');
    $('bubble').classList.toggle('folded', s.folded);
    $('bubble').classList.toggle('pinned', s.pinned && !this.phone);
    $('fabbtn').innerHTML = icon($('fab').classList.contains('open') ? 'close' : 'discover');
    $('jpin').innerHTML = `${icon(s.jobsPinned ? 'pin' : 'pinoff')}`; $('jpin').classList.toggle('on', s.jobsPinned);
    $('jclose').innerHTML = icon('close');
    $('omin').innerHTML = icon(s.objMin ? 'chevd' : 'chevup');
    $('objectives').classList.toggle('pill', s.objMin);
    this.paintCommands();
  }

  private paintCommands() {
    const hideAdvanced = this.phone && this.saved.folded && $('cmds').classList.contains('unit-commands');
    for (const button of $('cmds').querySelectorAll<HTMLElement>('.cb')) button.toggleAttribute('hidden', hideAdvanced && !button.classList.contains('quick'));
  }

  /** Show primary commands immediately; only advanced commands collapse on a new selection. */
  update(hasSelection: boolean, key = '', units = false) {
    if (!this.phone) return;
    if (key !== this.selectionKey) { this.selectionKey = key; this.saved.folded = true; this.paint(); }
    $('bubble').classList.toggle('unit-selection', units);
    this.paintCommands();
    $('bubble').classList.toggle('hidden', !hasSelection);
    const height = hasSelection ? Math.ceil($('bubble').getBoundingClientRect().height) : 0;
    if (height !== this.selectionHeight) {
      this.selectionHeight = height; $('app').style.setProperty('--selection-h', `${height}px`); this.onChange();
    }
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
      const sv = this.saved.pos[p.id];
      if (!sv || p.el.classList.contains('hidden')) continue;
      p.el.classList.add('dragged');
      const q = this.clamp(p.el, sv[0] * W, sv[1] * H, p.ymin); p.el.style.left = `${q.x}px`; p.el.style.top = `${q.y}px`;
    }
  }

  closeFab() { const f = $('fab'); if (f.classList.contains('open')) { f.classList.remove('open'); this.paint(); } }

  /** Make `target` draggable by `handle`; a plain tap calls `onTap`. Positions are remembered as screen fractions. */
  private draggable(handle: HTMLElement, target: HTMLElement, id: string) {
    const ymin = 46;
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
      if (e.pointerId !== ptr) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 7) return;
      if (!moved) { moved = true; target.classList.add('dragged', 'moving'); }
      const p = this.clamp(target, ox + e.clientX - sx, oy + e.clientY - sy, ymin);
      target.style.left = `${p.x}px`; target.style.top = `${p.y}px`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== ptr) return; ptr = -1; target.classList.remove('moving');
      if (moved) {
        const r = target.getBoundingClientRect();
        this.saved.pos[id] = [r.left / window.innerWidth, r.top / window.innerHeight]; this.persist();
      }
    };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
}
