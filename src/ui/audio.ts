/** Synthesized audio: buses, spatial sound effects driven by game events, ambient beds. No audio files. */
import type { GameEvent } from '../sim/types';
import { settings, onSettings } from './settings';

let ctx: AudioContext | null = null;
let master: GainNode | null = null, sfxBus: GainNode | null = null, musicBus: GainNode | null = null, reverbIn: GainNode | null = null;
let ambientGain: GainNode | null = null, windGain: GainNode | null = null;
let listener = { x: 0, y: 0, zoom: 30 };
let voices = 0;
const lastPlayed: Record<string, number> = {};

export const getCtx = () => ctx;
export const getBuses = () => (ctx && master && musicBus && sfxBus && reverbIn ? { ctx, master, musicBus, sfxBus, reverbIn } : null);

/** Stereo impulse response (decaying noise) for cheap convolution reverb. */
export function makeImpulse(c: BaseAudioContext, seconds = 2.6, decay = 2.4): AudioBuffer {
  const n = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return buf;
}

export function applyVolumes() {
  if (!ctx || !master || !sfxBus || !musicBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : 0.8, t, 0.05);
  sfxBus.gain.setTargetAtTime(settings.sfx, t, 0.05);
  musicBus.gain.setTargetAtTime(settings.music * 0.55, t, 0.1);
}
onSettings(applyVolumes);

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.01; comp.release.value = 0.25;
    master = ctx.createGain(); master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx);
    reverbIn = ctx.createGain(); reverbIn.gain.value = 1; const wet = ctx.createGain(); wet.gain.value = 0.5; reverbIn.connect(conv); conv.connect(wet); wet.connect(master);
    ambientBeds();
    applyVolumes();
    window.dispatchEvent(new Event('lineage-audio-ready'));
  } catch { ctx = null; }
}

export const isMuted = () => settings.muted;

// ------------------------------------------------------------------ primitives
function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, delay = 0, slide = 0, out?: AudioNode, pan = 0) {
  if (!ctx || !sfxBus || settings.muted) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = g;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
  o.connect(g); node.connect(out ?? sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur: number, vol: number, f0: number, delay = 0, kind: BiquadFilterType = 'lowpass', pan = 0, f1 = 0, q = 0.7) {
  if (!ctx || !sfxBus || settings.muted) return;
  const t = ctx.currentTime + delay, n = Math.max(32, Math.floor(ctx.sampleRate * dur)), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.6);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = kind; f.frequency.setValueAtTime(f0, t); f.Q.value = q; if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.value = vol;
  s.connect(f); f.connect(g);
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(sfxBus); } else g.connect(sfxBus);
  s.start(t);
}
function wet(src: AudioNode, amt = 0.4) { if (!ctx || !reverbIn) return; const g = ctx.createGain(); g.gain.value = amt; src.connect(g); g.connect(reverbIn); }

// ------------------------------------------------------------------ ambient beds (wind, birds, crickets, fire)
let birdT = 0, cricketT = 0, crackleT = 0, howlT = 0;
function ambientBeds() {
  if (!ctx || !sfxBus) return;
  const n = ctx.sampleRate * 4, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
  windGain = ctx.createGain(); windGain.gain.value = 0.07; ambientGain = ctx.createGain(); ambientGain.gain.value = 1;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.04; lfo.connect(lg); lg.connect(windGain.gain); lfo.start();
  s.connect(f); f.connect(windGain); windGain.connect(ambientGain); ambientGain.connect(sfxBus); s.start();
}

export interface AmbienceState { dt: number; winter: number; night: number; fire: number; storm?: number; paused?: boolean }
/** Called every frame: random bird calls by day, crickets by night, fire crackle near hearths, wolf howls in the cold. */
export function updateAmbience(a: AmbienceState) {
  if (!ctx || settings.muted || a.paused) return;
  if (windGain) windGain.gain.setTargetAtTime(0.05 + 0.09 * a.winter, ctx.currentTime, 0.5);
  birdT -= a.dt; cricketT -= a.dt; crackleT -= a.dt; howlT -= a.dt;
  if (birdT <= 0) { birdT = 2 + Math.random() * 6; if (a.night < 0.4 && a.winter < 0.6) { const f = 2400 + Math.random() * 1800; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) tone(f + i * 120, 0.09, 'sine', 0.03, i * 0.11, 700 + Math.random() * 600, undefined, Math.random() * 1.6 - 0.8); } }
  if (cricketT <= 0) { cricketT = 0.5; if (a.night > 0.5 && a.winter < 0.5) for (let i = 0; i < 4; i++) tone(4300, 0.025, 'square', 0.006, i * 0.045); }
  if (crackleT <= 0) { crackleT = 0.12 + Math.random() * 0.35; if (a.fire > 0.05) noise(0.05 + Math.random() * 0.05, 0.05 * a.fire, 2400 + Math.random() * 3000, 0, 'highpass', Math.random() * 0.8 - 0.4); }
  if (howlT <= 0) { howlT = 28 + Math.random() * 40; if (a.night > 0.5 || a.winter > 0.5) sfx.howl(0.12, 0); }
}

