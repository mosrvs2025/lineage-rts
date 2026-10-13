import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { placeCheck } from '../sim/commands';
import { SUPPLY_RANGE, hasDisc, isExplored, isVisible } from '../sim/rules';
import type { Building, BuildingKind, ResNode, Unit, World } from '../sim/types';
import { isWinter } from '../sim/util';
import { Art, bakeTerrain, hash2 } from './art';
import type { Camera } from './camera';

const U = 64; // building sprite pixels per tile

export interface Overlay {
  selUnits: number[];
  selBuilding: number | null;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  place: { kind: BuildingKind; tx: number; ty: number } | null;
  alpha: number;
  pings: { x: number; y: number; age: number; c: string }[];
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  terrain: HTMLCanvasElement | null = null;
  fog: HTMLCanvasElement;
  fogCtx: CanvasRenderingContext2D;
  private fogTick = -99;
  private art = new Art();
  private water: [number, number][] = [];
  private facing = new Map<number, number>();
  private snow: { x: number; y: number; s: number }[] = [];
  winterLevel = 0;
  dpr = 1;
  private bakedFor: World | null = null;
  private vignette: { w: number; h: number; c: HTMLCanvasElement } | null = null;

  constructor(public canvas: HTMLCanvasElement, public cam: Camera) {
    this.ctx = canvas.getContext('2d')!;
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d')!;
    for (let i = 0; i < 110; i++) this.snow.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() });
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.cam.setSize(r.width, r.height);
    this.vignette = null;
  }

  bake(w: World) {
    this.terrain = bakeTerrain(w);
    this.bakedFor = w;
    this.water = [];
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) if (w.terrain[y][x] === '~' || w.terrain[y][x] === '=') this.water.push([x, y]);
    this.fog.width = w.W * 4; this.fog.height = w.H * 4;
    this.fogTick = -99;
  }

  // ------------------------------------------------------------------ frame
  draw(w: World, ov: Overlay, time: number) {
    if (this.bakedFor !== w || !this.terrain) this.bake(w);
    const { ctx, cam } = this;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d100c'; ctx.fillRect(0, 0, cam.vw, cam.vh);
    const z = cam.zoom;
    const o = cam.toScreen(0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain!, o.x, o.y, w.W * z, w.H * z);

    const target = isWinter(w) ? 1 : 0;
    this.winterLevel += (target - this.winterLevel) * 0.02;

    this.drawWater(time);
    this.drawLandmarks(w, time);
    this.drawSupply(w);
    const sel = new Set(ov.selUnits);

    // everything that stands on the ground, sorted back-to-front
    type Item = { y: number; f: () => void };
    const items: Item[] = [];
    const r = this.visibleRect(3);
    for (const n of w.nodes) {
      if (n.x < r.x0 || n.x > r.x1 || n.y < r.y0 || n.y > r.y1 || !isExplored(w, n.x, n.y)) continue;
      items.push({ y: n.y + 0.85, f: () => this.drawNode(n, time) });
    }
    for (const b of w.buildings) {
      if (b.x + b.w < r.x0 || b.x > r.x1 || b.y + b.h < r.y0 - 2 || b.y > r.y1) continue;
      if (b.owner !== 0 && !isExplored(w, b.x + b.w / 2, b.y + b.h / 2)) continue;
      items.push({ y: b.y + b.h, f: () => this.drawBuilding(w, b, b.id === ov.selBuilding, time) });
    }
    for (const u of w.units) {
      if (u.owner !== 0 && !isVisible(w, u.x, u.y)) continue;
      const y = u.oy + (u.y - u.oy) * ov.alpha;
      if (y < r.y0 || y > r.y1) continue;
      items.push({ y: y + 0.01, f: () => this.drawUnit(w, u, sel.has(u.id), ov.alpha, time) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();

    this.drawFx(w);
    this.drawLights(w, time);
    this.drawFog(w);
    this.drawAtmosphere(time);
    this.drawOrders(w, ov);
    for (const p of ov.pings) {
      const q = cam.toScreen(p.x, p.y);
      ctx.strokeStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - p.age / 0.7); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(q.x, q.y, 6 + p.age * 30, (6 + p.age * 30) * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
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

  // ------------------------------------------------------------------ ground effects
  private drawWater(time: number) {
    const { ctx, cam } = this, z = cam.zoom;
    if (z < 12) return;
    const r = this.visibleRect(1);
    ctx.save(); ctx.lineCap = 'round';
    for (const [x, y] of this.water) {
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      for (let k = 0; k < 2; k++) {
        const hh = hash2(x, y, k + 3), t = time * 0.5 + hh * 6.28;
        const a = 0.5 + 0.5 * Math.sin(t);
        if (a < 0.45) continue;
        const px = x + hh, py = y + hash2(x, y, k + 9) + Math.sin(t * 0.7) * 0.08;
        const s = cam.toScreen(Math.min(x + 0.9, px), Math.min(y + 0.95, py));
        ctx.strokeStyle = `rgba(255,255,255,${(a - 0.45) * 0.55})`; ctx.lineWidth = Math.max(1, z * 0.04);
        ctx.beginPath(); ctx.moveTo(s.x - z * 0.16, s.y); ctx.quadraticCurveTo(s.x, s.y - z * 0.06, s.x + z * 0.16, s.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawLandmarks(w: World, time: number) {
    const { ctx, cam } = this, z = cam.zoom;
    for (const l of w.landmarks) {
      if (!isExplored(w, l.x, l.y)) continue;
      const p = cam.toScreen(l.x + 0.5, l.y + 0.5);
      if (l.id === 'cave') {
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(p.x + z * 0.2, p.y + z * 0.7, z * 1.5, z * 0.4, 0, 0, 7); ctx.fill();
        const g = ctx.createLinearGradient(p.x - z * 1.4, 0, p.x + z * 1.4, 0); g.addColorStop(0, '#9a9ba4'); g.addColorStop(0.6, '#6a6b76'); g.addColorStop(1, '#43444f');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x - z * 1.5, p.y + z * 0.7); ctx.quadraticCurveTo(p.x - z * 1.3, p.y - z * 1.3, p.x, p.y - z * 1.4); ctx.quadraticCurveTo(p.x + z * 1.3, p.y - z * 1.2, p.x + z * 1.5, p.y + z * 0.7); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(20,20,30,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#16100c'; ctx.beginPath(); ctx.ellipse(p.x, p.y + z * 0.2, z * 0.7, z * 0.75, 0, Math.PI, 0); ctx.lineTo(p.x + z * 0.7, p.y + z * 0.7); ctx.lineTo(p.x - z * 0.7, p.y + z * 0.7); ctx.fill();
        this.glow(p.x, p.y + z * 0.3, z * 2.2, 0.35 + 0.1 * Math.sin(time * 5), '255,150,50');
        this.flame(p.x, p.y + z * 0.45, z * 0.5, time, 3);
      } else {
        ctx.save();
        ctx.fillStyle = 'rgba(255,240,150,.10)'; ctx.beginPath(); ctx.arc(p.x, p.y, z * 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,150,.55)'; ctx.setLineDash([z * 0.3, z * 0.3]); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
      }
      if (z > 16) {
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.font = `700 ${Math.max(10, z * 0.4)}px system-ui,sans-serif`; ctx.textAlign = 'center';
        const ty = p.y - z * (l.id === 'cave' ? 1.7 : 4.8);
        ctx.fillText(l.name, p.x + 1, ty + 1); ctx.fillStyle = '#fff4cc'; ctx.fillText(l.name, p.x, ty);
      }
    }
  }

  private drawSupply(w: World) {
    const { ctx, cam } = this;
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 9]);
    for (const b of w.buildings) {
      if (b.owner !== 0 || !b.done || (b.kind !== 'hearth' && b.kind !== 'watch')) continue;
      const p = cam.toScreen(b.x + b.w / 2, b.y + b.h / 2);
      ctx.beginPath(); ctx.arc(p.x, p.y, SUPPLY_RANGE * cam.zoom, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ light, fire and smoke
  private glow(x: number, y: number, r: number, a: number, rgb: string) {
    const { ctx } = this;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  private flame(x: number, y: number, s: number, time: number, n = 4) {
    const { ctx } = this;
    for (let i = 0; i < n; i++) {
      const ph = time * (9 + i * 1.7) + i * 2.1, fl = 0.75 + 0.25 * Math.sin(ph);
      const ox = (i - (n - 1) / 2) * s * 0.34 + Math.sin(ph * 0.7) * s * 0.06, hgt = s * (0.9 + 0.25 * (i % 2)) * fl;
      const g = ctx.createLinearGradient(0, y, 0, y - hgt);
      g.addColorStop(0, '#ff7a1a'); g.addColorStop(0.55, '#ffc23a'); g.addColorStop(1, 'rgba(255,240,160,0)');
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(x + ox - s * 0.2, y); ctx.quadraticCurveTo(x + ox - s * 0.18, y - hgt * 0.55, x + ox + Math.sin(ph) * s * 0.08, y - hgt);
      ctx.quadraticCurveTo(x + ox + s * 0.2, y - hgt * 0.5, x + ox + s * 0.2, y); ctx.closePath(); ctx.fill();
    }
  }

  private smoke(x: number, y: number, s: number, time: number, n = 6, speed = 0.35) {
    const { ctx } = this;
    for (let i = 0; i < n; i++) {
      const t = (time * speed + i / n) % 1;
      const px = x + Math.sin(time * 0.6 + i * 2) * s * 0.25 * t + t * s * 0.35, py = y - t * s * 2.4;
      ctx.fillStyle = `rgba(210,210,215,${0.38 * (1 - t) * Math.min(1, t * 6)})`;
      ctx.beginPath(); ctx.arc(px, py, s * (0.16 + t * 0.34), 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawLights(w: World, time: number) {
    const { cam } = this, z = cam.zoom;
    const level = 0.22 + this.winterLevel * 0.18;
    for (const b of w.buildings) {
      if (!b.done || (b.kind !== 'hearth' && b.kind !== 'circle')) continue;
      if (b.owner !== 0 && !isExplored(w, b.x, b.y)) continue;
      const p = cam.toScreen(b.x + b.w / 2, b.y + b.h / 2 + 0.1);
      const big = b.kind === 'hearth' ? 7 : 3.4;
      this.glow(p.x, p.y, z * big, level * (0.9 + 0.1 * Math.sin(time * 7 + b.id)), '255,150,60');
    }
    for (const u of w.units) {
      if (u.owner !== 0 || !hasDisc(w, 'portable') || !['hunter', 'guard', 'leader'].includes(u.kind)) continue;
      const p = cam.toScreen(u.x, u.y);
      this.glow(p.x, p.y - z * 0.6, z * 2, 0.16 + 0.04 * Math.sin(time * 9 + u.id), '255,170,70');
    }
  }

  private drawAtmosphere(time: number) {
    const { ctx, cam } = this;
    // drifting cloud shadows
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 0.31 + time * 0.004 * (0.6 + i * 0.1)) % 1.3 - 0.15) * cam.vw, cy = (0.1 + ((i * 0.23) % 0.9)) * cam.vh;
      const r = cam.vw * (0.18 + (i % 3) * 0.05);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(10,20,30,.10)'); g.addColorStop(1, 'rgba(10,20,30,0)');
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    // warm autumn light, cold winter light
    const L = this.winterLevel;
    ctx.fillStyle = `rgba(255,190,110,${0.07 * (1 - L)})`; ctx.fillRect(0, 0, cam.vw, cam.vh);
    if (L > 0.02) {
      ctx.fillStyle = `rgba(170,200,240,${0.2 * L})`; ctx.fillRect(0, 0, cam.vw, cam.vh);
      ctx.fillStyle = `rgba(240,248,255,${0.16 * L})`; ctx.fillRect(0, 0, cam.vw, cam.vh);
      ctx.fillStyle = `rgba(255,255,255,${0.85 * L})`;
      for (const s of this.snow) {
        const x = ((s.x + Math.sin(time * 0.5 + s.y * 9) * 0.02 + time * 0.01 * s.s) % 1) * cam.vw, y = ((s.y + time * 0.06 * s.s) % 1) * cam.vh;
        ctx.beginPath(); ctx.arc(x, y, 1 + s.s * 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // vignette
    if (!this.vignette || this.vignette.w !== cam.vw || this.vignette.h !== cam.vh) {
      const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(cam.vw / 2)); c.height = Math.max(2, Math.round(cam.vh / 2));
      const g = c.getContext('2d')!; const gr = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.35, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(8,10,16,.55)'); g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
      this.vignette = { w: cam.vw, h: cam.vh, c };
    }
    ctx.drawImage(this.vignette.c, 0, 0, cam.vw, cam.vh);
  }

  // ------------------------------------------------------------------ nature
  private drawNode(n: ResNode, time: number) {
    const { ctx, cam } = this, z = cam.zoom;
    const hh = hash2(n.x, n.y, 4);
    if (n.kind === 'tree') {
      const i = Math.floor(hh * this.art.trees.length), sp = this.art.trees[i];
      const k = (z * (1.9 + hash2(n.x, n.y, 8) * 0.35)) / 128;
      const p = cam.toScreen(n.x + 0.5, n.y + 0.88);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(time * 1.1 + n.x * 0.7 + n.y) * 0.012);
      ctx.drawImage(sp.c, -sp.ax * k, -sp.ay * k, sp.c.width * k, sp.c.height * k);
      if (this.winterLevel > 0.03) { ctx.globalAlpha = Math.min(1, this.winterLevel * 1.1); const sn = this.art.treeSnow[i]; ctx.drawImage(sn.c, -sn.ax * k, -sn.ay * k, sn.c.width * k, sn.c.height * k); }
      ctx.restore();
    } else if (n.kind === 'bush') {
      const sp = n.amount / n.max > 0.25 ? this.art.bushFull : this.art.bushEmpty, k = (z * 1.35) / 96;
      const p = cam.toScreen(n.x + 0.5, n.y + 0.8);
      ctx.drawImage(sp.c, p.x - sp.ax * k, p.y - sp.ay * k, sp.c.width * k, sp.c.height * k);
    } else if (n.kind === 'rock') {
      const sp = this.art.rocks[Math.floor(hh * 3)], k = (z * 1.35) / 96;
      const p = cam.toScreen(n.x + 0.5, n.y + 0.8);
      ctx.drawImage(sp.c, p.x - sp.ax * k, p.y - sp.ay * k, sp.c.width * k, sp.c.height * k);
      if (this.winterLevel > 0.1) { ctx.fillStyle = `rgba(245,250,255,${this.winterLevel * 0.8})`; ctx.beginPath(); ctx.ellipse(p.x, p.y - z * 0.32, z * 0.28, z * 0.1, 0, 0, 7); ctx.fill(); }
    } else {
      const p = cam.toScreen(n.x + 0.5, n.y + 0.55);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + z * 0.12, z * 0.5, z * 0.16, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#9a6b45'; ctx.beginPath(); ctx.ellipse(p.x, p.y, z * 0.46, z * 0.2, 0.15, 0, 7); ctx.fill();
      ctx.fillStyle = '#c99a6e'; ctx.beginPath(); ctx.ellipse(p.x - z * 0.05, p.y + z * 0.05, z * 0.34, z * 0.1, 0.15, 0, 7); ctx.fill();
      ctx.strokeStyle = '#9a6b45'; ctx.lineWidth = z * 0.05; ctx.beginPath(); for (const d of [-0.3, -0.1, 0.12, 0.3]) { ctx.moveTo(p.x + z * d, p.y + z * 0.1); ctx.lineTo(p.x + z * (d + 0.08), p.y + z * 0.3); } ctx.stroke();
      ctx.fillStyle = '#e6c8a4'; ctx.beginPath(); ctx.ellipse(p.x + z * 0.48, p.y - z * 0.05, z * 0.14, z * 0.1, 0, 0, 7); ctx.fill();
    }
  }

  // ------------------------------------------------------------------ buildings
  private drawBuilding(w: World, b: Building, selected: boolean, time: number) {
    const { ctx, cam } = this, z = cam.zoom, k = z / U;
    const sp = this.art.building(b.kind, b.owner === 0 ? 0 : 1, b.w, b.h);
    const p = cam.toScreen(b.x, b.y);
    const dx = p.x - sp.ax * k, dy = p.y - sp.ay * k, dw = sp.c.width * k, dh = sp.c.height * k;
    const cxs = p.x + (b.w * z) / 2, cys = p.y + (b.h * z) / 2;
    if (selected) {
      ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 3; ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.ellipse(cxs, cys + z * 0.25, b.w * z * 0.62, b.h * z * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (b.done) ctx.drawImage(sp.c, dx, dy, dw, dh);
    else {
      ctx.globalAlpha = 0.22; ctx.drawImage(sp.c, dx, dy, dw, dh); ctx.globalAlpha = 1;
      ctx.save(); ctx.beginPath(); const top = dy + dh * (1 - 0.08 - b.progress * 0.92); ctx.rect(dx, top, dw, dh); ctx.clip();
      ctx.drawImage(sp.c, dx, dy, dw, dh); ctx.restore();
      ctx.strokeStyle = 'rgba(255,230,160,.8)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeRect(p.x, p.y, b.w * z, b.h * z); ctx.setLineDash([]);
      for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x + fx * b.w * z, p.y + fy * b.h * z); ctx.lineTo(p.x + fx * b.w * z, p.y + fy * b.h * z - z * 0.5); ctx.stroke(); }
      for (let i = 0; i < 3; i++) { const t = (time * 0.8 + i / 3) % 1; ctx.fillStyle = `rgba(190,170,130,${0.4 * (1 - t)})`; ctx.beginPath(); ctx.arc(cxs + Math.sin(i * 5 + time) * z * 0.4, cys + z * 0.3 - t * z * 0.6, z * (0.1 + t * 0.14), 0, 7); ctx.fill(); }
    }
    // animated parts
    if (b.done) {
      if (b.kind === 'hearth') { this.flame(cxs, cys + z * 0.12, z * 0.62, time, 5); this.smoke(cxs + z * 0.1, cys - z * 0.3, z * 0.7, time, 8); }
      else if (b.kind === 'circle') { this.flame(cxs, cys + z * 0.3, z * 0.3, time + b.id, 3); }
      else if (b.kind === 'rack' && hasDisc(w, 'preservation') && w.res.food >= 6) { this.smoke(cxs, cys + z * 0.5, z * 0.5, time + b.id, 5, 0.3); }
      if (b.owner === 1 && (b.kind === 'hearth')) this.glow(cxs, cys, z * 4, 0.12, '255,100,60');
      if (b.hp < b.maxHp * 0.5) { this.smoke(cxs, cys - z * 0.2, z * 0.8, time + b.id, 6, 0.5); this.flame(cxs - z * 0.2, cys, z * 0.5, time + b.id * 2, 2); }
    }
    if (b.outpost) { ctx.fillStyle = '#ffe36e'; ctx.font = `800 ${Math.max(10, z * 0.38)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('OUTPOST', cxs, p.y - z * 1.5); }
    if (!b.done) this.bar(p.x + 2, p.y + b.h * z + 5, b.w * z - 4, 6, b.progress, '#ffd54a');
    else if (b.hp < b.maxHp) this.bar(p.x + 2, p.y - z * 0.35, b.w * z - 4, 5, b.hp / b.maxHp, b.hp / b.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
    if (b.queue.length && b.done) { const q = b.queue[0]; this.bar(p.x + 2, p.y + b.h * z + 5, b.w * z - 4, 6, 1 - q.t / UNITS[q.kind].time, '#7ec8ff'); }
    if (selected) {
      const def = BUILDINGS[b.kind];
      if (def.warmth) { ctx.strokeStyle = 'rgba(255,170,80,.55)'; ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(cxs, cys, (def.warmth + Math.max(b.w, b.h) / 2) * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    }
  }

  private bar(x: number, y: number, w: number, h: number, f: number, col: string) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(8,10,8,.7)'; ctx.beginPath(); ctx.roundRect(x - 1, y - 1, w + 2, h + 2, 3); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, Math.min(1, f)) * w, h, 2); ctx.fill();
  }

  // ------------------------------------------------------------------ creatures
  private drawUnit(w: World, u: Unit, selected: boolean, alpha: number, time: number) {
    const { ctx, cam } = this;
    const def = UNITS[u.kind];
    const x = u.ox + (u.x - u.ox) * alpha, y = u.oy + (u.y - u.oy) * alpha;
    const p = cam.toScreen(x, y);
    if (p.x < -60 || p.y < -80 || p.x > cam.vw + 60 || p.y > cam.vh + 60) return;
    const s = cam.zoom / 32 * 1.4;
    const mvx = u.x - u.ox, moving = Math.hypot(mvx, u.y - u.oy) > 0.004;
    let f = this.facing.get(u.id) ?? 1;
    if (Math.abs(mvx) > 0.003) { f = mvx > 0 ? 1 : -1; this.facing.set(u.id, f); }
    else if (u.order.t === 'attack') { const t = w._u?.get(u.order.target); if (t && Math.abs(t.x - u.x) > 0.1) { f = t.x > u.x ? 1 : -1; this.facing.set(u.id, f); } }
    const walk = moving ? Math.sin(time * 11 + u.id) : 0, bob = moving ? Math.abs(walk) * 1.6 : Math.sin(time * 2 + u.id) * 0.3;
    const sp = u.owner === 0 ? w.species : u.owner === 1 ? w.rivalSpecies : 'human';
    const neo = sp === 'neanderthal';
    const team = u.owner === 0 ? (u.gen >= 2 ? '#38d39c' : '#27b7c6') : '#d84a36';
    const attacking = u.cd > def.cd - 0.22 && def.dmg > 0 && u.order.t !== 'idle';
    const lunge = attacking ? (def.range > 2 ? -1.5 : 4) : 0;

    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(s * (neo ? 1.08 : 1), s);
    // ground shadow + selection
    ctx.fillStyle = 'rgba(8,12,4,.32)'; ctx.beginPath(); ctx.ellipse(1, 1, 9, 3.8, 0, 0, 7); ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 2.2; ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.ellipse(0, 1, 14, 6.4, 0, 0, 7); ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (u.buff > 0) { ctx.strokeStyle = 'rgba(255,213,74,.85)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, 1, 18, 8, 0, 0, 7); ctx.stroke(); }
    ctx.scale(f, 1); ctx.translate(lunge, 0);
    if (u.kind === 'deer') this.drawDeer(u, walk, bob, time);
    else if (u.kind === 'wolf') this.drawWolf(walk, bob, attacking);
    else this.drawPerson(w, u, walk, bob, neo, team, time);
    ctx.restore();

    if (u.owner === 0 && u.order.t === 'research') { ctx.fillStyle = '#ffe36e'; ctx.font = `800 ${Math.max(11, 14 * s)}px system-ui`; ctx.textAlign = 'center'; ctx.fillText('?', p.x, p.y - 38 * s); }
    if (selected || u.hp < u.maxHp) this.bar(p.x - 10 * s, p.y - 33 * s, 20 * s, Math.max(3, 3.4 * s), u.hp / u.maxHp, u.hp / u.maxHp > 0.4 ? '#7bd36b' : '#e0604f');
  }

  private drawDeer(u: Unit, walk: number, bob: number, time: number) {
    const { ctx } = this;
    const legs = (x: number, ph: number) => { ctx.strokeStyle = '#7a5434'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, -8); ctx.lineTo(x + walk * ph * 3, 0); ctx.stroke(); };
    legs(-7, 1); legs(-4, -1); legs(6, -1); legs(9, 1);
    ctx.fillStyle = '#b98a58'; ctx.beginPath(); ctx.ellipse(1, -11 - bob * 0.5, 12, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#e6cfa8'; ctx.beginPath(); ctx.ellipse(1, -8.5 - bob * 0.5, 9, 3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; for (const [a, b] of [[-5, -14], [0, -15], [5, -13], [-2, -12]]) { ctx.beginPath(); ctx.arc(a, b - bob * 0.5, 0.9, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#b98a58'; ctx.beginPath(); ctx.moveTo(8, -13); ctx.lineTo(11, -22); ctx.lineTo(15, -21); ctx.lineTo(12, -11); ctx.fill();
    ctx.beginPath(); ctx.ellipse(15, -22, 4.4, 3, -0.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#2a1c10'; ctx.beginPath(); ctx.arc(17.5, -22.6, 1, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(19, -21.6, 0.9, 0, 7); ctx.fill();
    ctx.fillStyle = '#9a6b45'; ctx.beginPath(); ctx.ellipse(12, -25, 1.6, 3, 0.4, 0, 7); ctx.fill();
    if (u.id % 2 === 0) { ctx.strokeStyle = '#d9c8a2'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(14, -25); ctx.lineTo(13, -31); ctx.lineTo(10, -34); ctx.moveTo(13, -31); ctx.lineTo(16, -34); ctx.stroke(); }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(-12, -12.5 - Math.sin(time * 5) * 0.4, 2.2, 2.8, 0.4, 0, 7); ctx.fill();
  }

  private drawWolf(walk: number, bob: number, attacking: boolean) {
    const { ctx } = this;
    const leg = (x: number, ph: number) => { ctx.strokeStyle = '#4a4d58'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x, -7); ctx.lineTo(x + walk * ph * 4, 0); ctx.stroke(); };
    leg(-8, 1); leg(-4, -1); leg(6, -1); leg(10, 1);
    ctx.strokeStyle = '#7b7f8c'; ctx.lineWidth = 4.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-11, -11); ctx.quadraticCurveTo(-18, -12, -19 - walk, -6); ctx.stroke(); ctx.lineCap = 'butt';
    const g = ctx.createLinearGradient(0, -17, 0, -4); g.addColorStop(0, '#9a9eaa'); g.addColorStop(1, '#5e626e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, -10 - bob * 0.4, 12.5, 5.6, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(8, -14); ctx.lineTo(14, -15); ctx.lineTo(16, -9); ctx.lineTo(8, -7); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, -16); ctx.lineTo(21, -12.5); ctx.lineTo(14, -10); ctx.fill();
    ctx.fillStyle = '#3a3d48'; ctx.beginPath(); ctx.moveTo(10, -16); ctx.lineTo(11, -21); ctx.lineTo(14, -16.5); ctx.fill();
    ctx.fillStyle = '#16171c'; ctx.beginPath(); ctx.arc(21, -12.5, 1.3, 0, 7); ctx.fill();
    ctx.fillStyle = attacking ? '#ff3a2a' : '#ffd23a'; ctx.beginPath(); ctx.arc(14.5, -13.5, 1.1, 0, 7); ctx.fill();
    if (attacking) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(17, -10.5); ctx.lineTo(18, -8); ctx.lineTo(19, -10.5); ctx.fill(); }
  }

  private drawPerson(w: World, u: Unit, walk: number, bob: number, neo: boolean, team: string, time: number) {
    const { ctx } = this;
    const kind = u.kind;
    const skin = neo ? '#d9a888' : '#e6bd94', hair = neo ? '#2a1c14' : '#46301e';
    const tunic: Record<string, [string, string]> = {
      gatherer: ['#c29a62', '#8a6a3c'], scout: ['#d8c590', '#a08a52'], hunter: ['#7f9a50', '#4a6428'],
      guard: ['#92683f', '#5e3f22'], raider: ['#5a4644', '#2e2222'], leader: ['#a44a32', '#6a2616'],
    };
    const [t0, t1] = tunic[kind] ?? tunic.gatherer;
    // working animation
    const o = u.order;
    const node = o.t === 'gather' ? w._n?.get(o.node) : undefined;
    const working = !!node && Math.hypot(u.x - (node.x + 0.5), u.y - (node.y + 0.5)) < 1.9 && u.carry.n < UNITS[u.kind].carry;
    const building = o.t === 'build' && walk === 0;
    const swing = working || building ? Math.sin(time * 9 + u.id) : 0;
    const squat = working && node?.res === 'food' ? 2.5 : 0;
    // legs
    ctx.fillStyle = '#4a3a2a';
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.roundRect(-4.4 + sgn * 2.2 + walk * sgn * 2.6, -7 + squat * 0.5, 3.4, 7.4, 1.6); ctx.fill(); }
    // back bundle
    if (u.carry.n > 0) {
      const c = u.carry.res === 'food' ? ['#d83a3a', '#8a2020'] : u.carry.res === 'wood' ? ['#a87a4a', '#6a4526'] : ['#b5b7c0', '#6a6c78'];
      ctx.fillStyle = c[1]; ctx.beginPath(); ctx.roundRect(-13, -22 - bob + squat, 9, 11, 3); ctx.fill();
      ctx.fillStyle = c[0]; ctx.beginPath(); ctx.roundRect(-12.5, -22 - bob + squat, 7, 6, 3); ctx.fill();
      if (u.carry.res === 'food') { ctx.fillStyle = '#ff7a6a'; for (const [a, b] of [[-10, -21], [-8, -19], [-11, -18]]) { ctx.beginPath(); ctx.arc(a, b - bob + squat, 1.3, 0, 7); ctx.fill(); } }
    }
    if (kind === 'leader') { ctx.fillStyle = team; ctx.beginPath(); ctx.moveTo(-5, -18 - bob); ctx.quadraticCurveTo(-15 - walk * 3, -10, -12 - walk * 4, -1); ctx.lineTo(-2, -4); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8; ctx.stroke(); }
    // torso
    const g = ctx.createLinearGradient(-6, 0, 6, 0); g.addColorStop(0, t0); g.addColorStop(1, t1);
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-6.2, -18 - bob + squat, 12.4, 13.5, 4.5); ctx.fill();
    ctx.strokeStyle = 'rgba(20,12,6,.5)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(-6, -10 - bob + squat, 12, 1.8);
    ctx.fillStyle = team; ctx.beginPath(); ctx.moveTo(-5, -17.5 - bob + squat); ctx.lineTo(-2, -17.5 - bob + squat); ctx.lineTo(5, -6 - bob + squat); ctx.lineTo(2, -6 - bob + squat); ctx.closePath(); ctx.fill();
    if (kind === 'guard' || kind === 'raider') { ctx.fillStyle = kind === 'guard' ? '#d8cfc0' : '#2a2a30'; ctx.beginPath(); ctx.ellipse(0, -18 - bob, 7.4, 2.6, 0, 0, 7); ctx.fill(); }
    // head
    const hy = -23 - bob + squat * 1.4, hr = neo ? 5.4 : 4.8;
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(1, hy, hr, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,10,.4)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(0.4, hy - 0.6, hr + 0.4, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-3, hy + 1, 2.4, 3.6, 0, 0, 7); ctx.fill();
    if (neo) { ctx.fillStyle = 'rgba(60,35,25,.5)'; ctx.fillRect(1.4, hy - 2.3, 4.6, 1.2); }
    ctx.fillStyle = '#1a1210'; ctx.beginPath(); ctx.arc(3.6, hy + 0.4, 0.8, 0, 7); ctx.fill();
    if (kind === 'raider') { ctx.fillStyle = '#c23a2a'; ctx.fillRect(1.2, hy + 0.2, 5, 1.4); }
    ctx.fillStyle = team; ctx.fillRect(-4, hy - 2.6, 10, 1.7);
    if (kind === 'leader') { ctx.strokeStyle = '#e8d8a0'; ctx.lineWidth = 1.4; for (const [a, b] of [[-3, -5], [1, -7], [5, -5]]) { ctx.beginPath(); ctx.moveTo(1 + a * 0.4, hy - 4); ctx.lineTo(1 + a, hy + b - 3); ctx.stroke(); } ctx.fillStyle = '#c23a2a'; ctx.beginPath(); ctx.arc(1, hy - 8, 1.4, 0, 7); ctx.fill(); }
    if (kind === 'scout') { ctx.strokeStyle = '#e8d8a0'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-3, hy - 3); ctx.lineTo(-7, hy - 9); ctx.stroke(); }
    // arms + tool (right-facing)
    ctx.strokeStyle = skin; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    const hx = 8, hyd = -12 - bob + squat;
    ctx.beginPath(); ctx.moveTo(4, -16 - bob + squat); ctx.lineTo(hx + swing * 3, hyd - Math.abs(swing) * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, -16 - bob + squat); ctx.lineTo(-7, -11 - bob + squat + walk * 1.5); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.save(); ctx.translate(hx + swing * 3, hyd - Math.abs(swing) * 2);
    if (kind === 'guard' || kind === 'leader') {
      ctx.strokeStyle = '#8b6a40'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(1, -22); ctx.stroke();
      ctx.fillStyle = '#c7c9d0'; ctx.beginPath(); ctx.moveTo(1, -29); ctx.lineTo(3.4, -21); ctx.lineTo(-1.4, -21); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3a3a44'; ctx.lineWidth = 0.7; ctx.stroke();
    } else if (kind === 'hunter') {
      ctx.strokeStyle = '#6a4526'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(2, -3, 11, -1.15, 1.15); ctx.stroke();
      ctx.strokeStyle = 'rgba(240,235,220,.8)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(2 + 11 * Math.cos(-1.15), -3 + 11 * Math.sin(-1.15)); ctx.lineTo(2 + 11 * Math.cos(1.15), -3 + 11 * Math.sin(1.15)); ctx.stroke();
    } else if (kind === 'raider') {
      ctx.save(); ctx.rotate(-0.5 + swing * 0.2); ctx.strokeStyle = '#6a4526'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(1, -12); ctx.stroke();
      ctx.fillStyle = '#80828c'; ctx.beginPath(); ctx.ellipse(1, -13, 3.8, 5, 0, 0, 7); ctx.fill(); ctx.restore();
    } else if (kind === 'scout') {
      ctx.strokeStyle = '#a78858'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -16); ctx.stroke();
    } else if (working && node?.res === 'wood') {
      ctx.save(); ctx.rotate(-1 + swing * 0.9); ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -12); ctx.stroke();
      ctx.fillStyle = '#a5a7b0'; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(6, -10); ctx.lineTo(0, -7); ctx.fill(); ctx.restore();
    } else if (working && node?.res === 'stone') {
      ctx.save(); ctx.rotate(-1 + swing * 0.9); ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -12); ctx.stroke();
      ctx.strokeStyle = '#8b8d97'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-5, -12); ctx.lineTo(5, -12); ctx.stroke(); ctx.restore();
    } else if (building) {
      ctx.save(); ctx.rotate(-0.8 + swing * 0.8); ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -10); ctx.stroke();
      ctx.fillStyle = '#8b8d97'; ctx.fillRect(-3, -13, 7, 4); ctx.restore();
    }
    ctx.restore();
    if (kind === 'guard') { ctx.fillStyle = team; ctx.beginPath(); ctx.arc(-6, -11 - bob, 5.4, 0, 7); ctx.fill(); ctx.strokeStyle = '#4a321c'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.fillStyle = '#e8dcc0'; ctx.beginPath(); ctx.arc(-6, -11 - bob, 1.6, 0, 7); ctx.fill(); }
    if (u.owner === 0 && hasDisc(w, 'portable') && (kind === 'hunter' || kind === 'guard' || kind === 'leader')) {
      ctx.strokeStyle = '#6a4526'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-8, -9 - bob); ctx.lineTo(-10, -22 - bob); ctx.stroke();
      this.flame(-10, -22 - bob, 8, time + u.id, 2);
    }
  }

  private drawFx(w: World) {
    const { ctx, cam } = this;
    for (const f of w._fx ?? []) {
      const a = cam.toScreen(f.x1, f.y1 - 0.6), b = cam.toScreen(f.x2, f.y2 - 0.6);
      ctx.globalAlpha = Math.min(1, f.t * 6);
      if (Math.hypot(a.x - b.x, a.y - b.y) > 3) {
        ctx.strokeStyle = '#f2e6c0'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, 7); ctx.fill();
      } else {
        ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 2;
        for (let i = 0; i < 6; i++) { const ang = i * 1.05, r0 = 4 + (0.12 - f.t) * 40; ctx.beginPath(); ctx.moveTo(a.x + Math.cos(ang) * r0, a.y + Math.sin(ang) * r0); ctx.lineTo(a.x + Math.cos(ang) * (r0 + 5), a.y + Math.sin(ang) * (r0 + 5)); ctx.stroke(); }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ fog (smooth, 4x upsampled field)
  private drawFog(w: World) {
    if (!w._vis || !w._exp) return;
    const { cam } = this;
    if (w.tick - this.fogTick >= 4 || w.tick < this.fogTick) {
      this.fogTick = w.tick;
      const W = w.W, H = w.H, S = 4;
      const field = new Float32Array(W * H);
      for (let i = 0; i < field.length; i++) field[i] = w._vis[i] === 2 ? 0 : w._exp[i] ? 0.5 : 1;
      const img = this.fogCtx.createImageData(W * S, H * S);
      const at = (x: number, y: number) => field[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
      for (let py = 0; py < H * S; py++) {
        const fy = (py + 0.5) / S - 0.5, y0 = Math.floor(fy), v = fy - y0;
        for (let px = 0; px < W * S; px++) {
          const fx = (px + 0.5) / S - 0.5, x0 = Math.floor(fx), u = fx - x0;
          const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
          const val = a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
          const t = val * val * (3 - 2 * val);
          const o = (py * W * S + px) * 4;
          img.data[o] = 6; img.data[o + 1] = 9; img.data[o + 2] = 16; img.data[o + 3] = Math.round(t * (val > 0.75 ? 255 : 170) + (val > 0.75 ? 0 : 0));
        }
      }
      this.fogCtx.putImageData(img, 0, 0);
    }
    const o = cam.toScreen(0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.fog, o.x, o.y, w.W * cam.zoom, w.H * cam.zoom);
  }

  private drawOrders(w: World, ov: Overlay) {
    const { ctx, cam } = this;
    ctx.save(); ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
    for (const id of ov.selUnits) {
      const u = w._u?.get(id); if (!u) continue;
      let tx: number | null = null, ty: number | null = null, c = 'rgba(255,255,255,.55)';
      const o = u.order;
      if (o.t === 'move' || o.t === 'amove' || o.t === 'flee') { tx = o.x; ty = o.y; if (o.t === 'amove') c = 'rgba(255,120,100,.8)'; }
      else if (o.t === 'attack') { const t = w._u?.get(o.target) ?? w._b?.get(o.target); if (t) { tx = 'progress' in t ? t.x + t.w / 2 : t.x; ty = 'progress' in t ? t.y + t.h / 2 : t.y; c = 'rgba(255,120,100,.8)'; } }
      else if (o.t === 'gather') { const n = w._n?.get(o.node); if (n) { tx = n.x + 0.5; ty = n.y + 0.5; c = 'rgba(160,255,160,.7)'; } }
      else if (o.t === 'build') { const b = w._b?.get(o.b); if (b) { tx = b.x + b.w / 2; ty = b.y + b.h / 2; c = 'rgba(255,220,120,.8)'; } }
      if (tx === null || ty === null) continue;
      const a = cam.toScreen(u.x, u.y), b = cam.toScreen(tx, ty);
      ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(b.x, b.y, 6, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawGhost(w: World, pl: NonNullable<Overlay['place']>) {
    const { ctx, cam } = this, z = cam.zoom, d = BUILDINGS[pl.kind];
    const chk = placeCheck(w, pl.kind, pl.tx, pl.ty);
    const p = cam.toScreen(pl.tx, pl.ty), k = z / U;
    const sp = this.art.building(pl.kind, 0, d.w, d.h);
    ctx.fillStyle = chk.ok ? 'rgba(120,255,150,.28)' : 'rgba(255,90,80,.32)';
    ctx.fillRect(p.x, p.y, d.w * z, d.h * z);
    ctx.globalAlpha = 0.62; ctx.drawImage(sp.c, p.x - sp.ax * k, p.y - sp.ay * k, sp.c.width * k, sp.c.height * k); ctx.globalAlpha = 1;
    ctx.strokeStyle = chk.ok ? '#8dff9f' : '#ff6a5c'; ctx.lineWidth = 2.5; ctx.strokeRect(p.x, p.y, d.w * z, d.h * z);
    if (d.warmth) { ctx.strokeStyle = 'rgba(255,170,80,.45)'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(p.x + (d.w * z) / 2, p.y + (d.h * z) / 2, d.warmth * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (!chk.ok) {
      ctx.font = `600 ${Math.max(11, z * 0.38)}px system-ui`; ctx.textAlign = 'center'; const tw = ctx.measureText(chk.reason).width + 14;
      ctx.fillStyle = 'rgba(20,10,10,.9)'; ctx.beginPath(); ctx.roundRect(p.x + (d.w * z) / 2 - tw / 2, p.y - z * 0.9 - 22, tw, 22, 6); ctx.fill();
      ctx.fillStyle = '#ffb3a8'; ctx.fillText(chk.reason, p.x + (d.w * z) / 2, p.y - z * 0.9 - 7);
    }
  }

  // ------------------------------------------------------------------ minimap
  drawMinimap(w: World, c: HTMLCanvasElement) {
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const sx = c.width / w.W, sy = c.height / w.H;
    if (this.terrain) g.drawImage(this.terrain, 0, 0, c.width, c.height);
    for (const n of w.nodes) {
      if (!isExplored(w, n.x, n.y) || n.kind === 'carcass') continue;
      g.fillStyle = n.kind === 'tree' ? '#1f5a22' : n.kind === 'rock' ? '#ddd' : '#c44';
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

