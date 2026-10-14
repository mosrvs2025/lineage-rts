/** Player settings, persisted in localStorage (every access is guarded: storage can be blocked). */
export type Quality = 'auto' | 'high' | 'medium' | 'low';
export interface Settings { music: number; sfx: number; muted: boolean; quality: Quality; edgePan: boolean; hints: boolean; shake: boolean }

const KEY = 'lineage-rts:settings:v1';
const defaults: Settings = { music: 0.6, sfx: 0.85, muted: false, quality: 'auto', edgePan: true, hints: true, shake: true };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Settings>, s = { ...defaults };
      if (typeof j.music === 'number') s.music = Math.max(0, Math.min(1, j.music));
      if (typeof j.sfx === 'number') s.sfx = Math.max(0, Math.min(1, j.sfx));
      if (typeof j.muted === 'boolean') s.muted = j.muted;
      if (j.quality === 'auto' || j.quality === 'high' || j.quality === 'medium' || j.quality === 'low') s.quality = j.quality;
      if (typeof j.edgePan === 'boolean') s.edgePan = j.edgePan;
      if (typeof j.hints === 'boolean') s.hints = j.hints;
      if (typeof j.shake === 'boolean') s.shake = j.shake;
      return s;
    }
  } catch { /* ignore corrupt or unavailable storage */ }
  return { ...defaults };
}

export const settings: Settings = load();
const listeners: (() => void)[] = [];
export function onSettings(fn: () => void) { listeners.push(fn); }
export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  for (const l of listeners) l();
}
