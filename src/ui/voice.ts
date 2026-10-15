/** Unit voice lines: short spoken acknowledgements on select and order, using the browser's speech synthesis (no audio assets). */
import type { Species, UnitKind } from '../sim/types';
import { isMuted } from './audio';
import { SPECIES } from '../data/species';
import { settings } from './settings';

type Ctx = 'select' | 'move' | 'attack' | 'work' | 'build' | 'annoyed';
const LINES: Partial<Record<UnitKind, Partial<Record<Ctx, string[]>>>> = {
  gatherer: { select: ['Yes?', 'Hm?', 'What is needed?', 'I listen.'], move: ['Going.', 'This way.', 'Right away.'], work: ['To work.', 'I will gather.', 'Many hands.'], build: ['I will build it.', 'Stone and timber.'], attack: ['If I must.'], annoyed: ['My back aches!', 'Let me work!'] },
  scout: { select: ['Eyes open.', 'I see far.'], move: ['Swift as wind.', 'I go ahead.'], attack: ['Quick strike!'] },
  hunter: { select: ['The hunt?', 'Bow ready.'], move: ['Following tracks.', 'Quietly.'], attack: ['Loose!', 'Prey sighted!'], work: ['Fresh meat.'] },
  guard: { select: ['Spear ready.', 'I stand guard.'], move: ['Moving out.', 'Shield up.'], attack: ['For the clan!', 'Hold the line!'] },
  raider: { select: ['Bored.', 'Who do we hit?'], move: ['Let us go.'], attack: ['Smash them!', 'Raid!'] },
  leader: { select: ['Speak, ancestor.', 'The clan follows me.'], move: ['With me!', 'Onward.'], attack: ['Rally to me!', 'Drive them back!'] },
  elder: { select: ['Patience, child.', 'I remember.'], move: ['Slowly now.', 'My old legs...'], attack: ['I am too old for this.'] },
  slinger: { select: ['Stones ready.', 'Point the way.'], move: ['Light feet.'], attack: ['Sling!', 'Rain stones!'] },
  brute: { select: ['Hrrm.', 'Big work?'], move: ['Hrm. Going.'], attack: ['Crush!', 'Break it!'] },
  stalker: { select: ['I see them.', 'Quiet feet.'], move: ['Through the stones.', 'Following.'], attack: ['Javelin!', 'Strike true!'] },
  champion: { select: ['Command me.', 'Blood and honour.'], move: ['As you command.'], attack: ['Glory to the lineage!', 'Face me!'] },
};

let last = 0, lastSel = { id: -1, n: 0, t: 0 };
let voices: SpeechSynthesisVoice[] = [];
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
if (synth) { const load = () => { voices = synth.getVoices(); }; load(); synth.addEventListener?.('voiceschanged', load); }

function pick<T>(a: T[]) { return a[Math.floor(Math.random() * a.length)]; }

/** Speak a line for a unit. Throttled so rapid clicking never turns into a babble. */
export function voice(kind: UnitKind, species: Species, ctx: Ctx, unitId = -1) {
  if (!synth || !settings.voices || isMuted() || settings.sfx <= 0.01) return;
  const now = performance.now();
  if (ctx === 'select') {
    // Warcraft-style: click the same unit repeatedly and it gets annoyed
    lastSel = lastSel.id === unitId && now - lastSel.t < 1500 ? { id: unitId, n: lastSel.n + 1, t: now } : { id: unitId, n: 1, t: now };
    if (lastSel.n >= 5) ctx = 'annoyed';
  }
  if (now - last < 900) return;
  const set = LINES[kind]; const lines = set?.[ctx] ?? set?.select ?? LINES.gatherer!.select!;
  if (!lines?.length) return;
  last = now;
  try {
    synth.cancel();
    const u = new SpeechSynthesisUtterance(pick(lines));
    const deep = SPECIES[species].voicePitch < 0.7 || kind === 'brute';
    u.pitch = deep ? 0.55 : species === 'denisovan' ? 0.8 : kind === 'elder' ? 0.75 : kind === 'scout' || kind === 'slinger' ? 1.25 : 1.0;
    u.rate = kind === 'elder' ? 0.85 : kind === 'scout' ? 1.25 : 1.05;
    u.volume = Math.min(1, settings.sfx * 0.9);
    const en = voices.filter((v) => v.lang?.startsWith('en'));
    if (en.length) u.voice = en[(Math.abs(unitId) + (deep ? 1 : 0)) % en.length];
    synth.speak(u);
  } catch { /* speech unavailable */ }
}
