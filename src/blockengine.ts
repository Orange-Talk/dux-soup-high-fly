// Open-grid block puzzle: drag pieces anywhere on an 8x8 grid, full rows AND columns clear.
import { mulberry32 } from './engine';

export const N = 8;
export const STONE = 8;

export interface BShape { key: string; cells: [number, number][]; w: number; h: number; color: number; }

function shape(key: string, rows: string[], color: number): BShape {
  const cells: [number, number][] = [];
  rows.forEach((r, y) => r.split('').forEach((c, x) => { if (c === '#') cells.push([x, y]); }));
  return { key, cells, w: Math.max(...rows.map((r) => r.length)), h: rows.length, color };
}

// [shape, weight]. Mid-size pieces show up most, just like the phone games.
const DEFS: [BShape, number][] = [
  [shape('1', ['#'], 2), 3],
  [shape('2h', ['##'], 6), 5], [shape('2v', ['#', '#'], 6), 5],
  [shape('3h', ['###'], 1), 5], [shape('3v', ['#', '#', '#'], 1), 5],
  [shape('4h', ['####'], 1), 4], [shape('4v', ['#', '#', '#', '#'], 1), 4],
  [shape('5h', ['#####'], 5), 2], [shape('5v', ['#', '#', '#', '#', '#'], 5), 2],
  [shape('o2', ['##', '##'], 2), 6],
  [shape('o3', ['###', '###', '###'], 4), 2],
  [shape('r23', ['###', '###'], 3), 2], [shape('r32', ['##', '##', '##'], 3), 2],
  [shape('l3a', ['#.', '##'], 7), 3], [shape('l3b', ['.#', '##'], 7), 3], [shape('l3c', ['##', '#.'], 7), 3], [shape('l3d', ['##', '.#'], 7), 3],
  [shape('t1', ['###', '.#.'], 3), 2], [shape('t2', ['.#.', '###'], 3), 2], [shape('t3', ['#.', '##', '#.'], 3), 2], [shape('t4', ['.#', '##', '.#'], 3), 2],
  [shape('s1', ['.##', '##.'], 4), 2], [shape('s2', ['#.', '##', '.#'], 4), 2], [shape('z1', ['##.', '.##'], 5), 2], [shape('z2', ['.#', '##', '#.'], 5), 2],
  [shape('j1', ['#..', '###'], 6), 2], [shape('j2', ['##', '#.', '#.'], 6), 2], [shape('j3', ['###', '..#'], 6), 2], [shape('j4', ['.#', '.#', '##'], 6), 2],
  [shape('L1', ['..#', '###'], 7), 2], [shape('L2', ['#.', '#.', '##'], 7), 2], [shape('L3', ['###', '#..'], 7), 2], [shape('L4', ['##', '.#', '.#'], 7), 2],
  [shape('B1', ['#..', '#..', '###'], 1), 1], [shape('B2', ['###', '#..', '#..'], 1), 1], [shape('B3', ['###', '..#', '..#'], 1), 1], [shape('B4', ['..#', '..#', '###'], 1), 1],
];
export const SHAPE_BY_KEY: Record<string, BShape> = Object.fromEntries(DEFS.map(([s]) => [s.key, s]));
const TOTAL_W = DEFS.reduce((a, [, w]) => a + w, 0);

export type BEvent =
  | { k: 'place'; cells: [number, number][]; color: number }
  | { k: 'clear'; rows: number[]; cols: number[]; lines: number; combo: number; cells: [number, number, number][]; score: number; attack: number }
  | { k: 'send'; lines: number; kind: 'jab' | 'kick' | 'heavy' | 'super' }
  | { k: 'cancel'; lines: number }
  | { k: 'incoming'; lines: number }
  | { k: 'garbageIn'; lines: number; cells: [number, number][] }
  | { k: 'deal' }
  | { k: 'super'; char: string }
  | { k: 'burst'; cells: [number, number][] }
  | { k: 'superReady' }
  | { k: 'ko' };

