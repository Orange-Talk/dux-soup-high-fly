import { Board, COLS, ROWS, SHAPES, PieceType, collides, spawnPos, Controls, emptyControls, TYPE_ID } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'master';
interface DiffCfg { think: number; step: number; mistake: number; lookahead: boolean; hold: boolean; build: boolean; }
const DIFF: Record<Difficulty, DiffCfg> = {
  easy:   { think: 1550, step: 310, mistake: 0.62, lookahead: false, hold: false, build: false },
  normal: { think: 920,  step: 190, mistake: 0.35, lookahead: false, hold: true,  build: false },
  hard:   { think: 480,  step: 115, mistake: 0.16, lookahead: false, hold: true,  build: true },
  master: { think: 250,  step: 65,  mistake: 0.05, lookahead: true,  hold: true,  build: true },
};

interface Plan { r: number; x: number; hold: boolean; score: number; }

function place(grid: Uint8Array, t: PieceType, r: number, x: number): { g: Uint8Array; lines: number; y: number } | null {
  const sp = spawnPos(t);
  let y = sp.y + 1;
  if (collides(grid, t, r, x, y)) { y = sp.y; if (collides(grid, t, r, x, y)) return null; }
  // path check along the top
  const step = x > sp.x ? 1 : -1;
  for (let cx = sp.x; cx !== x; cx += step) if (collides(grid, t, r, cx, y)) return null;
  while (!collides(grid, t, r, x, y + 1)) y++;
  const g = grid.slice();
  for (const [cx, cy] of SHAPES[t][r]) { const yy = y + cy; if (yy < 0) return null; g[yy * COLS + x + cx] = TYPE_ID[t]; }
  let lines = 0;
  for (let row = ROWS - 1; row >= 0; row--) {
    let full = true;
    for (let c = 0; c < COLS; c++) if (!g[row * COLS + c]) { full = false; break; }
    if (full) { g.copyWithin(COLS, 0, row * COLS); g.fill(0, 0, COLS); lines++; row++; }
  }
  return { g, lines, y };
}

function evaluate(g: Uint8Array, lines: number, landY: number, t: PieceType, cfg: DiffCfg): number {
  const heights = new Array(COLS).fill(0);
  let holes = 0, colT = 0, rowT = 0, wells = 0;
  for (let x = 0; x < COLS; x++) {
    let seen = false;
    for (let y = 0; y < ROWS; y++) {
      const f = g[y * COLS + x] !== 0;
      if (f && !seen) { seen = true; heights[x] = ROWS - y; }
      else if (!f && seen) holes++;
    }
    let prev = true;
    for (let y = ROWS - 1; y >= 0; y--) { const f = g[y * COLS + x] !== 0; if (f !== prev) colT++; prev = f; }
  }
  for (let y = 0; y < ROWS; y++) {
    let prev = true;
    for (let x = 0; x < COLS; x++) { const f = g[y * COLS + x] !== 0; if (f !== prev) rowT++; prev = f; }
    if (!prev) rowT++;
  }
  for (let x = 0; x < COLS; x++) {
    if (cfg.build && x === COLS - 1) continue; // the quad well is intentional
    const l = x === 0 ? 99 : heights[x - 1], r = x === COLS - 1 ? 99 : heights[x + 1];
    const d = Math.min(l, r) - heights[x];
    if (d > 0) wells += (d * (d + 1)) / 2;
  }
  const maxH = Math.max(...heights);
  const landingHeight = ROWS - landY - 1;
  let s = -4.5 * landingHeight + 3.42 * lines - 3.22 * rowT - 9.35 * colT - 7.9 * holes - 3.39 * wells;
  if (cfg.build && maxH < 12) {
    // versus play: prefer quads, discourage cheap singles while the stack is safe
    if (lines === 4) s += 45;
    else if (lines > 0 && holes === 0) s -= 9 * lines;
    // keep the rightmost column as a well
    if (heights[COLS - 1] > 0) s -= 6 * heights[COLS - 1];
  }
  if (maxH > 14) s -= (maxH - 14) * 12 - lines * 10;
  return s;
}

