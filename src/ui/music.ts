/** Procedural adaptive score: pads, bass, flute-like melody, bells and frame drums that follow the game's mood. */
import { getBuses } from './audio';

export type MoodName = 'off' | 'title' | 'calm' | 'winter' | 'danger';
interface Mood { bpm: number; prog: [number, 'm' | 'M'][]; scale: number[]; root: number; mel: number; drums: 0 | 1 | 2; bells: boolean; pad: number; shaker: boolean; tension: boolean }

const MOODS: Record<Exclude<MoodName, 'off'>, Mood> = {
  title: { bpm: 62, prog: [[50, 'm'], [46, 'M'], [53, 'M'], [48, 'M']], scale: [0, 3, 5, 7, 10], root: 62, mel: 0.8, drums: 1, bells: false, pad: 0.11, shaker: false, tension: false },
  calm: { bpm: 78, prog: [[50, 'M'], [47, 'm'], [43, 'M'], [45, 'M']], scale: [0, 2, 4, 7, 9], root: 62, mel: 0.62, drums: 0, bells: false, pad: 0.075, shaker: true, tension: false },
  winter: { bpm: 54, prog: [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M']], scale: [0, 3, 5, 7, 10], root: 69, mel: 0.42, drums: 0, bells: true, pad: 0.06, shaker: false, tension: false },
  danger: { bpm: 106, prog: [[40, 'm'], [41, 'M'], [40, 'm'], [38, 'M']], scale: [0, 3, 5, 7, 10], root: 64, mel: 0.3, drums: 2, bells: false, pad: 0.07, shaker: false, tension: true },
};
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const rnd = Math.random;

export class Music {
  mood: MoodName = 'off';
  private next = -1; private step = 0; private bar = 0; private deg = 5;
  private phrase = new Map<number, { deg: number; dur: number }>();
  constructor(private ctx: BaseAudioContext, private out: AudioNode, private rev: AudioNode) {}

  setMood(m: MoodName) { if (m === this.mood) return; this.mood = m; if (m !== 'off') { this.step = 0; this.next = -1; this.phrase.clear(); } }
  private get now() { return this.ctx.currentTime; }

  scheduleUntil(until: number) {
    if (this.mood === 'off') return;
    const m = MOODS[this.mood], sd = 60 / m.bpm / 2;
    if (this.next < 0) this.next = Math.max(this.now, 0) + 0.08;
    while (this.next < until) { this.stepAt(this.next, sd, m); this.next += sd; this.step = (this.step + 1) % 8; if (this.step === 0) this.bar++; }
  }

  // ---------------------------------------------------------------- voices
  private env(g: GainNode, t: number, peak: number, att: number, hold: number, rel: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + att); g.gain.setValueAtTime(peak, t + att + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + att + hold + rel);
  }
  private send(n: AudioNode, amt: number) { const g = this.ctx.createGain(); g.gain.value = amt; n.connect(g); g.connect(this.rev); }
  private padNote(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 760; lp.Q.value = 0.4;
    for (const [type, det, k] of [['sawtooth', -7, 0.5], ['sawtooth', 7, 0.5], ['triangle', 0, 1]] as [OscillatorType, number, number][]) {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det; og.gain.value = k; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 1.6);
    }
    this.env(g, t, vol, Math.min(1.1, dur * 0.35), Math.max(0, dur - 1.6), 1.4); lp.connect(g); g.connect(this.out); this.send(g, 0.55);
  }
  private bassNote(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx, g = c.createGain(), o = c.createOscillator(), o2 = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.15; o2.connect(g2); g2.connect(g); o.connect(g); this.env(g, t, vol, 0.12, dur * 0.7, 0.7); g.connect(this.out); o.start(t); o2.start(t); o.stop(t + dur + 1); o2.stop(t + dur + 1);
  }
  private flute(f: number, t: number, dur: number, vol: number) {
    const c = this.ctx, g = c.createGain(), o = c.createOscillator(), o2 = c.createOscillator(), v = c.createOscillator(), vg = c.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2; const g2 = c.createGain(); g2.gain.value = 0.28; o2.connect(g2); g2.connect(g);
    v.frequency.value = 5; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.009, t + 0.35); v.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
    o.connect(g); this.env(g, t, vol, 0.07, Math.max(0.05, dur - 0.1), 0.45); g.connect(this.out); this.send(g, 0.5);
    o.start(t); o2.start(t); v.start(t); o.stop(t + dur + 0.6); o2.stop(t + dur + 0.6); v.stop(t + dur + 0.6);
    this.noiseBurst(t, 0.12, vol * 0.35, 3200, 'bandpass');
  }
  private bell(f: number, t: number, vol: number) {
    const c = this.ctx, g = c.createGain();
    for (const [mul, k] of [[1, 1], [2.76, 0.4], [5.4, 0.15]]) { const o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.value = f * mul; og.gain.value = k; o.connect(og); og.connect(g); o.start(t); o.stop(t + 2.6); }
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4); g.connect(this.out); this.send(g, 0.8);
  }
  private noiseBurst(t: number, dur: number, vol: number, freq: number, type: BiquadFilterType) {
    const c = this.ctx, n = Math.max(32, Math.floor(c.sampleRate * dur)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; f.type = type; f.frequency.value = freq; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(this.out); s.start(t);
  }
  private drum(t: number, f0: number, f1: number, dur: number, vol: number, click = true) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(this.out); this.send(g, 0.35); o.start(t); o.stop(t + dur + 0.05);
    if (click) this.noiseBurst(t, 0.03, vol * 0.5, 1800, 'lowpass');
  }
  private stab(f: number, t: number, vol: number) {
    const c = this.ctx, o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); o.connect(lp); lp.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.3);
  }

  // ---------------------------------------------------------------- sequencing
  private planPhrase(m: Mood, chordRoot: number) {
    this.phrase.clear();
    if (rnd() > m.mel) return;
    const len = m.scale.length, rootDeg = (chordRoot + 12 - (m.root % 12)) % 12;
    let deg = this.deg, s = [0, 0, 2, 4][Math.floor(rnd() * 4)];
    const n = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < n && s < 8; i++) {
      const dur = [1, 2, 2, 3, 4][Math.floor(rnd() * 5)], d = Math.min(dur, 8 - s);
      this.phrase.set(s, { deg, dur: d });
      s += d + (rnd() < 0.3 ? 1 : 0);
      deg += [-2, -1, -1, 1, 1, 2][Math.floor(rnd() * 6)]; deg = Math.max(2, Math.min(len * 2 + 2, deg));
    }
    this.deg = deg; void rootDeg;
  }
  private degHz(m: Mood, deg: number) { const len = m.scale.length; return hz(m.root + 12 * Math.floor(deg / len) + m.scale[((deg % len) + len) % len] - (m.bells ? 0 : 12 * 0)); }

  private stepAt(t: number, sd: number, m: Mood) {
    const [root, q] = m.prog[this.bar % m.prog.length], barDur = sd * 8;
    if (this.step === 0) {
      const third = q === 'm' ? 3 : 4;
      for (const iv of [0, 7, 12 + third, 12]) this.padNote(hz(root + 12 + iv - 12), t, barDur * 1.05, m.pad / (iv > 7 ? 1.4 : 1));
      this.bassNote(hz(root), t, barDur, 0.2);
      this.planPhrase(m, root);
      if (m.tension) { this.stab(hz(root + 12), t, 0.1); if (this.bar % 2) this.stab(hz(root + 13), t + sd * 3, 0.06); }
      if (m.drums === 1) this.drum(t, 92, 48, 0.9, 0.35, true);
    }
    const ph = this.phrase.get(this.step);
    if (ph) {
      const f = this.degHz(m, ph.deg);
      if (m.bells) this.bell(f * 2, t, 0.06); else this.flute(f, t, ph.dur * sd, 0.09);
    }
    if (m.bells && this.step === 4 && rnd() < 0.5) this.bell(hz(m.root + 12 + m.scale[Math.floor(rnd() * 5)]), t, 0.035);
    if (m.shaker && this.step % 2 === 1 && rnd() < 0.8) this.noiseBurst(t, 0.05, 0.035, 6500, 'highpass');
    if (m.drums === 2) {
      if (this.step === 0 || this.step === 4) this.drum(t, 125, 46, 0.3, 0.55);
      if (this.step === 2 || this.step === 6 || (this.step === 7 && this.bar % 2)) this.drum(t, 190, 90, 0.22, 0.3, false);
      if (this.step % 2 === 1) this.noiseBurst(t, 0.04, 0.03, 5000, 'highpass');
    }
    if (m.drums === 1 && this.step === 4 && this.bar % 2) this.drum(t, 110, 60, 0.6, 0.22);
  }

  /** One-shot victory/defeat cue. */
  stinger(kind: 'win' | 'lose') {
    const t = this.now + 0.05, c = this.ctx;
    if (kind === 'win') {
      [60, 64, 67, 72, 76].forEach((n, i) => {
        const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = hz(n);
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t + i * 0.12); lp.frequency.exponentialRampToValueAtTime(3200, t + i * 0.12 + 0.9);
        g.gain.setValueAtTime(0.0001, t + i * 0.12); g.gain.linearRampToValueAtTime(0.07, t + i * 0.12 + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
        o.connect(lp); lp.connect(g); g.connect(this.out); this.send(g, 0.6); o.start(t + i * 0.12); o.stop(t + 3);
      });
      for (let i = 0; i < 7; i++) this.drum(t + i * (0.22 - i * 0.02), 100, 62, 0.5, 0.3);
      [84, 88, 91, 96].forEach((n, i) => this.bell(hz(n), t + 0.9 + i * 0.16, 0.05));
    } else {
      for (const f of [55, 58.3]) { const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 320; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 4); o.connect(lp); lp.connect(g); g.connect(this.out); this.send(g, 0.7); o.start(t); o.stop(t + 4.2); }
      [74, 72, 69, 65].forEach((n, i) => this.flute(hz(n), t + 0.4 + i * 0.75, 1.1, 0.08));
    }
  }
}