// ------------------------------------------------------------------ UI sounds
export const sfx = {
  hover: () => tone(1500, 0.035, 'sine', 0.022),
  click: () => { tone(540, 0.07, 'triangle', 0.13); tone(810, 0.08, 'triangle', 0.07, 0.03); },
  error: () => { tone(170, 0.14, 'sawtooth', 0.1); tone(120, 0.2, 'sawtooth', 0.08, 0.08); },
  good: () => { tone(660, 0.12, 'sine', 0.12); tone(880, 0.2, 'sine', 0.1, 0.09); },
  place: () => { noise(0.2, 0.3, 700); tone(110, 0.22, 'sine', 0.2, 0, -50); },
  open: () => { noise(0.12, 0.05, 1800, 0, 'bandpass', 0, 3600); tone(320, 0.1, 'triangle', 0.05, 0.02); },
  build: () => { tone(523, 0.16, 'triangle', 0.13); tone(659, 0.16, 'triangle', 0.13, 0.1); tone(784, 0.34, 'triangle', 0.13, 0.2); },
  alert: () => { for (let i = 0; i < 3; i++) tone(i % 2 ? 392 : 311, 0.22, 'square', 0.08, i * 0.18); noise(0.3, 0.08, 500); },
  discover: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => { tone(f, 0.45, 'sine', 0.1, i * 0.09); tone(f * 2, 0.3, 'sine', 0.03, i * 0.09); }); },
  win: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.6, 'triangle', 0.12, i * 0.14)); tone(131, 1.5, 'sine', 0.16, 0.1); },
  lose: () => { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.65, 'sawtooth', 0.07, i * 0.25)); },
  howl: (vol = 0.2, pan = 0) => {
    if (!ctx || !sfxBus || settings.muted) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), v = ctx.createOscillator(), vg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(330, t); o.frequency.linearRampToValueAtTime(620, t + 0.7); o.frequency.linearRampToValueAtTime(480, t + 1.8);
    v.frequency.value = 5.5; vg.gain.value = 12; v.connect(vg); vg.connect(o.frequency);
    f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 2.5;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    o.connect(f); f.connect(g); g.connect(sfxBus); wet(g, 0.7); o.start(t); v.start(t); o.stop(t + 2.1); v.stop(t + 2.1);
    void pan;
  },
};

// ------------------------------------------------------------------ spatial world sounds
export function setListener(x: number, y: number, zoom: number) { listener = { x, y, zoom }; }

const RATE: Record<string, number> = { chop: 0.16, mine: 0.16, pick: 0.25, hammer: 0.14, hit: 0.07, shoot: 0.1, death: 0.1, deliver: 0.12, howl: 1.5, felled: 0.4 };