function bestFor(grid: Uint8Array, t: PieceType, cfg: DiffCfg, next: PieceType | null): Plan[] {
  const out: Plan[] = [];
  const rots = t === 'O' ? 1 : t === 'I' || t === 'S' || t === 'Z' ? 2 : 4;
  for (let r = 0; r < rots; r++) {
    for (let x = -2; x < COLS; x++) {
      const res = place(grid, t, r, x);
      if (!res) continue;
      let s = evaluate(res.g, res.lines, res.y, t, cfg);
      if (next) {
        let best = -1e9;
        const r2s = next === 'O' ? 1 : next === 'I' || next === 'S' || next === 'Z' ? 2 : 4;
        for (let r2 = 0; r2 < r2s; r2++) for (let x2 = -2; x2 < COLS; x2++) {
          const r2r = place(res.g, next, r2, x2);
          if (!r2r) continue;
          const v = evaluate(r2r.g, r2r.lines, r2r.y, next, cfg);
          if (v > best) best = v;
        }
        s = s * 0.45 + best * 0.55;
      }
      out.push({ r, x, hold: false, score: s });
    }
  }
  return out;
}

export class CpuController {
  cfg: DiffCfg;
  private plan: Plan | null = null;
  private wait = 0;
  private c: Controls = emptyControls();
  private release = false;
  private holdDone = false;
  private attempts = 0;
  private lastPieceCount = -1;
  private lastCurKey = '';
  constructor(public diff: Difficulty) { this.cfg = DIFF[diff]; }

  update(b: Board, dt: number): Controls {
    // release any tapped key on the next step
    if (this.release) { this.c = emptyControls(); this.release = false; return this.c; }
    if (!b.alive || !b.cur || b.clearing) { this.c = emptyControls(); this.plan = null; return this.c; }
    const key = b.stats.pieces + ':' + b.cur.t + ':' + (b.hold ?? '');
    if (key !== this.lastCurKey && !this.plan) {
      this.lastCurKey = key;
      this.wait = this.cfg.think * (0.75 + Math.random() * 0.55);
      this.plan = this.decide(b);
      this.holdDone = false;
      this.attempts = 0;
    }
    if (!this.plan) { this.c = emptyControls(); return this.c; }
    this.wait -= dt;
    if (this.wait > 0) return emptyControls();
    this.wait = this.cfg.step * (0.8 + Math.random() * 0.45);
    const c = emptyControls();
    const p = this.plan;
    // super usage (Rookie uses Super sparingly so beginners don't get overwhelmed)
    if (b.superMeter >= b.rules.superCost && (this.diff !== 'easy' || Math.random() < 0.15)) {
      const top = b.stackTop();
      if ((b.character === 'nong' && (b.incomingTotal >= 2 || Math.random() < 0.3)) || (b.character !== 'nong' && (top < 12 || b.incomingTotal >= 2))) {
        c.super = true; this.tap(c); return c;
      }
    }
    if (p.hold && !this.holdDone) { this.holdDone = true; c.hold = true; this.tap(c); this.lastCurKey = 'held'; return c; }
    const cur = b.cur;
    this.attempts++;
    if (this.attempts > 30) { c.hard = true; this.finish(); this.tap(c); return c; }
    if (cur.r !== p.r) {
      const diff = (p.r - cur.r + 4) % 4;
      if (diff === 3) c.ccw = true; else c.cw = true;
    } else if (cur.x < p.x) c.right = true;
    else if (cur.x > p.x) c.left = true;
    else {
      // Rookie never slams pieces with hard-drop; Brawler soft-drops more than half the time
      if (this.diff === 'easy' || (this.diff === 'normal' && Math.random() < 0.55)) {
        c.soft = true; this.c = c; return c;
      }
      c.hard = true; this.finish();
    }
    this.tap(c);
    return c;
  }

  private finish() { this.plan = null; this.lastCurKey = ''; }
  private tap(c: Controls) { this.c = c; this.release = true; }

  private decide(b: Board): Plan | null {
    const cur = b.cur!;
    const q = b.queue(2);
    const look = this.cfg.lookahead;
    let plans = bestFor(b.grid, cur.t, this.cfg, look ? q[0] : null);
    if (this.cfg.hold && b.canHold) {
      const alt = b.hold ?? q[0];
      const altNext = b.hold ? q[0] : q[1];
      const hp = bestFor(b.grid, alt, this.cfg, look ? altNext : null).map((p) => ({ ...p, hold: true, score: p.score - 1 }));
      plans = plans.concat(hp);
    }
    if (!plans.length) return { r: cur.r, x: cur.x, hold: false, score: 0 };
    plans.sort((a, b2) => b2.score - a.score);
    if (Math.random() < this.cfg.mistake) {
      const minRank = this.diff === 'easy' ? 2 : 1;
      const spread = this.diff === 'easy' ? 11 : this.diff === 'normal' ? 7 : 4;
      const k = Math.min(plans.length - 1, minRank + Math.floor(Math.random() * spread));
      return plans[k];
    }
    return plans[0];
  }
}