// ---------------------------------------------------------------- live controller
let engine: Music | null = null;
let desired: MoodName = 'off';
let timer = 0;
function ensure() {
  if (engine) return;
  const b = getBuses(); if (!b) return;
  engine = new Music(b.ctx, b.musicBus, b.reverbIn); engine.setMood(desired);
  timer = window.setInterval(() => engine!.scheduleUntil(b.ctx.currentTime + (document.hidden ? 2.5 : 0.5)), 90);
}
window.addEventListener('lineage-audio-ready', ensure);
export const music = {
  setMood(m: MoodName) { desired = m; ensure(); engine?.setMood(m); },
  stinger(k: 'win' | 'lose') { ensure(); engine?.stinger(k); },
  get mood() { return desired; },
  stop() { if (timer) window.clearInterval(timer); },
};

/** Offline render for automated checks: returns loudness/clipping stats for a mood. */
export async function renderMoodStats(mood: Exclude<MoodName, 'off'>, seconds = 24): Promise<{ rms: number; peak: number; silentFraction: number; seconds: number }> {
  const sr = 22050, oc = new OfflineAudioContext(2, sr * seconds, sr);
  const out = oc.createGain(), comp = oc.createDynamicsCompressor(), rev = oc.createConvolver();
  const n = Math.floor(sr * 2.4), ir = oc.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.4); }
  rev.buffer = ir; const wet = oc.createGain(); wet.gain.value = 0.5; const send = oc.createGain();
  send.connect(rev); rev.connect(wet); wet.connect(comp); out.gain.value = 0.55 * 0.6; out.connect(comp); comp.connect(oc.destination);
  const m = new Music(oc, out, send); m.setMood(mood); m.scheduleUntil(seconds);
  const buf = await oc.startRendering(), d = buf.getChannelData(0);
  let sum = 0, peak = 0, silent = 0; const win = sr / 4; let acc = 0, wc = 0;
  for (let i = 0; i < d.length; i++) { const v = d[i]; sum += v * v; peak = Math.max(peak, Math.abs(v)); acc += v * v; if (++wc === win) { if (Math.sqrt(acc / win) < 0.002) silent++; acc = 0; wc = 0; } }
  return { rms: Math.sqrt(sum / d.length), peak, silentFraction: silent / (d.length / win), seconds };
}
