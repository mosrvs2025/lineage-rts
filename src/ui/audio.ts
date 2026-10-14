/** Tiny synthesized audio: UI clicks, alerts, fanfares and ambient wind. No audio files. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try { muted = localStorage.getItem('lineage-rts:muted') === '1'; } catch { /* storage unavailable */ }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ctx.destination);
    ambient();
  } catch { ctx = null; }
}
export const isMuted = () => muted;
export function setMuted(m: boolean) {
  muted = m;
  try { localStorage.setItem('lineage-rts:muted', m ? '1' : '0'); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.05);
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.18, delay = 0, slide = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur: number, vol: number, lp: number, delay = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay, n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(t);
}
function ambient() {
  if (!ctx || !master) return;
  const n = ctx.sampleRate * 4, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.2; }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.6;
  const g = ctx.createGain(); g.gain.value = 0.08;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.05; lfo.connect(lg); lg.connect(g.gain); lfo.start();
  s.connect(f); f.connect(g); g.connect(master); s.start();
}

export const sfx = {
  hover: () => tone(1400, 0.04, 'sine', 0.025),
  click: () => { tone(520, 0.07, 'triangle', 0.14); tone(780, 0.08, 'triangle', 0.08, 0.03); },
  error: () => { tone(160, 0.14, 'sawtooth', 0.11); tone(120, 0.18, 'sawtooth', 0.09, 0.08); },
  good: () => { tone(660, 0.12, 'sine', 0.13); tone(880, 0.18, 'sine', 0.11, 0.09); },
  place: () => { noise(0.18, 0.35, 700); tone(110, 0.2, 'sine', 0.2, 0, -50); },
  build: () => { tone(523, 0.14, 'triangle', 0.14); tone(659, 0.14, 'triangle', 0.14, 0.1); tone(784, 0.3, 'triangle', 0.14, 0.2); },
  alert: () => { for (let i = 0; i < 3; i++) tone(i % 2 ? 392 : 311, 0.2, 'square', 0.09, i * 0.17); noise(0.3, 0.1, 500); },
  discover: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'sine', 0.12, i * 0.1)); },
  win: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.55, 'triangle', 0.14, i * 0.14)); tone(131, 1.4, 'sine', 0.18, 0.1); },
  lose: () => { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.6, 'sawtooth', 0.09, i * 0.25)); },
};
