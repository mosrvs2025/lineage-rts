import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { placeCheck } from '../sim/commands';
import { SUPPLY_RANGE, isExplored, isVisible } from '../sim/rules';
import type { Building, BuildingKind, ResNode, Unit, World } from '../sim/types';
import { isWinter } from '../sim/util';
import type { Camera } from './camera';

const T = 24; // baked terrain pixels per tile

export interface Overlay {
  selUnits: number[];
  selBuilding: number | null;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  place: { kind: BuildingKind; tx: number; ty: number } | null;
  alpha: number;
  pings: { x: number; y: number; age: number; c: string }[];
}

const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export class Renderer {
  ctx: CanvasRenderingContext2D;
  terrain: HTMLCanvasElement | null = null;
  fog: HTMLCanvasElement;
  fogCtx: CanvasRenderingContext2D;
  snow: { x: number; y: number; s: number }[] = [];
  winterLevel = 0;
  dpr = 1;
  private bakedFor: World | null = null;

  constructor(public canvas: HTMLCanvasElement, public cam: Camera) {
    this.ctx = canvas.getContext('2d')!;
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d')!;
    for (let i = 0; i < 90; i++) this.snow.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.cam.setSize(r.width, r.height);
  }

  bake(w: World) {
    const c = document.createElement('canvas');
    c.width = w.W * T; c.height = w.H * T;
    const g = c.getContext('2d')!;
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const ch = w.terrain[y][x], r = hash(x, y);
      let col: string;
      if (ch === '~') col = `hsl(205 ${48 + r * 8}% ${38 + r * 5}%)`;
      else if (ch === '=') col = `hsl(45 ${35 + r * 10}% ${62 + r * 6}%)`;
      else if (ch === '^') col = `hsl(250 6% ${34 + r * 10}%)`;
      else col = `hsl(${94 + r * 8} ${34 + r * 5}% ${41 + r * 2.5}%)`;
      g.fillStyle = col; g.fillRect(x * T, y * T, T + 1, T + 1);
      if (ch === '~' && r > 0.55) { g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.moveTo(x * T + 4, y * T + 8 + r * 8); g.quadraticCurveTo(x * T + 12, y * T + 4 + r * 8, x * T + 20, y * T + 8 + r * 8); g.stroke(); }
      if (ch === '=') { g.fillStyle = 'rgba(80,120,160,.25)'; g.fillRect(x * T + 3, y * T + 6 + r * 6, 8, 2); }
      if (ch === '^') { g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(x * T + 2, y * T + T - 3); g.lineTo(x * T + T / 2, y * T + 3 + r * 4); g.lineTo(x * T + T - 2, y * T + T - 3); g.fill(); g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(x * T + T / 2 - 3, y * T + 9 + r * 4); g.lineTo(x * T + T / 2, y * T + 3 + r * 4); g.lineTo(x * T + T / 2 + 3, y * T + 9 + r * 4); g.fill(); }
      if (ch === '.' && r > 0.8) { g.fillStyle = 'rgba(30,70,20,.25)'; g.fillRect(x * T + r * 12, y * T + r * 10, 2, 4); g.fillRect(x * T + 4 + r * 10, y * T + 12, 2, 3); }
    }
    this.terrain = c; this.bakedFor = w;
    this.fog.width = w.W; this.fog.height = w.H;
  }

  // ------------------------------------------------------------------ frame
  draw(w: World, ov: Overlay, time: number) {
    if (this.bakedFor !== w || !this.terrain) this.bake(w);
    const { ctx, cam } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#10130f'; ctx.fillRect(0, 0, cam.vw, cam.vh);
    const z = cam.zoom;
    const o = cam.toScreen(0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrain!, o.x, o.y, w.W * z, w.H * z);

    // winter level eases in/out
    const target = isWinter(w) ? 1 : 0;
    this.winterLevel += (target - this.winterLevel) * 0.02;

    this.drawLandmarks(w, time);
    this.drawSupply(w);
    const sel = new Set(ov.selUnits);
    for (const n of w.nodes) this.drawNode(w, n);
    for (const b of w.buildings) this.drawBuilding(w, b, b.id === ov.selBuilding);
    const us = [...w.units].sort((a, b) => a.y - b.y);
    for (const u of us) this.drawUnit(w, u, sel.has(u.id), ov.alpha);
    this.drawFx(w);
    this.drawFog(w);
    this.drawWinter(time);
    this.drawOrders(w, ov);
    for (const p of ov.pings) {
      const q = cam.toScreen(p.x, p.y);
      ctx.strokeStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - p.age / 0.7); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, 6 + p.age * 30, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (ov.place) this.drawGhost(w, ov.place);
    if (ov.box) {
      ctx.strokeStyle = '#9fe870'; ctx.fillStyle = 'rgba(159,232,112,.15)'; ctx.lineWidth = 1.5;
      const bx = Math.min(ov.box.x0, ov.box.x1), by = Math.min(ov.box.y0, ov.box.y1);
      ctx.fillRect(bx, by, Math.abs(ov.box.x1 - ov.box.x0), Math.abs(ov.box.y1 - ov.box.y0));
      ctx.strokeRect(bx, by, Math.abs(ov.box.x1 - ov.box.x0), Math.abs(ov.box.y1 - ov.box.y0));
    }
  }

  private visibleRect(pad = 2) {
    const a = this.cam.toWorld(0, 0), b = this.cam.toWorld(this.cam.vw, this.cam.vh);
    return { x0: a.x - pad, y0: a.y - pad, x1: b.x + pad, y1: b.y + pad };
  }

  private drawLandmarks(w: World, time: number) {
    const { ctx, cam } = this;
    for (const l of w.landmarks) {
      if (!isExplored(w, l.x, l.y)) continue;
      const p = cam.toScreen(l.x + 0.5, l.y + 0.5), z = cam.zoom;
      if (l.id === 'cave') {
        ctx.fillStyle = '#26211d'; ctx.beginPath(); ctx.ellipse(p.x, p.y, z * 1.1, z * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,${150 + 40 * Math.sin(time * 4)},60,.9)`; ctx.beginPath(); ctx.arc(p.x, p.y + z * 0.1, z * 0.28, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255,240,150,.18)'; ctx.beginPath(); ctx.arc(p.x, p.y, z * 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,150,.7)'; ctx.setLineDash([z * 0.3, z * 0.3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      }
      if (z > 18) { ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `600 ${Math.max(10, z * 0.4)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.fillText(l.name, p.x, p.y - z * (l.id === 'cave' ? 1.1 : 4.8)); }
    }
  }

  private drawSupply(w: World) {
    const { ctx, cam } = this;
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]);
    for (const b of w.buildings) {
      if (b.owner !== 0 || !b.done || (b.kind !== 'hearth' && b.kind !== 'watch')) continue;
      const p = cam.toScreen(b.x + b.w / 2, b.y + b.h / 2);
      ctx.beginPath(); ctx.arc(p.x, p.y, SUPPLY_RANGE * cam.zoom, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawNode(w: World, n: ResNode) {
    if (!isExplored(w, n.x, n.y)) return;
    const { ctx, cam } = this, z = cam.zoom;
    const r = this.visibleRect(); if (n.x < r.x0 || n.x > r.x1 || n.y < r.y0 || n.y > r.y1) return;
    const p = cam.toScreen(n.x + 0.5, n.y + 0.5);
    const snow = this.winterLevel;
    if (n.kind === 'tree') {
      const h = hash(n.x, n.y);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(p.x + z * 0.1, p.y + z * 0.28, z * 0.4, z * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5b3d22'; ctx.fillRect(p.x - z * 0.07, p.y, z * 0.14, z * 0.35);
      ctx.fillStyle = `hsl(${118 + h * 20} 40% ${24 + h * 6}%)`; ctx.beginPath(); ctx.arc(p.x, p.y - z * 0.12, z * 0.46, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsl(${120 + h * 20} 42% ${32 + h * 6}%)`; ctx.beginPath(); ctx.arc(p.x - z * 0.1, p.y - z * 0.22, z * 0.26, 0, Math.PI * 2); ctx.fill();
      if (snow > 0.1) { ctx.fillStyle = `rgba(255,255,255,${snow * 0.7})`; ctx.beginPath(); ctx.arc(p.x - z * 0.05, p.y - z * 0.3, z * 0.25, 0, Math.PI * 2); ctx.fill(); }
    } else if (n.kind === 'bush') {
      const full = n.amount / n.max;
      ctx.fillStyle = '#3b7a2f'; ctx.beginPath(); ctx.arc(p.x, p.y, z * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = full > 0.15 ? '#d6403f' : '#6a5a40';
      for (let i = 0; i < 5; i++) { const a = i * 1.3 + n.x; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * z * 0.2, p.y + Math.sin(a) * z * 0.2, z * 0.07, 0, Math.PI * 2); ctx.fill(); }
    } else if (n.kind === 'rock') {
      ctx.fillStyle = '#8b8d93'; ctx.beginPath(); ctx.moveTo(p.x - z * 0.4, p.y + z * 0.3); ctx.lineTo(p.x - z * 0.25, p.y - z * 0.3); ctx.lineTo(p.x + z * 0.15, p.y - z * 0.38); ctx.lineTo(p.x + z * 0.42, p.y + z * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.moveTo(p.x - z * 0.25, p.y - z * 0.3); ctx.lineTo(p.x + z * 0.15, p.y - z * 0.38); ctx.lineTo(p.x, p.y - z * 0.05); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = '#9b6a4a'; ctx.beginPath(); ctx.ellipse(p.x, p.y, z * 0.38, z * 0.24, 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d9a37c'; ctx.beginPath(); ctx.arc(p.x + z * 0.25, p.y - z * 0.05, z * 0.1, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawBuilding(w: World, b: Building, selected: boolean) {
    if (b.owner !== 0 && !isExplored(w, b.x + b.w / 2, b.y + b.h / 2)) return;
    const { ctx, cam } = this, z = cam.zoom;
    const p = cam.toScreen(b.x, b.y), pw = b.w * z, ph = b.h * z;
    const def = BUILDINGS[b.kind];
    const base = b.owner === 0 ? { hearth: '#b0743a', shelter: '#a8845a', stockpile: '#8d7a52', toolshelter: '#7d7f86', lodge: '#8a5a3c', circle: '#a9a27a', rack: '#b88a4a', watch: '#8c6a44', palisade: '#7a5632' }[b.kind]
      : { hearth: '#a14a3a', shelter: '#935245', watch: '#7e4638' }[b.kind as 'hearth'] ?? '#8d4a3d';
    ctx.globalAlpha = b.done ? 1 : 0.55;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(p.x + 3, p.y + 4, pw, ph);
    ctx.fillStyle = base;
    if (b.kind === 'palisade') { ctx.fillRect(p.x + z * 0.1, p.y + z * 0.1, pw - z * 0.2, ph - z * 0.2); ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 3; i++) ctx.fillRect(p.x + z * (0.2 + i * 0.28), p.y + z * 0.1, 1.5, ph - z * 0.2); }
    else if (b.kind === 'circle') { ctx.beginPath(); ctx.arc(p.x + pw / 2, p.y + ph / 2, pw / 2 - 2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,.2)'; for (let i = 0; i < 7; i++) { const a = i * 0.9; ctx.beginPath(); ctx.arc(p.x + pw / 2 + Math.cos(a) * pw * 0.35, p.y + ph / 2 + Math.sin(a) * ph * 0.35, z * 0.14, 0, Math.PI * 2); ctx.fill(); } }
    else {
      const rr = Math.min(8, z * 0.25);
      ctx.beginPath(); ctx.roundRect(p.x + 2, p.y + 2, pw - 4, ph - 4, rr); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.roundRect(p.x + 2, p.y + ph * 0.55, pw - 4, ph * 0.45 - 2, rr); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (b.kind === 'hearth') {
      const t = performance.now() / 160;
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(p.x + pw / 2, p.y + ph / 2, z * (0.38 + 0.03 * Math.sin(t)), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff1a8'; ctx.beginPath(); ctx.arc(p.x + pw / 2, p.y + ph / 2, z * 0.18, 0, Math.PI * 2); ctx.fill();
    } else if (b.kind !== 'palisade' && z > 14) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `700 ${Math.min(26, z * 0.7)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(def.glyph, p.x + pw / 2, p.y + ph / 2); ctx.textBaseline = 'alphabetic';
    }
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? '#fff6a0' : b.owner === 0 ? '#5fd0c4' : '#e0604f';
    if (b.kind === 'circle') { ctx.beginPath(); ctx.arc(p.x + pw / 2, p.y + ph / 2, pw / 2 - 2, 0, Math.PI * 2); ctx.stroke(); } else ctx.strokeRect(p.x + 1, p.y + 1, pw - 2, ph - 2);
    if (b.outpost) { ctx.fillStyle = '#ffe36e'; ctx.font = `700 ${Math.max(10, z * 0.4)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('OUTPOST', p.x + pw / 2, p.y - 4); }
    if (!b.done) this.bar(p.x + 2, p.y + ph + 3, pw - 4, 5, b.progress, '#ffd54a');
    else if (b.hp < b.maxHp) this.bar(p.x + 2, p.y - 7, pw - 4, 5, b.hp / b.maxHp, b.hp / b.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
    if (b.queue.length && b.done) { const q = b.queue[0]; this.bar(p.x + 2, p.y + ph + 3, pw - 4, 5, 1 - q.t / UNITS[q.kind].time, '#7ec8ff'); }
    if (selected && def.warmth) {
      ctx.strokeStyle = 'rgba(255,170,80,.5)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(p.x + pw / 2, p.y + ph / 2, (def.warmth + Math.max(b.w, b.h) / 2) * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  private bar(x: number, y: number, w: number, h: number, f: number, col: string) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.max(0, Math.min(1, f)) * w, h);
  }

  private drawUnit(w: World, u: Unit, selected: boolean, alpha: number) {
    if (u.owner !== 0 && !isVisible(w, u.x, u.y)) return;
    const { ctx, cam } = this, z = cam.zoom;
    const def = UNITS[u.kind];
    const x = u.ox + (u.x - u.ox) * alpha, y = u.oy + (u.y - u.oy) * alpha;
    const p = cam.toScreen(x, y), rad = Math.max(5, def.radius * z);
    if (p.x < -40 || p.y < -40 || p.x > cam.vw + 40 || p.y > cam.vh + 40) return;
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + rad * 0.7, rad * 0.9, rad * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    let col = u.owner === 0 ? '#3fb8c4' : u.owner === 1 ? '#d65a45' : u.kind === 'wolf' ? '#6c6f78' : '#b08a5a';
    if (u.owner === 0 && u.gen >= 2) col = '#58c9a0';
    if (selected) { ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, rad + 4, 0, Math.PI * 2); ctx.stroke(); }
    if (u.buff > 0) { ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, rad + 7, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = col; ctx.beginPath();
    if (u.kind === 'deer' || u.kind === 'wolf') ctx.ellipse(p.x, p.y, rad * 1.1, rad * 0.8, 0, 0, Math.PI * 2);
    else if (u.kind === 'guard') ctx.roundRect(p.x - rad, p.y - rad, rad * 2, rad * 2, 4);
    else if (u.kind === 'raider') { ctx.moveTo(p.x, p.y - rad * 1.15); ctx.lineTo(p.x + rad * 1.05, p.y + rad * 0.8); ctx.lineTo(p.x - rad * 1.05, p.y + rad * 0.8); ctx.closePath(); }
    else if (u.kind === 'leader') { for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * (Math.PI * 2 / 5), a2 = a + Math.PI / 5; ctx.lineTo(p.x + Math.cos(a) * rad * 1.3, p.y + Math.sin(a) * rad * 1.3); ctx.lineTo(p.x + Math.cos(a2) * rad * 0.6, p.y + Math.sin(a2) * rad * 0.6); } ctx.closePath(); }
    else ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
    if (cam.zoom > 16 && u.owner !== 2) { ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(9, rad * 1.05)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(def.glyph, p.x, p.y + 0.5); ctx.textBaseline = 'alphabetic'; }
    if (u.carry.n > 0) { ctx.fillStyle = u.carry.res === 'food' ? '#e8574d' : u.carry.res === 'wood' ? '#8a5a2b' : '#aaaeb6'; ctx.beginPath(); ctx.arc(p.x + rad, p.y - rad, 4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
    if (u.owner === 0 && u.order.t === 'research') { ctx.fillStyle = '#ffe36e'; ctx.font = `${Math.max(10, rad)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('?', p.x, p.y - rad - 6); }
    if (selected || u.hp < u.maxHp) this.bar(p.x - rad, p.y - rad - 9, rad * 2, 4, u.hp / u.maxHp, u.hp / u.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
  }

  private drawFx(w: World) {
    const { ctx, cam } = this;
    for (const f of w._fx ?? []) {
      const a = cam.toScreen(f.x1, f.y1), b = cam.toScreen(f.x2, f.y2);
      ctx.strokeStyle = f.c; ctx.lineWidth = 2.5; ctx.globalAlpha = Math.min(1, f.t * 6);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (a.x === b.x && a.y === b.y) { ctx.beginPath(); ctx.arc(a.x, a.y, 8, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
  }

  private drawFog(w: World) {
    if (!w._vis || !w._exp) return;
    const { cam } = this;
    const img = this.fogCtx.createImageData(w.W, w.H);
    for (let i = 0; i < w.W * w.H; i++) {
      const v = w._vis[i], e = w._exp[i];
      img.data[i * 4] = 8; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 14;
      img.data[i * 4 + 3] = v === 2 ? 0 : e ? 120 : 255;
    }
    this.fogCtx.putImageData(img, 0, 0);
    const o = cam.toScreen(0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.fog, o.x, o.y, w.W * cam.zoom, w.H * cam.zoom);
  }

  private drawWinter(time: number) {
    const L = this.winterLevel; if (L < 0.02) return;
    const { ctx, cam } = this;
    ctx.fillStyle = `rgba(190,215,245,${0.22 * L})`; ctx.fillRect(0, 0, cam.vw, cam.vh);
    ctx.fillStyle = `rgba(255,255,255,${0.8 * L})`;
    for (const s of this.snow) {
      const x = ((s.x + Math.sin(time * 0.5 + s.y * 9) * 0.02) % 1) * cam.vw, y = ((s.y + time * 0.05 * s.s) % 1) * cam.vh;
      ctx.beginPath(); ctx.arc(x, y, 1.2 + s.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawOrders(w: World, ov: Overlay) {
    const { ctx, cam } = this;
    ctx.save(); ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
    for (const id of ov.selUnits) {
      const u = w._u?.get(id); if (!u) continue;
      let tx: number | null = null, ty: number | null = null, c = 'rgba(255,255,255,.6)';
      const o = u.order;
      if (o.t === 'move' || o.t === 'amove' || o.t === 'flee') { tx = o.x; ty = o.y; if (o.t === 'amove') c = 'rgba(255,120,100,.8)'; }
      else if (o.t === 'attack') { const t = w._u?.get(o.target) ?? w._b?.get(o.target); if (t) { tx = 'progress' in t ? t.x + t.w / 2 : t.x; ty = 'progress' in t ? t.y + t.h / 2 : t.y; c = 'rgba(255,120,100,.8)'; } }
      else if (o.t === 'gather') { const n = w._n?.get(o.node); if (n) { tx = n.x + 0.5; ty = n.y + 0.5; c = 'rgba(160,255,160,.7)'; } }
      else if (o.t === 'build') { const b = w._b?.get(o.b); if (b) { tx = b.x + b.w / 2; ty = b.y + b.h / 2; c = 'rgba(255,220,120,.8)'; } }
      if (tx === null || ty === null) continue;
      const a = cam.toScreen(u.x, u.y), b = cam.toScreen(tx, ty);
      ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawGhost(w: World, pl: NonNullable<Overlay['place']>) {
    const { ctx, cam } = this, z = cam.zoom, d = BUILDINGS[pl.kind];
    const chk = placeCheck(w, pl.kind, pl.tx, pl.ty);
    const p = cam.toScreen(pl.tx, pl.ty);
    ctx.fillStyle = chk.ok ? 'rgba(120,255,150,.35)' : 'rgba(255,90,80,.38)';
    ctx.fillRect(p.x, p.y, d.w * z, d.h * z);
    ctx.strokeStyle = chk.ok ? '#8dff9f' : '#ff6a5c'; ctx.lineWidth = 2; ctx.strokeRect(p.x, p.y, d.w * z, d.h * z);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.min(22, z * 0.6)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText(d.glyph, p.x + (d.w * z) / 2, p.y + (d.h * z) / 2 + 6);
    if (d.warmth) { ctx.strokeStyle = 'rgba(255,170,80,.45)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(p.x + (d.w * z) / 2, p.y + (d.h * z) / 2, d.warmth * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (!chk.ok) {
      ctx.font = `600 ${Math.max(11, z * 0.38)}px system-ui`; const tw = ctx.measureText(chk.reason).width + 12;
      ctx.fillStyle = 'rgba(20,10,10,.85)'; ctx.fillRect(p.x + (d.w * z) / 2 - tw / 2, p.y - 24, tw, 20);
      ctx.fillStyle = '#ffb3a8'; ctx.fillText(chk.reason, p.x + (d.w * z) / 2, p.y - 9);
    }
  }

  // ------------------------------------------------------------------ minimap
  drawMinimap(w: World, c: HTMLCanvasElement) {
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const sx = c.width / w.W, sy = c.height / w.H;
    if (this.terrain) g.drawImage(this.terrain, 0, 0, c.width, c.height);
    for (const n of w.nodes) {
      if (!isExplored(w, n.x, n.y) || n.kind === 'carcass') continue;
      g.fillStyle = n.kind === 'tree' ? '#1f5a22' : n.kind === 'rock' ? '#bbb' : '#c44';
      g.fillRect(n.x * sx, n.y * sy, Math.max(1, sx), Math.max(1, sy));
    }
    for (const b of w.buildings) {
      if (b.owner !== 0 && !isExplored(w, b.x, b.y)) continue;
      g.fillStyle = b.owner === 0 ? '#5fe0d0' : '#ff6a55';
      g.fillRect(b.x * sx - 1, b.y * sy - 1, b.w * sx + 2, b.h * sy + 2);
    }
    for (const u of w.units) {
      if (u.owner !== 0 && !isVisible(w, u.x, u.y)) continue;
      g.fillStyle = u.owner === 0 ? '#bff' : u.owner === 1 ? '#f66' : '#cb8';
      g.fillRect(u.x * sx - 1, u.y * sy - 1, 3, 3);
    }
    if (w._vis && w._exp) {
      const img = g.getImageData(0, 0, c.width, c.height);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = Math.floor(y / sy) * w.W + Math.floor(x / sx), v = w._vis[i], e = w._exp[i];
        if (v === 2) continue;
        const k = e ? 0.55 : 1, o = (y * c.width + x) * 4;
        img.data[o] *= 1 - k; img.data[o + 1] *= 1 - k; img.data[o + 2] *= 1 - k;
      }
      g.putImageData(img, 0, 0);
    }
    const a = this.cam.toWorld(0, 0), b = this.cam.toWorld(this.cam.vw, this.cam.vh);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(a.x * sx, a.y * sy, (b.x - a.x) * sx, (b.y - a.y) * sy);
  }
}
