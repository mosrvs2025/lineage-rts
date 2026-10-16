import { cmdContext, cmdJob, cmdMove, cmdPlace, cmdTeach, cmdTrain, cmdInvestigate, placeCheck, cmdGift } from '../src/sim/commands';
import { investigateCheck } from '../src/sim/discovery';
import { advanceGeneration, canSucceed } from '../src/sim/succession';
import { meadowOf } from '../src/sim/world';
import { MAPS } from '../src/data/maps';
import { popCap } from '../src/sim/rules';
import { cmdResearch, cmdUpgrade } from '../src/sim/upgrades';
import { autoWork } from '../src/sim/units';
import type { BuildingKind, DiscoveryId, World } from '../src/sim/types';

/** A scripted player that uses only the public command API. Used to verify the full scenario is completable. */
export class Bot {
  placed = new Set<string>();
  trace: string[] = [];
  constructor(public w: World, public opts: { teach?: boolean; gift?: boolean } = { teach: true, gift: true }) {}

  private has(kind: string, done = true) { return this.w.buildings.some((b) => b.owner === 0 && b.kind === kind && (!done || b.done)); }
  private count(kind: string) { return this.w.buildings.filter((b) => b.owner === 0 && b.kind === kind).length; }
  private units(kind: string) { return this.w.units.filter((u) => u.owner === 0 && u.kind === kind); }

  private spot(kind: BuildingKind, cx: number, cy: number): { x: number; y: number } | null {
    for (let r = 0; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (placeCheck(this.w, kind, cx + dx, cy + dy).ok) return { x: cx + dx, y: cy + dy };
    }
    return null;
  }
  private build(kind: BuildingKind, cx: number, cy: number) {
    const s = this.spot(kind, cx, cy); if (!s) return false;
    const r = cmdPlace(this.w, kind, s.x, s.y, []);
    if (r.ok) this.trace.push(`${Math.floor(this.w.time)}s build ${kind}`);
    return r.ok;
  }

