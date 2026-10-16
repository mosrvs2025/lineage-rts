import type { World } from '../sim/types';
import { isWinter } from '../sim/util';

interface Sample { time: number; stocks: World['res']; gathered: number }
/** Render-only rolling samples: no simulation/save mutation, and reset on a load or rewind. */
export class ResourceHistory {
  private world?: World;
  private samples: Sample[] = [];
  sample(w: World) {
    const last = this.samples.at(-1);
    if (this.world !== w || (last && (w.time < last.time || w.time - last.time > 30))) { this.world = w; this.samples = []; }
    if (this.samples.length && w.time - this.samples.at(-1)!.time < 1) return;
    this.samples.push({ time: w.time, stocks: { ...w.res }, gathered: w.stats.food });
    while (this.samples.length > 1 && this.samples[1].time <= w.time - 30) this.samples.shift();
  }
  rates(w: World, resource: keyof World['res']) {
    const first = this.samples[0], last = this.samples.at(-1);
    const seconds = first && last ? last.time - first.time : 0;
    return {
      seconds,
      net: seconds >= 5 ? (last!.stocks[resource] - first!.stocks[resource]) * 60 / seconds : null,
      gathered: seconds >= 5 ? (last!.gathered - first!.gathered) * 60 / seconds : null,
      foodDemand: w.units.filter(u => u.owner === 0).length * 60 / (isWinter(w) ? 8 : 12),
    };
  }
}
