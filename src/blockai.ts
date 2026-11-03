import { BlockBoard, BShape, N, SHAPE_BY_KEY } from './blockengine';
import type { Difficulty } from './ai';

const PROBES = [SHAPE_BY_KEY['o3'], SHAPE_BY_KEY['5h'], SHAPE_BY_KEY['5v'], SHAPE_BY_KEY['4h'], SHAPE_BY_KEY['4v'], SHAPE_BY_KEY['o2']];
const CFG: Record<Difficulty, { think: number; mistake: number }> = {
  easy: { think: 3000, mistake: 0.35 },
  normal: { think: 1900, mistake: 0.12 },
  hard: { think: 1150, mistake: 0.03 },
  master: { think: 650, mistake: 0 },
};

export interface BMove { slot: number; x: number; y: number; score: number; }

function sim(grid: Uint8Array, s: BShape, x: number, y: number): { g: Uint8Array; lines: number } {
  const g = grid.slice();
  for (const [cx, cy] of s.cells) g[(y + cy) * N + x + cx] = 1;
  const rows: number[] = [], cols: number[] = [];
  for (let r = 0; r < N; r++) { let f = true; for (let c = 0; c < N; c++) if (!g[r * N + c]) { f = false; break; } if (f) rows.push(r); }
  for (let c = 0; c < N; c++) { let f = true; for (let r = 0; r < N; r++) if (!g[r * N + c]) { f = false; break; } if (f) cols.push(c); }
  for (const r of rows) for (let c = 0; c < N; c++) g[r * N + c] = 0;
  for (const c of cols) for (let r = 0; r < N; r++) g[r * N + c] = 0;
  return { g, lines: rows.length + cols.length };
}

function fitsIn(g: Uint8Array, s: BShape) {
  for (let y = 0; y <= N - s.h; y++) for (let x = 0; x <= N - s.w; x++) {
    let ok = true;
    for (const [cx, cy] of s.cells) if (g[(y + cy) * N + x + cx]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

function evaluate(g: Uint8Array, lines: number): number {
  let filled = 0, lonely = 0, edges = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = g[y * N + x];
    if (v) { filled++; continue; }
    let nb = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || g[ny * N + nx]) nb++;
    }
    if (nb >= 4) lonely += 3; else if (nb === 3) lonely += 1;
    edges += nb;
  }
  let room = 0;
  for (const p of PROBES) if (fitsIn(g, p)) room++;
  return lines * 22 + (lines >= 2 ? lines * 10 : 0) - filled * 1.2 - lonely * 6 - edges * 0.4 + room * 9;
}

export function bestMove(b: BlockBoard): BMove | null {
  const moves: BMove[] = [];
  b.tray.forEach((s, slot) => {
    if (!s) return;
    for (let y = 0; y <= N - s.h; y++) for (let x = 0; x <= N - s.w; x++) {
      if (!b.canPlace(s, x, y)) continue;
      const r = sim(b.grid, s, x, y);
      // can the rest of the hand still go somewhere?
      let rest = 0;
      b.tray.forEach((o, j) => { if (o && j !== slot && !fitsIn(r.g, o)) rest -= 40; });
      moves.push({ slot, x, y, score: evaluate(r.g, r.lines) + rest });
    }
  });
  if (!moves.length) return null;
  moves.sort((a, c) => c.score - a.score);
  return moves[0];
}

export class BlockCpu {
  private wait: number;
  move: BMove | null = null;
  constructor(public diff: Difficulty) { this.wait = CFG[diff].think; }
  /** returns a move when the CPU is ready to place */
  update(b: BlockBoard, dt: number): BMove | null {
    if (!b.alive || b.frozen) return null;
    this.wait -= dt;
    if (this.wait > 0) return null;
    const c = CFG[this.diff];
    this.wait = c.think * (0.7 + Math.random() * 0.6);
    if (b.superMeter >= b.rules.superCost && Math.random() < 0.5) { b.fireSuper(); return null; }
    let m = bestMove(b);
    if (m && Math.random() < c.mistake) {
      // a sloppy but legal move
      const opts: BMove[] = [];
      b.tray.forEach((s, slot) => { if (!s) return; for (let y = 0; y <= N - s.h; y++) for (let x = 0; x <= N - s.w; x++) if (b.canPlace(s, x, y)) opts.push({ slot, x, y, score: 0 }); });
      if (opts.length) m = opts[Math.floor(Math.random() * opts.length)];
    }
    return m;
  }
}