/** Play a simulation event with distance attenuation and stereo pan. Returns false when it was too far / rate-limited. */
export function playEvent(e: GameEvent): boolean {
  if (!ctx || !sfxBus || settings.muted) return false;
  const now = ctx.currentTime, gap = RATE[e.k] ?? 0.05;
  if (now - (lastPlayed[e.k] ?? -9) < gap || voices > 26) return false;
  const dx = e.x - listener.x, dy = e.y - listener.y, d = Math.hypot(dx, dy);
  const reach = 16 + listener.zoom * 0.5; // zoomed out you hear farther
  if (d > reach * 1.4) return false;
  const att = Math.max(0, 1 - d / (reach * 1.4)), vol = att * att, pan = Math.max(-0.9, Math.min(0.9, dx / (reach * 0.8)));
  lastPlayed[e.k] = now; voices++; setTimeout(() => { voices--; }, 350);
  const r = Math.random();
  switch (e.k) {
    case 'chop': noise(0.09, 0.42 * vol, 1100, 0, 'bandpass', pan, 380, 1.2); tone(150 + r * 30, 0.12, 'sine', 0.3 * vol, 0, -80, undefined, pan); break;
    case 'mine': tone(2300 + r * 400, 0.1, 'sine', 0.1 * vol, 0, 0, undefined, pan); tone(3700, 0.07, 'sine', 0.05 * vol, 0, 0, undefined, pan); noise(0.04, 0.2 * vol, 5000, 0, 'highpass', pan); break;
    case 'pick': noise(0.18, 0.1 * vol, 3200, 0, 'bandpass', pan, 5200, 0.8); break;
    case 'hammer': tone(210, 0.1, 'sine', 0.26 * vol, 0, -110, undefined, pan); noise(0.05, 0.3 * vol, 1600, 0, 'bandpass', pan); tone(190, 0.1, 'sine', 0.18 * vol, 0.16, -90, undefined, pan); break;
    case 'hit': tone(95 + r * 30, 0.16, 'sine', 0.38 * vol, 0, -45, undefined, pan); noise(0.09, 0.3 * vol, 900, 0, 'bandpass', pan, 300); break;
    case 'shoot': tone(340, 0.09, 'triangle', 0.14 * vol, 0, -170, undefined, pan); noise(0.14, 0.1 * vol, 2800, 0, 'bandpass', pan, 900); tone(130, 0.1, 'sine', 0.22 * vol, 0.12, -50, undefined, pan); break;
    case 'death': { const k = e.kind; if (k === 'mammoth') { tone(120, 1.1, 'sawtooth', 0.22 * vol, 0, -70, undefined, pan); noise(0.6, 0.18 * vol, 400, 0, 'lowpass', pan); } else if (k === 'wolf') tone(520, 0.4, 'sawtooth', 0.14 * vol, 0, -380, undefined, pan); else if (k === 'deer') tone(700, 0.3, 'triangle', 0.12 * vol, 0, -400, undefined, pan); else { tone(190, 0.5, 'sawtooth', 0.16 * vol, 0, -110, undefined, pan); noise(0.3, 0.12 * vol, 500, 0, 'lowpass', pan); } break; }
    case 'deliver': tone(620, 0.1, 'triangle', 0.1 * vol, 0, 160, undefined, pan); tone(930, 0.14, 'sine', 0.05 * vol, 0.06, 0, undefined, pan); break;
    case 'spawn': tone(392, 0.16, 'triangle', 0.1 * vol, 0, 0, undefined, pan); tone(587, 0.24, 'triangle', 0.09 * vol, 0.1, 0, undefined, pan); break;
    case 'built': sfx.build(); break;
    case 'howl': if (e.kind === 'mammoth') { tone(150, 0.9, 'sawtooth', 0.2 * vol, 0, 160, undefined, pan); tone(230, 0.8, 'square', 0.08 * vol, 0.05, 140, undefined, pan); noise(0.5, 0.1 * vol, 700, 0.1, 'bandpass', pan, 300); } else sfx.howl(0.16 * vol, pan); break;
    case 'discover': sfx.discover(); break;
    case 'preserved': [392, 494, 587].forEach((f, i) => tone(f, 0.9, 'sine', 0.09, i * 0.12)); break;
    case 'rally': tone(220, 0.6, 'sawtooth', 0.1 * vol, 0, 40, undefined, pan); tone(330, 0.6, 'sawtooth', 0.07 * vol, 0.02, 60, undefined, pan); break;
    case 'freeze': if (e.n) { [988, 1319, 1568, 2093].forEach((f, i) => tone(f, 1.1, 'sine', 0.06, i * 0.1)); noise(0.8, 0.07, 6000, 0.1, 'highpass'); } else { noise(0.9, 0.22, 900, 0, 'bandpass', 0, 200); tone(180, 0.7, 'sawtooth', 0.12, 0, -90); } break;
    case 'job': tone(660, 0.08, 'triangle', 0.1 * vol, 0, 0, undefined, pan); tone(880, 0.1, 'triangle', 0.08 * vol, 0.07, 0, undefined, pan); break;
    case 'upgrade': [262, 330, 392, 523].forEach((f, i) => tone(f, 0.7, 'triangle', 0.1, i * 0.09)); sfx.build(); break;
    case 'tech': [440, 554, 659, 880].forEach((f, i) => tone(f, 0.5, 'sine', 0.09, i * 0.07)); break;
    case 'heal': tone(880, 0.15, 'sine', 0.025 * vol, 0, 120, undefined, pan); break;
    case 'rank': tone(523, 0.2, 'triangle', 0.12 * vol, 0, 0, undefined, pan); tone(784, 0.4, 'triangle', 0.11 * vol, 0.12, 0, undefined, pan); break;
    case 'felled': noise(0.6, 0.35 * vol, 500, 0, 'lowpass', pan, 120); tone(90, 0.4, 'sine', 0.3 * vol, 0.1, -40, undefined, pan); break;
  }
  return true;
}