export interface BStats { pieces: number; lines: number; attack: number; quads: number; spins: number; maxCombo: number; time: number; score: number; pcs: number; garbageCleared: number; }

export class BlockBoard {
  grid = new Uint8Array(N * N);
  tray: (BShape | null)[] = [null, null, null];
  alive = true;
  events: BEvent[] = [];
  incoming: { lines: number; age: number }[] = [];
  superMeter = 0;
  rules = { superCost: 100, garbageDelay: 1600 };
  streak = 0; // consecutive clearing turns
  sinceClear = 99; // placements since the last clear
  sentTotal = 0;
  frozen = false;
  versus: boolean;
  stats: BStats = { pieces: 0, lines: 0, attack: 0, quads: 0, spins: 0, maxCombo: 0, time: 0, score: 0, pcs: 0, garbageCleared: 0 };
  private rng: () => number;
  private stoneRng: () => number;
  private idle = 0;

  constructor(seed: number, public character: string, versus: boolean) {
    this.rng = mulberry32(seed);
    this.stoneRng = mulberry32(seed ^ 0x51ed);
    this.versus = versus;
  }

  start() { this.deal(); }

  cell(x: number, y: number) { return this.grid[y * N + x]; }

  canPlace(s: BShape, x: number, y: number): boolean {
    for (const [cx, cy] of s.cells) {
      const gx = x + cx, gy = y + cy;
      if (gx < 0 || gy < 0 || gx >= N || gy >= N || this.grid[gy * N + gx]) return false;
    }
    return true;
  }
  fits(s: BShape): boolean {
    for (let y = 0; y <= N - s.h; y++) for (let x = 0; x <= N - s.w; x++) if (this.canPlace(s, x, y)) return true;
    return false;
  }
  anyFits(): boolean { return this.tray.some((s) => s && this.fits(s)); }

  private pick(): BShape {
    let r = this.rng() * TOTAL_W;
    for (const [s, w] of DEFS) { r -= w; if (r <= 0) return s; }
    return DEFS[0][0];
  }

  private deal() {
    // never deal a hand where nothing fits if the board still has room for something
    for (let t = 0; t < 12; t++) {
      this.tray = [this.pick(), this.pick(), this.pick()];
      if (this.anyFits()) break;
    }
    if (!this.anyFits()) {
      const easy = [SHAPE_BY_KEY['1'], SHAPE_BY_KEY['2h'], SHAPE_BY_KEY['2v']].filter((s) => this.fits(s));
      if (easy.length) this.tray[0] = easy[0];
    }
    this.events.push({ k: 'deal' });
  }

  /** lines that WOULD clear if s goes at x,y (for the drag preview) */
  previewClears(s: BShape, x: number, y: number): { rows: number[]; cols: number[] } {
    const g = this.grid.slice();
    for (const [cx, cy] of s.cells) g[(y + cy) * N + x + cx] = 1;
    const rows: number[] = [], cols: number[] = [];
    for (let r = 0; r < N; r++) { let f = true; for (let c = 0; c < N; c++) if (!g[r * N + c]) { f = false; break; } if (f) rows.push(r); }
    for (let c = 0; c < N; c++) { let f = true; for (let r = 0; r < N; r++) if (!g[r * N + c]) { f = false; break; } if (f) cols.push(c); }
    return { rows, cols };
  }

  place(slot: number, x: number, y: number): boolean {
    const s = this.tray[slot];
    if (!this.alive || this.frozen || !s || !this.canPlace(s, x, y)) return false;
    const cells: [number, number][] = [];
    for (const [cx, cy] of s.cells) { this.grid[(y + cy) * N + x + cx] = s.color; cells.push([x + cx, y + cy]); }
    this.tray[slot] = null;
    this.stats.pieces++;
    this.stats.score += cells.length;
    this.idle = 0;
    this.events.push({ k: 'place', cells, color: s.color });
    const cleared = this.resolve();
    if (!cleared) this.landGarbage(false);
    if (this.tray.every((t) => !t)) this.deal();
    this.checkAlive();
    return true;
  }