  everySecond() {
    const w = this.w;
    const hearth = w.buildings.find((b) => b.owner === 0 && b.kind === 'hearth');
    if (!hearth) return;
    const hx = hearth.x + 1, hy = hearth.y + 1;
    // keep gatherers busy
    for (const g of this.units('gatherer')) if (g.order.t === 'idle' && !this.builders.includes(g.id)) autoWork(w, g);
    for (const h of this.units('hunter')) if (h.order.t === 'idle' && w.time % 7 < 1) autoWork(w, h);
    // economy
    const gatherers = this.units('gatherer').length;
    const pop = w.units.filter((u) => u.owner === 0).length;
    const cap = popCap(w);
    if (pop + 3 >= cap && w.res.wood >= 25 && this.count('shelter') < 8 && !this.pending('shelter')) this.build('shelter', hx - 6 - (this.count('shelter') % 3) * 2, hy + (this.count('shelter') % 2 ? 6 : -8));
    if (gatherers < 10 && w.res.food >= 25) cmdTrain(w, hearth.id, 'gatherer');
    void gatherers;
    // stone and wood balance
    if (w.time > 20 && w.time % 15 < 1) {
      const wood = w.units.filter((u) => u.owner === 0 && u.kind === 'gatherer' && u.order.t === 'gather').length;
      if (wood > 4 && w.res.stone < 40) cmdJob(w, 'stone');
      else if (w.res.wood < 60) cmdJob(w, 'wood');
    }
    // buildings
    if (!this.has('stockpile', false) && w.res.wood >= 20) this.build('stockpile', hx + 7, hy - 5);
    if (this.has('stockpile', false) && !this.has('toolshelter', false) && w.res.wood >= 30 && w.res.stone >= 10) this.build('toolshelter', hx + 4, hy - 6);
    if (this.has('toolshelter') && !this.has('lodge', false) && w.res.wood >= 40 && w.res.stone >= 10) this.build('lodge', hx - 3, hy + 6);
    if (this.has('toolshelter', false) && !this.has('circle', false) && w.res.wood >= 35 && w.time > 150) this.build('circle', hx + 6, hy + 4);
    if (this.has('preservation' as never)) { /* noop */ }
    if (w.disc.preservation === 'known' || w.disc.preservation === 'preserved') {
      if (this.count('rack') < (w.gen === 1 ? 2 : 4) && w.res.wood >= 25 && w.res.stone >= 5) this.build('rack', hx + 2 + this.count('rack') * 3, hy + 9);
    }
    // army
    const lodge = w.buildings.find((b) => b.owner === 0 && b.kind === 'lodge' && b.done);
    if (lodge) {
      if (this.units('hunter').length < 3 && w.res.food >= 30 && w.res.wood >= 20) cmdTrain(w, lodge.id, 'hunter');
      if (this.units('guard').length < (w.gen === 1 ? 5 : 8) && w.res.food >= 35 && w.res.wood >= 15) cmdTrain(w, lodge.id, 'guard');
      if (this.units('scout').length < 2 && w.res.food >= 30) cmdTrain(w, lodge.id, 'scout');
    }
    // spend surplus: fortify with archer posts, upgrade, research
    if (w.time > 200 && this.count('watch') < 2 && w.res.wood >= 80 && w.res.stone >= 40) this.build('watch', hx + 9 + this.count('watch') * 3, hy - 2 + this.count('watch') * 4);
    for (const b of w.buildings) {
      if (b.owner !== 0 || !b.done || b.upg) continue;
      if (b.kind === 'watch' && b.tier < 1) cmdUpgrade(w, b.id);
      if (b.kind === 'lodge' && b.tier < 1 && w.res.wood >= 120) cmdUpgrade(w, b.id);
      if (b.kind === 'hearth' && b.tier < 1 && w.res.wood >= 150) cmdUpgrade(w, b.id);
      if (b.kind === 'lodge') cmdResearch(w, b.id, 'leather');
      if (b.kind === 'toolshelter') cmdResearch(w, b.id, 'flint');
    }
    if (lodge && lodge.tier >= 1 && this.units('champion').length < 3 && w.res.food >= 80) cmdTrain(w, lodge.id, 'champion');
    // discoveries
    const order: DiscoveryId[] = ['preservation', 'cooking', 'portable', 'heat'];
    for (const id of order) if (investigateCheck(w, id).ok) cmdInvestigate(w, id);
    if (this.opts.teach) for (const id of order) if (w.disc[id] === 'known') cmdTeach(w, id);
    // scouting
    const scouts = this.units('scout');
    if (scouts[0] && scouts[0].order.t === 'idle' && !w.landmarks[0].visited) cmdMove(w, [scouts[0].id], w.landmarks[0].x, w.landmarks[0].y + 1.5);
    // rally guards near the hearth as defense
    for (const gd of [...this.units('guard'), ...this.units('hunter')]) {
      if (!this.escort.includes(gd.id) && gd.order.t === 'idle' && Math.hypot(gd.x - (hx + 6), gd.y - hy) > 6) cmdMove(w, [gd.id], hx + 6, hy + (gd.id % 5));
    }
    if (this.opts.gift && w.time > 150 && w.time < w.truceUntil - 150 + 1 && w.res.food > 120) { /* skip */ }
    if (this.opts.gift && w.time >= w.truceUntil && w.res.food >= 140 && w.time < 700) cmdGift(w);
    // generation
    if (w.gen === 1 && canSucceed(w)) { advanceGeneration(w, 0); this.trace.push(`${Math.floor(w.time)}s succession`); }
    if (w.gen >= 2) this.expedition();
  }

  private pending(kind: string) { return this.w.buildings.some((b) => b.owner === 0 && b.kind === kind && !b.done); }

