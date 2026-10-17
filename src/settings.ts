export type TouchMode = 'swipe' | 'buttons' | 'off';

export interface Settings {
  music: number; sfx: number; ghost: boolean; shake: boolean; reducedFlash: boolean;
  handling: 'relaxed' | 'normal' | 'fast'; rounds: number; garbageDelay: number; speedUpEvery: number;
  touch: TouchMode;
}
export interface Record_ {
  versus: Record<string, number>;
  cpu: Record<string, { w: number; l: number }>;
  online: Record<string, number>;
  matches: number;
  quads: number;
  bestCombo: number;
  unlocked: string[];
}

const KEY = 'blockclash.v1';
const defaults: Settings = { music: 0.6, sfx: 0.75, ghost: true, shake: true, reducedFlash: false, handling: 'normal', rounds: 2, garbageDelay: 1100, speedUpEvery: 40, touch: 'swipe' };
const defaultRec = (): Record_ => ({ versus: { nong: 0, nang: 0 }, cpu: {}, online: { win: 0, loss: 0 }, matches: 0, quads: 0, bestCombo: 0, unlocked: [] });

function normalizeTouch(v: any): TouchMode {
  if (v === 'buttons' || v === 'off' || v === 'swipe') return v;
  return 'swipe'; // migrate legacy 'auto' / 'on' to 'swipe' default
}

function read(): { s: Settings; r: Record_ } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      const s: Settings = { ...defaults, ...(j.s || {}) };
      s.touch = normalizeTouch(s.touch);
      const r: Record_ = { ...defaultRec(), ...(j.r || {}) };
      if (!Array.isArray(r.unlocked)) r.unlocked = [];
      return { s, r };
    }
  } catch { /* storage unavailable */ }
  return { s: { ...defaults }, r: defaultRec() };
}
const loaded = read();
export const settings: Settings = loaded.s;
export const record: Record_ = loaded.r;
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ s: settings, r: record })); } catch { /* ignore */ }
}
