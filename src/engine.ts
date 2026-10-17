// Core falling-block engine. Pure logic, no rendering.
export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const COLS = 10;
export const ROWS = 22; // two hidden rows on top
export const HIDDEN = 2;
export const GARBAGE = 8;
export const TYPE_ID: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
export const ID_TYPE: PieceType[] = ['I', 'I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const BASE: Record<PieceType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

function rot(m: number[][]): number[][] {
  const n = m.length;
  const r = Array.from({ length: n }, () => Array(n).fill(0));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r[x][n - 1 - y] = m[y][x];
  return r;
}

/** SHAPES[type][rotation] = list of [x,y] cell offsets within the piece box */
export const SHAPES: Record<PieceType, [number, number][][]> = {} as any;
export const BOX: Record<PieceType, number> = {} as any;
for (const t of PIECES) {
  let m = BASE[t];
  BOX[t] = m.length;
  SHAPES[t] = [];
  for (let r = 0; r < 4; r++) {
    const cells: [number, number][] = [];
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) cells.push([x, y]);
    SHAPES[t].push(cells);
    m = rot(m);
  }
}

// SRS kicks (x right, y UP in the standard tables; converted to y down)
const K_JLSTZ: Record<string, [number, number][]> = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const K_I: Record<string, [number, number][]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};
export function kicks(t: PieceType, from: number, to: number): [number, number][] {
  if (t === 'O') return [[0, 0]];
  const tbl = t === 'I' ? K_I : K_JLSTZ;
  return tbl[from + '>' + to].map(([x, y]) => [x, -y] as [number, number]);
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Bag {
  private rng: () => number;
  private q: PieceType[] = [];
  constructor(seed: number) { this.rng = mulberry32(seed); }
  private refill() {
    const b = [...PIECES];
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    this.q.push(...b);
  }
  peek(n: number): PieceType[] { while (this.q.length < n) this.refill(); return this.q.slice(0, n); }
  next(): PieceType { while (this.q.length < 8) this.refill(); return this.q.shift()!; }
}

export interface Active { t: PieceType; r: number; x: number; y: number; }

export function collides(grid: Uint8Array, t: PieceType, r: number, x: number, y: number): boolean {
  const cells = SHAPES[t][r];
  for (let i = 0; i < cells.length; i++) {
    const cx = x + cells[i][0], cy = y + cells[i][1];
    if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
    if (cy >= 0 && grid[cy * COLS + cx]) return true;
  }
  return false;
}

export function dropY(grid: Uint8Array, p: Active): number {
  let y = p.y;
  while (!collides(grid, p.t, p.r, p.x, y + 1)) y++;
  return y;
}

export function spawnPos(t: PieceType): Active {
  const x = t === 'O' ? 4 : 3;
  const y = t === 'I' ? -1 : 0;
  return { t, r: 0, x, y };
}

export type GarbageStyle = 'wall' | 'stair';
export interface Incoming { lines: number; style: GarbageStyle; age: number; id: number; }

export interface Handling { das: number; arr: number; sdf: number; }
export const HANDLING_PRESETS: Record<string, Handling> = {
  relaxed: { das: 190, arr: 50, sdf: 12 },
  normal: { das: 150, arr: 33, sdf: 20 },
  fast: { das: 110, arr: 16, sdf: 40 },
};

export interface Controls {
  left: boolean; right: boolean; soft: boolean; hard: boolean;
  cw: boolean; ccw: boolean; hold: boolean; super: boolean;
}
export const emptyControls = (): Controls => ({ left: false, right: false, soft: false, hard: false, cw: false, ccw: false, hold: false, super: false });

export type EngineEvent =
  | { k: 'move' } | { k: 'rotate'; spin: boolean } | { k: 'hold' } | { k: 'land' }
  | { k: 'lock'; cells: [number, number][]; t: PieceType; hard: number }
  | { k: 'clear'; rows: number[]; lines: number; spin: 'none' | 'mini' | 'full'; b2b: boolean; combo: number; pc: boolean; attack: number; t: PieceType }
  | { k: 'send'; lines: number; kind: AttackKind }
  | { k: 'cancel'; lines: number }
  | { k: 'garbageIn'; lines: number }
  | { k: 'incoming'; lines: number }
  | { k: 'super'; char: string }
  | { k: 'burst'; rows: number[]; cells: number }
  | { k: 'superReady' }
  | { k: 'ko' }
  | { k: 'spawn' };

export type AttackKind = 'jab' | 'kick' | 'heavy' | 'super';

// attack values
const BASE_ATK = [0, 0, 1, 2, 4];
const SPIN_ATK = [0, 2, 4, 6];
const MINI_ATK = [0, 0, 1];
const COMBO_ATK = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

export interface Stats {
  pieces: number; lines: number; attack: number; quads: number; spins: number;
  maxCombo: number; pcs: number; time: number; score: number; garbageCleared: number;
}

export interface Rules {
  garbageDelay: number; // ms before queued garbage can enter
  lockDelay: number; // ms
  maxLockResets: number;
  clearDelay: number; // ms
  superCost: number;
}
export const DEFAULT_RULES: Rules = { garbageDelay: 1100, lockDelay: 500, maxLockResets: 15, clearDelay: 220, superCost: 100 };

export class Board {
  grid = new Uint8Array(COLS * ROWS);
  /** per cell: garbage sender style tint (0 none, 1..n character index) */
  tint = new Uint8Array(COLS * ROWS);
  bag: Bag;
  cur: Active | null = null;
  hold: PieceType | null = null;
  canHold = true;
  alive = true;
  events: EngineEvent[] = [];
  incoming: Incoming[] = [];
  superMeter = 0;
  combo = -1;
  b2b = false;
  level = 1;
  stats: Stats = { pieces: 0, lines: 0, attack: 0, quads: 0, spins: 0, maxCombo: 0, pcs: 0, time: 0, score: 0, garbageCleared: 0 };
  rules: Rules;
  handling: Handling = HANDLING_PRESETS.normal;
  character: string;
  garbageStyle: GarbageStyle;
  /** pending clear animation */
  clearing: { rows: number[]; t: number; dur: number } | null = null;
  private holeRng: () => number;
  private holeCol = 0;
  private stairDir = 1;
  private gravAcc = 0;
  private lockT = 0;
  private lockResets = 0;
  private lowest = 0;
  private lastRotate = false;
  private lastKick = 0;
  private dasDir = 0;
  private dasT = 0;
  private arrT = 0;
  private prev: Controls = emptyControls();
  private incId = 0;
  /** sum of every garbage line this board has sent to the opponent this round */
  sentTotal = 0;
  onGround = false;
  frozen = false;

  constructor(seed: number, character: string, style: GarbageStyle, rules: Rules = DEFAULT_RULES, holeSeed = seed ^ 0x9e3779b9) {
    this.bag = new Bag(seed);
    this.character = character;
    this.garbageStyle = style;
    this.rules = rules;
    this.holeRng = mulberry32(holeSeed);
    this.holeCol = Math.floor(this.holeRng() * COLS);
  }

  queue(n = 5): PieceType[] { return this.bag.peek(n); }

  get gravityMs(): number {
    const l = Math.min(this.level, 15) - 1;
    return Math.max(16, Math.pow(0.8 - l * 0.007, l) * 1000);
  }

  start() { this.spawn(this.bag.next()); }

  private emit(e: EngineEvent) { this.events.push(e); }

  private spawn(t: PieceType): boolean {
    const p = spawnPos(t);
    if (collides(this.grid, p.t, p.r, p.x, p.y)) {
      // try one row higher
      if (!collides(this.grid, p.t, p.r, p.x, p.y - 1)) p.y -= 1;
      else { this.cur = p; this.topOut(); return false; }
    }
    // guideline: drop one row immediately if possible
    if (!collides(this.grid, p.t, p.r, p.x, p.y + 1)) p.y += 1;
    this.cur = p;
    this.gravAcc = 0; this.lockT = 0; this.lockResets = 0; this.lowest = p.y;
    this.lastRotate = false; this.onGround = false;
    this.emit({ k: 'spawn' });
    // Initial DAS carry: if a direction is held, shift immediately when charged
    return true;
  }

  topOut() {
    if (!this.alive) return;
    this.alive = false;
    this.emit({ k: 'ko' });
  }

  ghostY(): number { return this.cur ? dropY(this.grid, this.cur) : 0; }

  private tryMove(dx: number, dy: number): boolean {
    const p = this.cur!;
    if (collides(this.grid, p.t, p.r, p.x + dx, p.y + dy)) return false;
    p.x += dx; p.y += dy;
    if (dx !== 0) { this.lastRotate = false; this.resetLock(); }
    return true;
  }

  private resetLock() {
    if (!this.cur) return;
    if (collides(this.grid, this.cur.t, this.cur.r, this.cur.x, this.cur.y + 1) || this.onGround) {
      if (this.lockResets < this.rules.maxLockResets) { this.lockT = 0; this.lockResets++; }
    }
  }

  private tryRotate(dir: 1 | -1): boolean {
    const p = this.cur!;
    const to = (p.r + (dir === 1 ? 1 : 3)) % 4;
    const ks = kicks(p.t, p.r, to);
    for (let i = 0; i < ks.length; i++) {
      const [kx, ky] = ks[i];
      if (!collides(this.grid, p.t, to, p.x + kx, p.y + ky)) {
        p.x += kx; p.y += ky; p.r = to;
        this.lastRotate = true; this.lastKick = i;
        this.resetLock();
        const spin = p.t === 'T' && this.spinCheck() !== 'none';
        this.emit({ k: 'rotate', spin });
        return true;
      }
    }
    return false;
  }

  private filled(x: number, y: number): boolean {
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y < 0) return false;
    return this.grid[y * COLS + x] !== 0;
  }

  private spinCheck(): 'none' | 'mini' | 'full' {
    const p = this.cur!;
    if (p.t !== 'T' || !this.lastRotate) return 'none';
    const cx = p.x + 1, cy = p.y + 1;
    const corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx + 1, cy + 1], [cx - 1, cy + 1]];
    const occ = corners.map(([x, y]) => this.filled(x, y));
    const n = occ.filter(Boolean).length;
    if (n < 3) return 'none';
    // front corners depend on rotation
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.r];
    if ((occ[front[0]] && occ[front[1]]) || this.lastKick === 4) return 'full';
    return 'mini';
  }

  private doHold() {
    if (!this.canHold || !this.cur) return;
    const t = this.cur.t;
    const next = this.hold ?? this.bag.next();
    this.hold = t;
    this.canHold = false;
    this.emit({ k: 'hold' });
    this.spawn(next);
  }

  private hardDrop() {
    const p = this.cur!;
    const y = dropY(this.grid, p);
    const dist = y - p.y;
    if (dist > 0) this.lastRotate = false;
    p.y = y;
    this.stats.score += dist * 2;
    this.lock(dist + 1);
  }

  private lock(hard = 0) {
    const p = this.cur!;
    const spin = this.spinCheck();
    const cells: [number, number][] = [];
    let allHidden = true;
    for (const [cx, cy] of SHAPES[p.t][p.r]) {
      const x = p.x + cx, y = p.y + cy;
      if (y >= 0) { this.grid[y * COLS + x] = TYPE_ID[p.t]; this.tint[y * COLS + x] = 0; }
      if (y >= HIDDEN) allHidden = false;
      cells.push([x, y]);
    }
    this.cur = null;
    this.stats.pieces++;
    this.emit({ k: 'lock', cells, t: p.t, hard });
    // find full rows
    const rows: number[] = [];
    for (let y = 0; y < ROWS; y++) {
      let full = true;
      for (let x = 0; x < COLS; x++) if (!this.grid[y * COLS + x]) { full = false; break; }
      if (full) rows.push(y);
    }
    const lines = rows.length;
    if (lines > 0) {
      this.combo++;
      let atk = 0;
      const difficult = lines === 4 || (spin !== 'none' && lines > 0);
      if (spin === 'full') atk = SPIN_ATK[Math.min(lines, 3)];
      else if (spin === 'mini') atk = MINI_ATK[Math.min(lines, 2)];
      else atk = BASE_ATK[lines];
      const b2bHit = difficult && this.b2b;
      if (b2bHit) atk += 1;
      this.b2b = difficult ? true : false;
      atk += COMBO_ATK[Math.min(this.combo, COMBO_ATK.length - 1)];
      // count garbage cells cleared
      for (const y of rows) if (this.grid[y * COLS] === GARBAGE || this.grid[y * COLS + 1] === GARBAGE) this.stats.garbageCleared++;
      // check perfect clear
      let remaining = 0;
      for (let y = 0; y < ROWS; y++) if (!rows.includes(y)) for (let x = 0; x < COLS; x++) if (this.grid[y * COLS + x]) remaining++;
      const pc = remaining === 0;
      if (pc) { atk += 10; this.stats.pcs++; }
      // score
      const pts = spin === 'full' ? [400, 800, 1200, 1600][lines] : spin === 'mini' ? [100, 200, 400, 400][lines] : [0, 100, 300, 500, 800][lines];
      this.stats.score += Math.round(pts * (b2bHit ? 1.5 : 1) * this.level) + 50 * Math.max(0, this.combo) * this.level + (pc ? 3000 : 0);
      this.stats.lines += lines;
      if (lines === 4) this.stats.quads++;
      if (spin !== 'none') this.stats.spins++;
      this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
      this.emit({ k: 'clear', rows, lines, spin, b2b: b2bHit, combo: this.combo, pc, attack: atk, t: p.t });
      this.gainSuper(lines * 5 + atk * 9);
      if (atk > 0) this.attack(atk, lines === 4 || spin === 'full' || pc ? 'heavy' : lines >= 3 ? 'kick' : 'jab');
      this.clearing = { rows, t: 0, dur: this.rules.clearDelay + (lines === 4 ? 80 : 0) };
      return;
    }
    this.combo = -1;
    if (spin !== 'none') {
      // T-spin with no lines: small super gain
      this.gainSuper(4);
      this.emit({ k: 'clear', rows: [], lines: 0, spin, b2b: false, combo: -1, pc: false, attack: 0, t: p.t });
    }
    this.gainSuper(1);
    if (allHidden) { this.topOut(); return; }
    this.applyGarbage();
    if (!this.alive) return;
    this.spawnNext();
  }

  private gainSuper(n: number) {
    const before = this.superMeter;
    this.superMeter = Math.min(this.rules.superCost, this.superMeter + n);
    if (before < this.rules.superCost && this.superMeter >= this.rules.superCost) this.emit({ k: 'superReady' });
  }

  private spawnNext() {
    this.canHold = true;
    this.spawn(this.bag.next());
  }

  /** outgoing attack: cancel incoming first */
  attack(lines: number, kind: AttackKind) {
    let rem = lines;
    let cancelled = 0;
    while (rem > 0 && this.incoming.length) {
      const inc = this.incoming[0];
      const c = Math.min(inc.lines, rem);
      inc.lines -= c; rem -= c; cancelled += c;
      if (inc.lines <= 0) this.incoming.shift();
    }
    this.stats.attack += lines;
    if (cancelled) this.emit({ k: 'cancel', lines: cancelled });
    if (rem > 0) {
      this.sentTotal += rem;
      this.emit({ k: 'send', lines: rem, kind });
    }
  }

  receive(lines: number, style: GarbageStyle) {
    if (lines <= 0) return;
    this.incoming.push({ lines, style, age: 0, id: ++this.incId });
    this.emit({ k: 'incoming', lines });
  }

  get incomingTotal(): number { return this.incoming.reduce((s, i) => s + i.lines, 0); }

  private applyGarbage() {
    let cap = 8;
    let added = 0;
    while (cap > 0 && this.incoming.length && this.incoming[0].age >= this.rules.garbageDelay) {
      const inc = this.incoming[0];
      const n = Math.min(inc.lines, cap);
      this.addGarbageRows(n, inc.style);
      inc.lines -= n; cap -= n; added += n;
      if (inc.lines <= 0) this.incoming.shift();
    }
    if (added) this.emit({ k: 'garbageIn', lines: added });
  }

  private addGarbageRows(n: number, style: GarbageStyle) {
    // overflow check: anything pushed out of the top kills
    for (let y = 0; y < n; y++) for (let x = 0; x < COLS; x++) if (this.grid[y * COLS + x]) { this.alive && this.topOutLater(); }
    this.grid.copyWithin(0, n * COLS);
    this.tint.copyWithin(0, n * COLS);
    if (style === 'wall') {
      // one clean hole for the whole chunk, move it each attack
      let c = Math.floor(this.holeRng() * COLS);
      if (c === this.holeCol) c = (c + 1 + Math.floor(this.holeRng() * (COLS - 1))) % COLS;
      this.holeCol = c;
    }
    for (let i = 0; i < n; i++) {
      const y = ROWS - n + i;
      let hole = this.holeCol;
      if (style === 'stair') {
        this.holeCol += this.stairDir;
        if (this.holeCol >= COLS) { this.holeCol = COLS - 2; this.stairDir = -1; }
        if (this.holeCol < 0) { this.holeCol = 1; this.stairDir = 1; }
        hole = this.holeCol;
      }
      for (let x = 0; x < COLS; x++) {
        this.grid[y * COLS + x] = x === hole ? 0 : GARBAGE;
        this.tint[y * COLS + x] = style === 'wall' ? 1 : 2;
      }
    }
  }
  private pendingKo = false;
  private topOutLater() { this.pendingKo = true; }

  /** Super moves. Returns true if fired */
  private fireSuper(): boolean {
    if (this.superMeter < this.rules.superCost || !this.cur || this.clearing) return false;
    this.superMeter = 0;
    this.emit({ k: 'super', char: this.character });
    if (this.character === 'nong') {
      // Shadow Slam: wipe all incoming garbage, then hit for 4
      const wiped = this.incomingTotal;
      this.incoming = [];
      if (wiped) this.emit({ k: 'cancel', lines: wiped });
      this.stats.attack += 4;
      this.sentTotal += 4;
      this.emit({ k: 'send', lines: 4, kind: 'super' });
    } else {
      // Emerald Burst: blast away the bottom 4 rows of your own stack, hit for 2
      const n = 4;
      let cleared = 0;
      for (let y = ROWS - n; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (this.grid[y * COLS + x]) cleared++;
      this.grid.copyWithin(n * COLS, 0, (ROWS - n) * COLS);
      this.tint.copyWithin(n * COLS, 0, (ROWS - n) * COLS);
      this.grid.fill(0, 0, n * COLS);
      this.tint.fill(0, 0, n * COLS);
      this.emit({ k: 'burst', rows: [ROWS - 4, ROWS - 3, ROWS - 2, ROWS - 1], cells: cleared });
      this.attack(2, 'super');
      // keep piece valid
      if (this.cur && collides(this.grid, this.cur.t, this.cur.r, this.cur.x, this.cur.y)) {
        while (this.cur.y > -2 && collides(this.grid, this.cur.t, this.cur.r, this.cur.x, this.cur.y)) this.cur.y--;
      }
    }
    return true;
  }

  /** fixed step update */
  update(dt: number, c: Controls) {
    if (!this.alive || this.frozen) { this.prev = { ...c }; return; }
    this.stats.time += dt;
    for (const inc of this.incoming) inc.age += dt;
    const pressed = (k: keyof Controls) => c[k] && !this.prev[k];

    // DAS direction bookkeeping happens even while clearing (charge carries)
    let dir = 0;
    if (c.left && !c.right) dir = -1;
    else if (c.right && !c.left) dir = 1;
    else if (c.left && c.right) dir = pressed('left') ? -1 : pressed('right') ? 1 : this.dasDir;
    const newDir = dir !== this.dasDir;
    if (newDir) { this.dasDir = dir; this.dasT = 0; this.arrT = 0; }
    else if (dir) this.dasT += dt;

    if (this.clearing) {
      this.clearing.t += dt;
      if (this.clearing.t >= this.clearing.dur) {
        const rows = this.clearing.rows;
        this.clearing = null;
        this.removeRows(rows);
        if (this.pendingKo) { this.pendingKo = false; this.topOut(); }
        if (this.alive) this.spawnNext();
      }
      this.prev = { ...c };
      return;
    }
    if (this.pendingKo) { this.pendingKo = false; this.topOut(); this.prev = { ...c }; return; }
    if (!this.cur) { this.prev = { ...c }; return; }

    if (pressed('super')) this.fireSuper();
    if (pressed('hold')) this.doHold();
    if (!this.cur) { this.prev = { ...c }; return; }
    if (pressed('cw')) this.tryRotate(1);
    if (pressed('ccw')) this.tryRotate(-1);

    // horizontal
    if (dir && newDir) { if (this.tryMove(dir, 0)) this.emit({ k: 'move' }); }
    else if (dir && this.dasT >= this.handling.das) {
      if (this.handling.arr <= 0) { let m = false; while (this.tryMove(dir, 0)) m = true; if (m) this.emit({ k: 'move' }); }
      else {
        this.arrT += dt;
        while (this.arrT >= this.handling.arr) { this.arrT -= this.handling.arr; if (this.tryMove(dir, 0)) this.emit({ k: 'move' }); else break; }
      }
    }

    if (pressed('hard')) { this.hardDrop(); this.afterLockCheck(c); return; }

    // gravity
    const g = this.gravityMs;
    const rate = c.soft ? Math.min(g, g / this.handling.sdf, 50) : g;
    this.gravAcc += dt;
    while (this.gravAcc >= rate) {
      this.gravAcc -= rate;
      if (this.tryMove(0, 1)) {
        if (c.soft) this.stats.score += 1;
        this.lastRotate = false;
        if (this.cur!.y > this.lowest) { this.lowest = this.cur!.y; this.lockResets = 0; }
      } else { this.gravAcc = 0; break; }
    }
    const grounded = collides(this.grid, this.cur.t, this.cur.r, this.cur.x, this.cur.y + 1);
    if (grounded && !this.onGround) this.emit({ k: 'land' });
    this.onGround = grounded;
    if (grounded) {
      this.lockT += dt;
      if (this.lockT >= this.rules.lockDelay) this.lock(0);
    }
    this.prev = { ...c };
  }

  private afterLockCheck(c: Controls) { this.prev = { ...c }; }

  private removeRows(rows: number[]) {
    const sorted = [...rows].sort((a, b) => a - b);
    for (const y of sorted) {
      this.grid.copyWithin(COLS, 0, y * COLS);
      this.tint.copyWithin(COLS, 0, y * COLS);
      this.grid.fill(0, 0, COLS);
      this.tint.fill(0, 0, COLS);
    }
  }

  /** highest occupied visible row index (0 = top of visible area), 20 if empty */
  stackTop(): number {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (this.grid[y * COLS + x]) return y - HIDDEN;
    return ROWS - HIDDEN;
  }

  /** compact string for network sync */
  serialize(): string {
    let s = '';
    for (let i = 0; i < this.grid.length; i++) s += this.grid[i].toString(16);
    return s;
  }
}

export function decodeGrid(s: string, out: Uint8Array) {
  for (let i = 0; i < out.length; i++) out[i] = s ? parseInt(s[i] || '0', 16) || 0 : 0;
}