  private expeditionStage = 0;
  private stageWait = 0;
  private expedition() {
    const w = this.w;
    const scouts = this.units('scout');
    const scout = scouts.length > 1 ? scouts[scouts.length - 1] : scouts[0];   // the cave scout stays home
    const stage = this.expeditionStage;
    const meadow = (u: { x: number; y: number }, r = 8) => Math.hypot(u.x - meadowOf(w).x, u.y - meadowOf(w).y) < r;
    const outpost = w.buildings.find((b) => b.owner === 0 && b.outpost);
    // the escort was wiped out (or the scout lost): regroup and try again
    if (this.expeditionStage >= 1 && this.expeditionStage < 4 && (!scout || this.escort.every((id) => !w._u?.get(id)))) { this.expeditionStage = 0; this.escort = []; this.builders = []; this.trace.push(`${Math.floor(w.time)}s expedition regroups`); }
    // the quiet northern crossing of this map's river
    const MEADOW = meadowOf(w);
    const fx = (MAPS[w.map] ?? MAPS.valley).stage.x, fy = (MAPS[w.map] ?? MAPS.valley).stage.y;
    if (stage === 0 && scout && w.res.provisions >= 60 && this.units('guard').length >= 4) {
      // scout via the quiet north ford; the escort follows
      cmdMove(w, [scout.id], fx + 1, fy);
      this.escort = [...this.units('guard'), ...this.units('hunter')].slice(0, 6).map((u) => u.id);
      cmdMove(w, this.escort, fx, fy);
      this.expeditionStage = 1;
    } else if (stage === 1 && scout && scout.order.t === 'idle' && Math.hypot(scout.x - fx, scout.y - fy) > 6) {
      cmdMove(w, [scout.id], fx + 1, fy); cmdMove(w, this.escort, fx, fy);       // not there yet: keep going
    } else if (stage === 1 && scout && Math.hypot(scout.x - fx, scout.y - fy) <= 6) {
      cmdMove(w, [scout.id], MEADOW.x, MEADOW.y);
      cmdMove(w, this.escort, MEADOW.x - 2, MEADOW.y + 1);
      this.expeditionStage = 2;
    } else if (stage === 2 && w.landmarks[1].visited && this.escort.some((id) => { const u = w._u?.get(id); return u && meadow(u); }) && w.res.provisions >= 62) {
      this.builders = this.units('gatherer').filter((u) => u.order.t !== 'research' && u.order.t !== 'build').slice(0, 3).map((u) => u.id);
      cmdMove(w, this.builders, fx, fy);
      this.expeditionStage = 2.5;
    } else if (stage === 2 && this.escort.some((id) => { const u = w._u?.get(id); return u && u.order.t === 'idle' && !meadow(u); })) {
      // fights interrupt the march: send idle escorts and the scout on to the meadow again
      for (const id of this.escort) { const u = w._u?.get(id); if (u && u.order.t === 'idle' && !meadow(u)) cmdMove(w, [id], MEADOW.x - 2, MEADOW.y + 1); }
      if (scout && scout.order.t === 'idle' && !meadow(scout)) cmdMove(w, [scout.id], MEADOW.x, MEADOW.y);
    } else if (stage === 2.5) {
      // drop builders who were pulled away (e.g. to research at the teaching circle)
      this.builders = this.builders.filter((id) => { const u = w._u?.get(id); return u && (u.order.t === 'move' || u.order.t === 'idle'); });
      const alive = this.builders.map((id) => w._u?.get(id)).filter(Boolean);
      if (!alive.length) this.expeditionStage = 2;
      else {
        // go on with whoever has reached the staging point (a builder that got stuck or was lost is dropped)
        const there = alive.filter((u) => Math.hypot(u!.x - fx, u!.y - fy) < 3);
        this.stageWait = (this.stageWait ?? 0) + 1;
        if (there.length === alive.length || (there.length >= 1 && this.stageWait > 60)) { this.builders = there.map((u) => u!.id); cmdMove(w, this.builders, MEADOW.x - 1, MEADOW.y + 2); this.expeditionStage = 3; this.stageWait = 0; }
        else if (this.stageWait % 20 === 0) for (const u of alive) if (u!.order.t === 'idle' && Math.hypot(u!.x - fx, u!.y - fy) >= 3) cmdMove(w, [u!.id], fx, fy);
      }
    } else if (stage === 3) {
      const alive = this.builders.map((id) => w._u?.get(id)).filter(Boolean);
      if (alive.length && alive.every((u) => meadow(u!, 6))) {
        const r = cmdPlace(w, 'watch', MEADOW.x - 1, MEADOW.y - 1, this.builders);
        this.trace.push(`${Math.floor(w.time)}s outpost ${r.ok ? 'placed' : r.reason}`);
        if (r.ok) this.expeditionStage = 4;
      } else if (!alive.length) this.expeditionStage = 2;
    } else if (stage === 4 && outpost && !outpost.done) {
      const alive = this.builders.filter((id) => w._u?.get(id));
      if (!alive.length) { this.builders = this.units('gatherer').slice(0, 2).map((u) => u.id); cmdMove(w, this.builders, fx, fy); this.expeditionStage = 2.5; }
    } else if (stage === 4 && !outpost) { this.expeditionStage = 2; }
  }
  expeditionStageGet() { return this.expeditionStage; }
  escortSent = false; escort: number[] = []; builders: number[] = [];
}
void cmdContext;