  private resolve(): boolean {
    const rows: number[] = [], cols: number[] = [];
    for (let r = 0; r < N; r++) { let f = true; for (let c = 0; c < N; c++) if (!this.grid[r * N + c]) { f = false; break; } if (f) rows.push(r); }
    for (let c = 0; c < N; c++) { let f = true; for (let r = 0; r < N; r++) if (!this.grid[r * N + c]) { f = false; break; } if (f) cols.push(c); }
    const lines = rows.length + cols.length;
    if (!lines) {
      this.sinceClear++;
      if (this.sinceClear >= 3) this.streak = 0;
      return false;
    }
    this.streak = this.sinceClear <= 3 ? this.streak + 1 : 1;
    this.sinceClear = 0;
    const gone: [number, number, number][] = [];
    const mark = new Set<number>();
    for (const r of rows) for (let c = 0; c < N; c++) mark.add(r * N + c);
    for (const c of cols) for (let r = 0; r < N; r++) mark.add(r * N + c);
    for (const i of mark) { if (this.grid[i] === STONE) this.stats.garbageCleared++; gone.push([i % N, Math.floor(i / N), this.grid[i]]); this.grid[i] = 0; }
    const pts = Math.round(mark.size * 10 * lines * (1 + 0.5 * (this.streak - 1)));
    this.stats.score += pts;
    this.stats.lines += lines;
    if (lines >= 3) this.stats.quads++;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.streak - 1);
    let pc = true;
    for (let i = 0; i < N * N; i++) if (this.grid[i]) { pc = false; break; }
    if (pc) { this.stats.pcs++; this.stats.score += 300; }
    const ATK = [0, 1, 2, 3, 5, 6, 8];
    let attack = this.versus ? ATK[Math.min(lines, 6)] + Math.floor(Math.max(0, this.streak - 1) / 2) + (pc ? 5 : 0) : 0;
    this.events.push({ k: 'clear', rows, cols, lines, combo: this.streak, cells: gone, score: pts, attack });
    this.gain(lines * 9 + this.streak * 4);
    if (attack > 0) this.attack(attack, lines >= 3 || pc ? 'heavy' : lines >= 2 || this.streak >= 3 ? 'kick' : 'jab');
    return true;
  }

  private gain(n: number) {
    if (!this.versus) return;
    const was = this.superMeter;
    this.superMeter = Math.min(this.rules.superCost, this.superMeter + n);
    if (was < this.rules.superCost && this.superMeter >= this.rules.superCost) this.events.push({ k: 'superReady' });
  }

  attack(lines: number, kind: 'jab' | 'kick' | 'heavy' | 'super') {
    let rem = lines, cancelled = 0;
    while (rem > 0 && this.incoming.length) {
      const inc = this.incoming[0];
      const c = Math.min(inc.lines, rem);
      inc.lines -= c; rem -= c; cancelled += c;
      if (inc.lines <= 0) this.incoming.shift();
    }
    this.stats.attack += lines;
    if (cancelled) this.events.push({ k: 'cancel', lines: cancelled });
    if (rem > 0) { this.sentTotal += rem; this.events.push({ k: 'send', lines: rem, kind }); }
  }

  receive(lines: number) {
    if (lines <= 0 || !this.alive) return;
    this.incoming.push({ lines, age: 0 });
    this.events.push({ k: 'incoming', lines });
  }
  get incomingTotal() { return this.incoming.reduce((a, b) => a + b.lines, 0); }

  /** stones drop into random empty cells; returns true if any landed */
  private landGarbage(force: boolean): boolean {
    let cap = 8, n = 0;
    while (cap > 0 && this.incoming.length && (force || this.incoming[0].age >= this.rules.garbageDelay)) {
      const inc = this.incoming[0];
      const take = Math.min(inc.lines, cap);
      inc.lines -= take; cap -= take; n += take;
      if (inc.lines <= 0) this.incoming.shift();
      if (!force) continue;
    }
    if (!n) return false;
    // stones land as partial rows (always leaving a gap), so they can be cleared like garbage lines
    const cells: [number, number][] = [];
    let left = n;
    while (left > 0) {
      const rows: number[] = [];
      for (let r = 0; r < N; r++) { const e = N - this.rowFill(r); if (e >= 2) rows.push(r); }
      if (!rows.length) {
        const empty: number[] = [];
        for (let i = 0; i < N * N; i++) if (!this.grid[i]) empty.push(i);
        if (!empty.length) break;
        const i = empty[Math.floor(this.stoneRng() * empty.length)];
        this.grid[i] = STONE; cells.push([i % N, Math.floor(i / N)]); left--;
        continue;
      }
      const r = rows[Math.floor(this.stoneRng() * rows.length)];
      const empties: number[] = [];
      for (let c = 0; c < N; c++) if (!this.grid[r * N + c]) empties.push(c);
      const take = Math.min(left, empties.length - 1, 4);
      for (let k = 0; k < take; k++) {
        const j = Math.floor(this.stoneRng() * empties.length);
        const c = empties.splice(j, 1)[0];
        this.grid[r * N + c] = STONE; cells.push([c, r]);
      }
      left -= take;
    }
    this.events.push({ k: 'garbageIn', lines: n, cells });
    return true;
  }

  private checkAlive() {
    if (!this.alive) return;
    if (!this.anyFits()) { this.alive = false; this.events.push({ k: 'ko' }); }
  }

  /** character supers, tuned for the open grid */
  fireSuper(): boolean {
    if (!this.alive || this.frozen || this.superMeter < this.rules.superCost) return false;
    this.superMeter = 0;
    this.events.push({ k: 'super', char: this.character });
    const clearRows = (k: number) => {
      const order = Array.from({ length: N }, (_, r) => r).sort((a, b) => this.rowFill(b) - this.rowFill(a)).slice(0, k);
      const cells: [number, number][] = [];
      for (const r of order) for (let c = 0; c < N; c++) if (this.grid[r * N + c]) { cells.push([c, r]); this.grid[r * N + c] = 0; }
      return cells;
    };
    if (this.character === 'nong') {
      const wiped = this.incomingTotal;
      this.incoming = [];
      if (wiped) this.events.push({ k: 'cancel', lines: wiped });
      this.stats.attack += 5; this.sentTotal += 5;
      this.events.push({ k: 'send', lines: 5, kind: 'super' });
    } else if (this.character === 'stucchi') {
      let c = 3;
      while (c > 0 && this.incoming.length) { const inc = this.incoming[0]; const t = Math.min(c, inc.lines); inc.lines -= t; c -= t; if (inc.lines <= 0) this.incoming.shift(); }
      this.events.push({ k: 'burst', cells: clearRows(2) });
      this.attack(3, 'super');
    } else {
      // Nang: every stone shatters, plus the fullest row
      const cells: [number, number][] = [];
      for (let i = 0; i < N * N; i++) if (this.grid[i] === STONE) { cells.push([i % N, Math.floor(i / N)]); this.grid[i] = 0; }
      cells.push(...clearRows(1));
      this.events.push({ k: 'burst', cells });
      this.attack(2, 'super');
    }
    return true;
  }
  rowFill(r: number) { let n = 0; for (let c = 0; c < N; c++) if (this.grid[r * N + c]) n++; return n; }

  update(dt: number) {
    if (!this.alive || this.frozen) return;
    this.stats.time += dt;
    for (const inc of this.incoming) inc.age += dt;
    this.idle += dt;
    // ready garbage will not wait forever for a placement
    if (this.incoming.length && this.incoming[0].age >= this.rules.garbageDelay + 3500 && this.idle > 2500) {
      this.idle = 0;
      if (this.landGarbage(true)) this.checkAlive();
    }
  }

  fillRatio() { let n = 0; for (let i = 0; i < N * N; i++) if (this.grid[i]) n++; return n / (N * N); }
}
