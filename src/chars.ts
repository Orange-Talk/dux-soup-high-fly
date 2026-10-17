import type { CharId } from './assets';
import type { GarbageStyle } from './engine';
import { record, save } from './settings';

export interface CharInfo {
  id: CharId; name: string; title: string; tagline: string;
  color: string; colorAlt: string; glow: string; glowAlt: string;
  style: GarbageStyle; styleName: string; styleDesc: string;
  superName: string; superDesc: string;
  stats: { power: number; defense: number; speed: number };
  /** If true, hidden from character select until unlocked in record.unlocked */
  secret?: boolean;
  unlockHint?: string;
}

export const CHARS: Record<CharId, CharInfo> = {
  nong: {
    id: 'nong', name: 'NONG', title: 'The Shadow Brawler',
    tagline: 'Street reflexes. Every quad lands like a haymaker.',
    color: '#35d6ff', colorAlt: '#ff4f6e', glow: 'rgba(53,214,255,', glowAlt: 'rgba(255,79,110,',
    style: 'wall', styleName: 'Brick Wall', styleDesc: 'Sends solid garbage with a single shared hole.',
    superName: 'SHADOW SLAM', superDesc: 'Wipes out all garbage coming at you, then hits for 4 lines.',
    stats: { power: 5, defense: 3, speed: 4 },
  },
  nang: {
    id: 'nang', name: 'NANG', title: 'The Emerald Striker',
    tagline: 'Fluid footwork. Turns a messy board into a counterattack.',
    color: '#3ee6a0', colorAlt: '#d77bff', glow: 'rgba(62,230,160,', glowAlt: 'rgba(215,123,255,',
    style: 'stair', styleName: 'Staircase', styleDesc: 'Sends garbage whose hole steps one column every row.',
    superName: 'EMERALD BURST', superDesc: 'Blasts away the bottom 4 rows of your stack, then hits for 2.',
    stats: { power: 3, defense: 5, speed: 4 },
  },
  stucchi: {
    id: 'stucchi', name: 'STUCCHI', title: 'The Italian & Arya',
    tagline: 'Cool under pressure. His loyal white husky Arya pounces on command.',
    color: '#ff8a3d', colorAlt: '#3b9eff', glow: 'rgba(255,138,61,', glowAlt: 'rgba(59,158,255,',
    style: 'pack', styleName: 'Husky Tracks', styleDesc: 'Sends alternating two-step garbage rows to trip up your rival.',
    superName: 'ARYA ATTACK!', superDesc: 'Arya lunges! Cancels up to 3 incoming lines, clears 2 bottom rows & hits for 3.',
    stats: { power: 4, defense: 4, speed: 4 },
  },
};

export function isCharUnlocked(id: CharId): boolean {
  const info = CHARS[id];
  if (!info) return false;
  if (!info.secret) return true;
  return record.unlocked.includes(id);
}

export function unlockSecretChar(id: CharId): boolean {
  if (!CHARS[id] || record.unlocked.includes(id)) return false;
  record.unlocked.push(id);
  save();
  return true;
}

export function getUnlockedChars(): CharId[] {
  return (Object.keys(CHARS) as CharId[]).filter(isCharUnlocked);
}

export const charColor = (id: CharId, alt: boolean) => (alt ? CHARS[id].colorAlt : CHARS[id].color);
export const charGlow = (id: CharId, alt: boolean, a: number) => (alt ? CHARS[id].glowAlt : CHARS[id].glow) + a + ')';
