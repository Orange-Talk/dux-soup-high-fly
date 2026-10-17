import { Board, Controls, emptyControls, EngineEvent, PieceType, COLS, ROWS, HIDDEN, Stats, DEFAULT_RULES, HANDLING_PRESETS, GarbageStyle, decodeGrid, ID_TYPE, Active, PIECES } from './engine';
import { CpuController, Difficulty } from './ai';
import { Fighter, FState } from './fighter';
import { FX } from './fx';
import { audio } from './audio';
import { art, CharId } from './assets';
import { CHARS, charColor } from './chars';
import { input, SourceId } from './input';
import { BoardFx, BoardView, drawBoard, W, H, BOARD_X, BOARD_Y, BW, BH, CELL, FONT_D, FONT_B, PCOL, cellToScreen, rrect, stackTopOf } from './render';
import { settings } from './settings';

export type SideKind = 'human' | 'cpu' | 'remote';
export interface SideCfg { kind: SideKind; src?: SourceId | 'solo'; diff?: Difficulty; char: CharId; alt: boolean; label: string; }

/** what an online opponent publishes */
export interface RemoteState {
  b: string; cur: number[] | null; h: number; q: string; inc: number[][]; sup: number;
  sc: number; ln: number; lv: number; al: boolean; sent: number;
  cl: number[]; ak: number[]; su: number; gi: number[]; cc: number; hd: number;
  stats?: Stats;
}

interface Projectile { from: 0 | 1; x: number; y: number; tx: number; ty: number; t: number; dur: number; kind: string; lines: number; color: string; }
interface PendingHit { sent: number; cancel: number; kind: FState; }

export interface RoundHooks {
  external: boolean;
  onLocalKo?: () => void;
  onRoundShown?: () => void;
}

class Side {
  board: Board | null = null;
  cpu: CpuController | null = null;
  fighter: Fighter;
  bfx = new BoardFx();
  wins = 0;
  pending: PendingHit | null = null;
  remote: RemoteState | null = null;
  remoteGrid = new Uint8Array(COLS * ROWS);
  remoteTint = new Uint8Array(COLS * ROWS);
  remoteApplied = 0; // garbage from this remote side already applied to our board
  lastRemote: RemoteState | null = null;
  heartbeat = 0;
  koShown = false;
  roundStats: Stats[] = [];
  constructor(public cfg: SideCfg, public idx: 0 | 1) {
    const home = idx === 0 ? 566 : 714;
    this.fighter = new Fighter(cfg.char, cfg.alt, idx, home, 652);
  }
  get color() { return charColor(this.cfg.char, this.cfg.alt); }
  get style(): GarbageStyle { return CHARS[this.cfg.char].style; }
  get alive(): boolean { return this.board ? this.board.alive : this.remote ? this.remote.al : true; }

  view(): BoardView {
    if (this.board) {
      const b = this.board;
      return {
        grid: b.grid, tint: b.tint, cur: b.cur, ghostY: b.cur ? b.ghostY() : null,
        hold: b.hold, canHold: b.canHold, queue: b.queue(5),
        incoming: b.incoming.map((i) => ({ lines: i.lines, ready: i.age >= b.rules.garbageDelay })),
        superMeter: b.superMeter, superCost: b.rules.superCost,
        clearingRows: b.clearing ? b.clearing.rows : null, clearProgress: b.clearing ? b.clearing.t / b.clearing.dur : 0,
        alive: b.alive, score: b.stats.score, lines: b.stats.lines, level: b.level, combo: b.combo, b2b: b.b2b,
      };
    }
    const r = this.remote;
    if (!r) {
      return { grid: this.remoteGrid, tint: this.remoteTint, cur: null, ghostY: null, hold: null, canHold: true, queue: [], incoming: [], superMeter: 0, superCost: 100, clearingRows: null, clearProgress: 0, alive: true, score: 0, lines: 0, level: 1, combo: -1, b2b: false };
    }
    const cur: Active | null = r.cur ? { t: ID_TYPE[r.cur[0]], r: r.cur[1], x: r.cur[2], y: r.cur[3] } : null;
    return {
      grid: this.remoteGrid, tint: this.remoteTint, cur, ghostY: null,
      hold: r.h ? ID_TYPE[r.h] : null, canHold: true, queue: r.q.split('').map((c) => ID_TYPE[+c]).filter(Boolean) as PieceType[],
      incoming: (r.inc || []).map(([l, rd]) => ({ lines: l, ready: !!rd })),
      superMeter: r.sup, superCost: 100, clearingRows: null, clearProgress: 0,
      alive: r.al, score: r.sc, lines: r.ln, level: r.lv, combo: -1, b2b: false,
    };
  }
}

export type Phase = 'intro' | 'fight' | 'play' | 'ko' | 'result' | 'waiting' | 'done';

export class Battle {
  sides: [Side, Side];
  fx = new FX();
  phase: Phase = 'waiting';
  phaseT = 0;
  round = 0;
  roundTime = 0;
  winsNeeded: number;
  projectiles: Projectile[] = [];
  paused = false;
  roundWinner: 0 | 1 | null | -1 = null;
  cutin: { side: 0 | 1; t: number } | null = null;
  time = 0;
  private acc = 0;
  private seed = 1;
  onMatchEnd: ((winner: 0 | 1, sides: Side[]) => void) | null = null;
  hooks: RoundHooks = { external: false };
  online = false;
  matchOver = false;
  koOrder: (0 | 1)[] = [];

  constructor(a: SideCfg, b: SideCfg, winsNeeded: number) {
    this.sides = [new Side(a, 0), new Side(b, 1)];
    this.winsNeeded = winsNeeded;
    for (const s of this.sides) s.fighter.onImpact = (k) => this.impact(s, k);
    this.fx.shakeOn = settings.shake;
    this.fx.reduced = settings.reducedFlash;
  }

  other(s: Side): Side { return this.sides[1 - s.idx]; }

  // ---------------- round flow
  beginRound(seed: number, round?: number) {
    this.seed = seed;
    this.round = round ?? this.round + 1;
    this.roundTime = 0;
    this.projectiles = [];
    this.cutin = null;
    this.koOrder = [];
    this.roundWinner = null;
    const rules = { ...DEFAULT_RULES, garbageDelay: settings.garbageDelay };
    for (const s of this.sides) {
      s.pending = null; s.koShown = false;
      s.bfx = new BoardFx();
      if (s.cfg.kind !== 'remote') {
        s.board = new Board(seed, s.cfg.char, s.style, rules, (seed * 31 + s.idx * 7919) >>> 0);
        s.board.handling = HANDLING_PRESETS[settings.handling] || HANDLING_PRESETS.normal;
        s.board.frozen = true;
        s.board.start();
        s.cpu = s.cfg.kind === 'cpu' ? new CpuController(s.cfg.diff || (this as any).autoDiff || 'normal') : null;
      } else {
        s.remoteApplied = 0;
        s.remote = null; s.lastRemote = null;
        s.remoteGrid.fill(0); s.remoteTint.fill(0);
      }
      s.fighter.flash = 0; s.fighter.dim = 0; s.fighter.danger = false;
      s.fighter.set('offscreen');
      s.fighter.state = 'offscreen';
      s.fighter.set('intro');
    }
    this.phase = 'intro'; this.phaseT = 0;
    audio.musicMode('battle');
    audio.musicRate(1);
    audio.play('round');
  }

  get isFinalRound() { return this.sides[0].wins === this.winsNeeded - 1 && this.sides[1].wins === this.winsNeeded - 1; }

  private startPlay() {
    for (const s of this.sides) if (s.board) s.board.frozen = false;
  }

  /** a board topped out */
  private ko(s: Side) {
    if (s.koShown) return;
    s.koShown = true;
    this.koOrder.push(s.idx);
    s.fighter.set('ko');
    s.bfx.koT = 0;
    this.fx.slow(0.35, 1.1);
    this.fx.shake(0.9);
    this.fx.stop(140);
    this.fx.doFlash(0.6, '#ffffff');
    audio.play('ko');
    audio.musicMode('ko');
    if (this.phase === 'play' || this.phase === 'fight') {
      this.phase = 'ko'; this.phaseT = 0;
      for (const x of this.sides) if (x.board) x.board.frozen = true;
    }
    if (s.cfg.kind !== 'remote') this.hooks.onLocalKo?.();
  }

  /** decide (auto mode) or apply (external) the round result */
  endRound(winner: 0 | 1 | -1) {
    this.roundWinner = winner;
    if (winner >= 0) {
      const w = this.sides[winner as 0 | 1];
      w.wins++;
      w.fighter.set('victory');
      audio.play('victory');
    }
    for (const s of this.sides) if (s.board) s.roundStats.push({ ...s.board.stats });
    this.phase = 'result'; this.phaseT = 0;
    this.matchOver = this.sides.some((s) => s.wins >= this.winsNeeded);
  }

  // ---------------- events
  private handleEvents(s: Side) {
    const b = s.board!;
    const evs = b.events; b.events = [];
    let clear: Extract<EngineEvent, { k: 'clear' }> | null = null;
    let sent = 0, cancel = 0, kind: string = 'jab', superFired = false;
    const human = s.cfg.kind === 'human';
    for (const e of evs) {
      switch (e.k) {
        case 'move': if (human) audio.play('move'); break;
        case 'rotate': if (human) audio.play(e.spin ? 'spinrot' : 'rotate'); break;
        case 'hold': if (human) audio.play('hold'); else audio.play('tick'); break;
        case 'land': if (human) audio.play('land'); break;
        case 'lock': {
          s.bfx.lockFlash = { cells: e.cells, t: 0 };
          if (e.hard > 0) {
            audio.play('hard');
            s.bfx.bump(Math.min(220, 60 + e.hard * 14));
            this.fx.shake(0.05 + Math.min(0.12, e.hard * 0.006));
            for (const [cx, cy] of e.cells) {
              if (cy < HIDDEN) continue;
              const [px, py] = cellToScreen(s.idx, cx, cy);
              for (let k = 0; k < 2; k++) this.fx.spawn({ x: px + (Math.random() - 0.5) * CELL, y: py, vx: 0, vy: -500 - Math.random() * 500, kind: 'streak', size: 3, max: 0.22, color: PCOL[({ I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 } as any)[e.t]] });
            }
            const bottomY = Math.max(...e.cells.map((c) => c[1]));
            const [dx, dy] = cellToScreen(s.idx, e.cells[0][0], bottomY);
            for (let k = 0; k < 8; k++) this.fx.spawn({ x: dx + (Math.random() - 0.5) * 80, y: dy + CELL / 2, vx: (Math.random() - 0.5) * 160, vy: -40 - Math.random() * 60, kind: 'smoke', size: 7, max: 0.5, color: '#9aa0c8', add: false, drag: 0.9 });
          } else audio.play('lock');
          break;
        }
        case 'clear': clear = e; break;
        case 'send': sent += e.lines; kind = e.kind; break;
        case 'cancel': cancel += e.lines; break;
        case 'incoming': if (s.cfg.kind === 'human') audio.play('warn'); break;
        case 'garbageIn': {
          audio.play('garbage');
          s.bfx.bump(-120 - e.lines * 20);
          s.bfx.rise = 1;
          this.fx.shake(0.12 + e.lines * 0.03);
          break;
        }
        case 'superReady': audio.play('superReady'); s.bfx.superFlash = 0.6; break;
        case 'super': superFired = true; break;
        case 'burst': {
          audio.play('burst');
          for (const y of e.rows) for (let x = 0; x < COLS; x++) {
            const [px, py] = cellToScreen(s.idx, x, y);
            this.fx.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 600, vy: -200 - Math.random() * 500, kind: 'shard', size: 9, max: 1, g: 1100, color: s.color, add: false });
          }
          s.bfx.bump(160);
          break;
        }
        case 'ko': this.ko(s); break;
      }
    }
    if (superFired) this.startSuper(s);
    if (clear) this.onClear(s, clear);
    // fighter reaction
    const atk = clear && clear.lines > 0;
    if (superFired) {
      s.pending = { sent, cancel, kind: 'super' };
    } else if (atk || sent || cancel) {
      const lines = clear ? clear.lines : 0;
      const heavy = kind === 'heavy' || (clear && (clear.lines === 4 || clear.spin === 'full' || clear.pc));
      const st: FState = heavy ? 'heavy' : lines >= 3 || sent >= 2 ? 'kick' : 'jab';
      s.pending = { sent, cancel, kind: st };
      s.fighter.set(st);
      if (st === 'heavy') audio.play('whoosh');
    }
  }

  private callout(s: Side, text: string, color: string, size = 30, sub?: string, big = false) {
    const x = BOARD_X[s.idx] + BW / 2;
    // stack below any callout still on screen for this board
    let y = BOARD_Y + BH * 0.3;
    const live = this.fx.texts.filter((t) => Math.abs(t.x - x) < 5 && t.life < t.max * 0.8);
    for (const t of live) y = Math.max(y, t.y + t.size * (t.sub ? 1.55 : 0.95) + 10);
    if (y > BOARD_Y + BH * 0.75) { for (const t of live) t.life = t.max; y = BOARD_Y + BH * 0.3; }
    this.fx.text(text, x, y, color, size, big, sub);
  }

  private onClear(s: Side, e: Extract<EngineEvent, { k: 'clear' }>) {
    const b = s.board!;
    // sounds
    if (e.lines === 4) audio.play('quad');
    else if (e.spin !== 'none' && e.lines > 0) audio.play('tspin');
    else if (e.lines > 0) audio.play(('clear' + Math.min(3, e.lines)) as any);
    if (e.combo > 0) audio.play('combo', e.combo);
    if (e.b2b) audio.play('b2b');
    if (e.pc) audio.play('pc');
    // particles for each cleared cell
    for (const y of e.rows) for (let x = 0; x < COLS; x++) {
      const id = b.grid[y * COLS + x];
      const [px, py] = cellToScreen(s.idx, x, y);
      const col = PCOL[id] || '#fff';
      const dir = (x - 4.5) / 4.5;
      this.fx.spawn({ x: px, y: py, vx: dir * 380 + (Math.random() - 0.5) * 200, vy: -150 - Math.random() * 380, kind: 'shard', size: 6 + Math.random() * 5, max: 0.9, g: 1300, color: col, add: false, vr: (Math.random() - 0.5) * 20 });
      if (Math.random() < 0.6) this.fx.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 500, vy: (Math.random() - 0.5) * 300, kind: 'spark', size: 3, max: 0.5, color: '#fff' });
    }
    // callouts
    const names = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD!'];
    let label = '';
    let color = '#ffffff';
    if (e.spin === 'full') { label = 'T-SPIN' + (e.lines ? ' ' + names[e.lines].replace('!', '') : ''); color = '#d48bff'; }
    else if (e.spin === 'mini') { label = 'MINI T-SPIN'; color = '#c79bff'; }
    else if (e.lines === 4) { label = 'QUAD!'; color = '#5fe3ff'; }
    else if (e.lines >= 2) { label = names[e.lines]; color = e.lines === 3 ? '#ffd74a' : '#ffffff'; }
    let sub: string | undefined;
    if (e.combo > 0) sub = e.combo + 1 + ' COMBO';
    if (e.b2b) sub = (sub ? sub + '  ' : '') + 'BACK-TO-BACK';
    if (e.pc) this.callout(s, 'ALL CLEAR', '#ffffff', 40, label ? label + (sub ? '  ' + sub : '') : sub, true);
    else if (label) this.callout(s, label, color, e.lines === 4 || e.spin === 'full' ? 38 : 30, sub, e.lines === 4);
    else if (sub) this.callout(s, sub, '#ffe27a', 24);
    // juice
    const big = e.lines === 4 || e.spin === 'full' || e.pc;
    if (big) {
      this.fx.shake(0.45); this.fx.stop(90); this.fx.doFlash(0.25, s.color);
      const [cx] = cellToScreen(s.idx, 4.5, 0);
      const cy = BOARD_Y + (e.rows.reduce((a, r) => a + r, 0) / Math.max(1, e.rows.length) - HIDDEN) * CELL + CELL / 2;
      this.fx.ring(cx, cy, s.color, 220, 0.5);
      this.fx.ring(cx, cy, '#ffffff', 140, 0.35);
    } else if (e.lines > 0) this.fx.shake(0.06 * e.lines);
    s.bfx.bump(40 + e.lines * 25);
  }

  private startSuper(s: Side) {
    this.cutin = { side: s.idx, t: 0 };
    s.fighter.set('super');
    s.bfx.superFlash = 1;
    audio.play('super');
    this.fx.doFlash(0.35, s.color);
    this.fx.shake(0.3);
  }

  /** attacker's strike frame reached */
  private impact(s: Side, k: FState) {
    const p = s.pending; s.pending = null;
    const o = this.other(s);
    if (!p) return;
    const [sx, sy] = s.fighter.strikePoint;
    if (k === 'heavy' || k === 'super') {
      // projectile
      const [tx, ty] = o.fighter.bodyPoint;
      this.projectiles.push({ from: s.idx, x: sx, y: sy, tx, ty, t: 0, dur: k === 'super' ? 0.32 : 0.26, kind: k, lines: p.sent, color: s.color });
      audio.play('whoosh');
      if (p.cancel && !p.sent) this.counter(s, p.cancel);
      return;
    }
    if (p.sent > 0) this.hit(o, p.sent, false, s.color);
    else if (p.cancel > 0) this.counter(s, p.cancel);
    else {
      // whiff: little air puff at the fist
      this.fx.burst(sx, sy, 5, '#ffffff', 120, 'spark', 2, 0.25);
    }
  }

  private counter(s: Side, lines: number) {
    const o = this.other(s);
    const mx = (s.fighter.x + o.fighter.x) / 2, my = s.fighter.y - 150;
    this.fx.burst(mx, my, 18, '#fff6c4', 380, 'spark', 3, 0.4);
    this.fx.ring(mx, my, '#fff6c4', 70, 0.3);
    this.fx.text('COUNTER', mx, my - 40, '#fff6c4', 22);
    audio.play('cancel');
    o.fighter.set('block');
    setTimeout(() => { if (o.fighter.state === 'block') o.fighter.set('idle'); }, 240);
  }

  private hit(o: Side, lines: number, heavy: boolean, color: string) {
    const [hx, hy] = o.fighter.bodyPoint;
    o.fighter.set('hurt');
    audio.play(heavy || lines >= 4 ? 'heavyhit' : 'hit');
    this.fx.stop(heavy ? 110 : 55);
    this.fx.shake(heavy ? 0.5 : 0.15 + lines * 0.05);
    this.fx.burst(hx, hy, heavy ? 40 : 16 + lines * 4, color, heavy ? 520 : 320, 'spark', 3.5, 0.5);
    this.fx.burst(hx, hy, heavy ? 10 : 4, '#ffffff', 200, 'star', 9, 0.35);
    this.fx.spawn({ x: hx, y: hy, kind: 'ring', size: heavy ? 120 : 60, max: 0.3, color: '#ffffff' });
    this.burstImg.push({ x: hx, y: hy, t: 0, s: heavy ? 1.1 : 0.55 + lines * 0.08 });
    this.fx.text('-' + lines, hx, hy - 90, '#ff6b7f', heavy ? 34 : 24);
  }
  private burstImg: { x: number; y: number; t: number; s: number }[] = [];

  // ---------------- remote sync
  applyRemote(r: RemoteState) {
    const s = this.sides.find((x) => x.cfg.kind === 'remote');
    if (!s) return;
    const prev = s.remote;
    s.remote = r;
    // grid: values 0..7, 8 = wall garbage, 9 = stair garbage
    for (let i = 0; i < s.remoteGrid.length; i++) {
      const v = parseInt(r.b[i] || '0', 16) || 0;
      s.remoteGrid[i] = v >= 8 ? 8 : v;
      s.remoteTint[i] = v === 9 ? 2 : v === 8 ? 1 : 0;
    }
    if (this.phase !== 'play' && this.phase !== 'ko' && this.phase !== 'fight') return;
    // garbage they sent us
    const me = this.other(s);
    if (me.board && r.sent > s.remoteApplied) {
      const n = r.sent - s.remoteApplied;
      s.remoteApplied = r.sent;
      me.board.receive(n, s.style);
    }
    if (!prev) return;
    // effects from their side
    if (r.cl && (!prev.cl || r.cl[0] !== prev.cl[0])) {
      const [, lines, spin, pc] = r.cl;
      if (lines === 4 || spin) audio.play(lines === 4 ? 'quad' : 'tspin'); else if (lines > 0) audio.play(('clear' + Math.min(3, lines)) as any);
      const names = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD!'];
      if (spin) this.callout(s, 'T-SPIN', '#d48bff', 32);
      else if (lines >= 2) this.callout(s, names[lines], lines === 4 ? '#5fe3ff' : '#fff', lines === 4 ? 38 : 30);
      if (pc) this.callout(s, 'ALL CLEAR', '#fff', 40);
      s.bfx.bump(40 + lines * 25);
      if (lines === 4) this.fx.shake(0.3);
    }
    if (r.ak && (!prev.ak || r.ak[0] !== prev.ak[0])) {
      const [, lines, kindIdx, sent, cancel] = r.ak;
      const st: FState = (['jab', 'kick', 'heavy', 'super'] as FState[])[kindIdx] || 'jab';
      if (st !== 'super') { s.pending = { sent, cancel, kind: st }; s.fighter.set(st); if (st === 'heavy') audio.play('whoosh'); }
      void lines;
    }
    if (r.su !== prev.su) { this.startSuper(s); s.pending = { sent: r.ak ? r.ak[3] : 4, cancel: 0, kind: 'super' }; }
    if (r.gi && (!prev.gi || r.gi[0] !== prev.gi[0])) { audio.play('garbage'); s.bfx.bump(-140); s.bfx.rise = 1; }
    if (r.hd !== prev.hd) { s.bfx.bump(90); }
    if (!r.al && prev.al) this.ko(s);
  }

  /** what we publish about our local board (online) */
  localState(): RemoteState | null {
    const s = this.sides.find((x) => x.cfg.kind !== 'remote');
    if (!s || !s.board) return null;
    const b = s.board;
    let g = '';
    for (let i = 0; i < b.grid.length; i++) { const v = b.grid[i]; g += v === 8 ? (b.tint[i] === 2 ? '9' : '8') : String(v); }
    const typeIdx = (t: PieceType) => PIECES.indexOf(t) + 1;
    return {
      b: g, cur: b.cur ? [typeIdx(b.cur.t), b.cur.r, b.cur.x, b.cur.y] : null, h: b.hold ? typeIdx(b.hold) : 0,
      q: b.queue(5).map(typeIdx).join(''), inc: b.incoming.map((i) => [i.lines, i.age >= b.rules.garbageDelay ? 1 : 0]).slice(0, 6),
      sup: Math.round(b.superMeter), sc: b.stats.score, ln: b.stats.lines, lv: b.level, al: b.alive, sent: b.sentTotal,
      cl: this.netCl, ak: this.netAk, su: this.netSu, gi: this.netGi, cc: 0, hd: this.netHd, stats: b.stats,
    };
  }
  private netCl: number[] = [0, 0, 0, 0];
  private netAk: number[] = [0, 0, 0, 0, 0];
  private netSu = 0;
  private netGi: number[] = [0, 0];
  private netHd = 0;
  private trackNet(s: Side) {
    if (!this.online || s.cfg.kind === 'remote' || !s.board) return;
    for (const e of s.board.events) {
      if (e.k === 'clear' && e.lines > 0) this.netCl = [this.netCl[0] + 1, e.lines, e.spin === 'full' ? 1 : 0, e.pc ? 1 : 0];
      if (e.k === 'send') this.netAk = [this.netAk[0] + 1, 0, ['jab', 'kick', 'heavy', 'super'].indexOf(e.kind), e.lines, 0];
      if (e.k === 'super') this.netSu++;
      if (e.k === 'garbageIn') this.netGi = [this.netGi[0] + 1, e.lines];
      if (e.k === 'lock' && e.hard) this.netHd++;
    }
  }

  // ---------------- update
  update(dtReal: number) {
    if (this.paused) return;
    this.time += dtReal / 1000;
    const dtVis = dtReal * this.fx.slowmo;
    this.fx.update(dtVis);
    if (this.fx.hitstop > 0) { this.fx.hitstop -= dtReal; } else {
      for (const s of this.sides) { s.fighter.update(dtVis); s.bfx.update(dtVis); }
    }
    this.phaseT += dtReal / 1000;
    for (const b of this.burstImg) b.t += dtVis / 1000;
    this.burstImg = this.burstImg.filter((b) => b.t < 0.35);
    if (this.cutin) { this.cutin.t += dtReal / 1000; if (this.cutin.t > 1.2) this.cutin = null; }

    // projectiles
    for (const p of this.projectiles) {
      p.t += dtVis / 1000;
      const k = Math.min(1, p.t / p.dur);
      if (Math.random() < 0.9) this.fx.spawn({ x: p.x + (p.tx - p.x) * k, y: p.y + (p.ty - p.y) * k + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, kind: 'spark', size: 3, max: 0.3, color: p.color });
      if (k >= 1) {
        const o = this.sides[1 - p.from];
        if (p.lines > 0) this.hit(o, p.lines, true, p.color);
        else { this.fx.burst(p.tx, p.ty, 20, '#fff6c4', 300); audio.play('cancel'); }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);

    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 1.7) { this.phase = 'fight'; this.phaseT = 0; audio.play('fight'); }
        break;
      case 'fight':
        if (this.phaseT > 0.3 && this.sides.some((s) => s.board && s.board.frozen)) this.startPlay();
        if (this.phaseT > 0.9) { this.phase = 'play'; this.phaseT = 0; }
        break;
      case 'ko':
        if (!this.hooks.external && this.phaseT > 2.4 && this.roundWinner === null) {
          const losers = this.koOrder;
          const winner: 0 | 1 | -1 = losers.length >= 2 ? -1 : losers[0] === 0 ? 1 : 0;
          this.endRound(winner);
        }
        break;
      case 'result':
        if (!this.hooks.external && this.phaseT > 2.6) {
          if (this.matchOver) {
            this.phase = 'done';
            const w = this.sides[0].wins > this.sides[1].wins ? 0 : 1;
            this.onMatchEnd?.(w, this.sides);
          } else this.beginRound((this.seed * 1103515245 + 12345) >>> 0);
        }
        break;
    }

    // engine steps (fixed 120hz)
    if (this.phase === 'play' || this.phase === 'fight' || this.phase === 'ko') {
      this.acc += dtReal;
      const step = 1000 / 120;
      let n = 0;
      while (this.acc >= step && n < 12) {
        this.acc -= step; n++;
        if (this.phase === 'play' || this.phase === 'fight') this.roundTime += step / 1000;
        const lvl = Math.min(15, 1 + Math.floor(this.roundTime / settings.speedUpEvery));
        for (const s of this.sides) {
          if (!s.board) continue;
          s.board.level = lvl;
          let c: Controls = emptyControls();
          if (s.cfg.kind === 'human' && !this.paused) c = input.controlsFor(s.cfg.src || 'solo');
          else if (s.cfg.kind === 'cpu') c = s.cpu!.update(s.board, step);
          s.board.update(step, c);
          if (s.board.events.length) {
            this.trackNet(s);
            // route garbage between local boards
            for (const e of s.board.events) if (e.k === 'send') { const o = this.other(s); if (o.board && o.cfg.kind !== 'remote') o.board.receive(e.lines, s.style); }
            this.handleEvents(s);
          }
        }
      }
      if (this.acc > 200) this.acc = 0;
    }
    // danger heartbeat + fighter danger
    for (const s of this.sides) {
      const v = s.view();
      const top = stackTopOf(v.grid);
      s.fighter.danger = this.phase === 'play' && v.alive && top < 6;
      if (s.fighter.danger && s.cfg.kind === 'human') {
        s.heartbeat -= dtReal / 1000;
        if (s.heartbeat <= 0) { audio.play('heartbeat'); s.heartbeat = 0.85; }
      }
    }
    const maxLv = this.sides.reduce((m, s) => Math.max(m, s.board ? s.board.level : s.remote ? s.remote.lv : 1), 1);
    if (this.phase === 'play') audio.musicRate(maxLv >= 7 ? 1.06 : 1);
  }

  // ---------------- draw
  draw(ctx: CanvasRenderingContext2D, drawBg: (ctx: CanvasRenderingContext2D, t: number, dark: number) => void) {
    const [shx, shy] = this.fx.shakeOffset(this.time * 1000);
    ctx.save();
    ctx.translate(shx, shy);
    drawBg(ctx, this.time, 0.42);
    // stage spotlight
    const sp = ctx.createRadialGradient(640, 610, 20, 640, 560, 330);
    sp.addColorStop(0, 'rgba(255,230,190,0.16)'); sp.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = sp; ctx.fillRect(400, 300, 480, 420);

    for (const s of this.sides) {
      drawBoard(ctx, s.view(), s.bfx, { side: s.idx, color: s.color, time: this.time, ghost: settings.ghost, name: s.cfg.label, showDanger: true });
    }
    // fighters (draw the attacker on top)
    const order = [...this.sides].sort((a, b) => (a.fighter.state === 'idle' ? 0 : 1) - (b.fighter.state === 'idle' ? 0 : 1));
    for (const s of order) s.fighter.draw(ctx, this.time, s.color);
    // impact bursts
    for (const b of this.burstImg) {
      const k = b.t / 0.35;
      const sz = 170 * b.s * (0.6 + k * 0.6);
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.globalCompositeOperation = 'lighter';
      ctx.translate(b.x, b.y); ctx.rotate(k * 0.6);
      ctx.drawImage(art.burst, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    // projectiles
    for (const p of this.projectiles) {
      const k = Math.min(1, p.t / p.dur);
      const x = p.x + (p.tx - p.x) * k, y = p.y + (p.ty - p.y) * k;
      const dir = p.tx > p.x ? 1 : -1;
      const sz = p.kind === 'super' ? 190 : 140;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-dir, 1); // art faces left
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(art.strike, -sz * 0.5, -sz * 0.36, sz, sz * 0.71);
      ctx.restore();
    }
    this.fx.draw(ctx, FONT_D);
    ctx.restore();

    this.drawHud(ctx);
    if (this.cutin) this.drawCutin(ctx);
    this.drawBanner(ctx);
    if (this.fx.flash > 0.01) {
      ctx.fillStyle = this.fx.flashColor; ctx.globalAlpha = this.fx.flash * 0.5;
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    for (const s of this.sides) {
      const left = s.idx === 0;
      const x0 = left ? 18 : W - 18;
      const dir = left ? 1 : -1;
      const info = CHARS[s.cfg.char];
      // portrait medallion
      const mx = x0 + dir * 44, my = 58;
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, 38, 0, 6.283);
      ctx.fillStyle = 'rgba(8,8,24,0.9)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = s.color; ctx.stroke();
      ctx.clip();
      const ch = art.chars[s.cfg.char];
      const p = s.cfg.alt ? ch.portraitAlt : ch.portrait;
      const pw = 150, ph = (p.height / p.width) * pw;
      ctx.save();
      ctx.translate(mx, 0); if (!left) ctx.scale(-1, 1);
      ctx.drawImage(p, -pw / 2, my - 32, pw, ph);
      ctx.restore();
      ctx.restore();
      // name plate
      ctx.save();
      const nx = x0 + dir * 92;
      ctx.textAlign = left ? 'left' : 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `30px ${FONT_D}`;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(5,5,18,0.85)'; ctx.lineJoin = 'round';
      ctx.strokeText(info.name, nx, 56); ctx.fillStyle = '#fff'; ctx.fillText(info.name, nx, 56);
      ctx.font = `700 13px ${FONT_B}`;
      ctx.fillStyle = s.color;
      const tag = s.cfg.label;
      ctx.strokeText(tag, nx, 78); ctx.fillText(tag, nx, 78);
      // win pips
      for (let i = 0; i < this.winsNeeded; i++) {
        const px = nx + dir * (10 + i * 26), py = 98;
        ctx.beginPath();
        ctx.moveTo(px, py - 9); ctx.lineTo(px + 9, py); ctx.lineTo(px, py + 9); ctx.lineTo(px - 9, py); ctx.closePath();
        const won = i < s.wins;
        ctx.fillStyle = won ? s.color : 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = won ? '#fff' : 'rgba(255,255,255,0.3)'; ctx.stroke();
      }
      ctx.restore();
    }
    // center: round + clock
    ctx.save();
    ctx.textAlign = 'center';
    rrect(ctx, 560, 16, 160, 74, 14);
    ctx.fillStyle = 'rgba(8,8,26,0.82)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = `600 12px ${FONT_B}`; ctx.fillStyle = 'rgba(220,220,255,0.7)';
    ctx.fillText(this.isFinalRound ? 'FINAL ROUND' : 'ROUND ' + Math.max(1, this.round), 640, 38);
    const t = Math.floor(this.roundTime);
    ctx.font = `30px ${FONT_D}`; ctx.fillStyle = '#fff';
    ctx.fillText(Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'), 640, 74);
    ctx.restore();
  }

  private drawCutin(ctx: CanvasRenderingContext2D) {
    const c = this.cutin!;
    const s = this.sides[c.side];
    const t = c.t;
    const inK = Math.min(1, t / 0.16), outK = t > 0.95 ? (t - 0.95) / 0.25 : 0;
    const a = Math.max(0, 1 - outK);
    ctx.save();
    ctx.globalAlpha = a;
    // darken stage behind the band
    ctx.fillStyle = 'rgba(0,0,10,0.45)';
    ctx.fillRect(400, 130, 480, 560);
    // diagonal band
    const bandY = 300, bandH = 150;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(400, bandY + 30); ctx.lineTo(880, bandY - 30); ctx.lineTo(880, bandY + bandH - 30); ctx.lineTo(400, bandY + bandH + 30); ctx.closePath();
    ctx.clip();
    const bg = ctx.createLinearGradient(400, 0, 880, 0);
    bg.addColorStop(0, s.color); bg.addColorStop(1, '#0b0b22');
    ctx.fillStyle = bg; ctx.fillRect(400, bandY - 40, 480, bandH + 80);
    // speed lines
    ctx.globalAlpha = a * 0.35; ctx.fillStyle = '#fff';
    for (let i = 0; i < 14; i++) { const ly = bandY - 30 + ((i * 37 + t * 900) % (bandH + 60)); ctx.fillRect(400, ly, 480, 2); }
    ctx.globalAlpha = a;
    // portrait slides in
    const ch = art.chars[s.cfg.char];
    const p = s.cfg.alt ? ch.portraitAlt : ch.portrait;
    const ph = 360, pw = (p.width / p.height) * ph;
    const dir = c.side === 0 ? 1 : -1;
    const px = 640 - dir * 120 + (1 - inK) * -dir * 300 + t * dir * 30;
    ctx.save(); ctx.translate(px, bandY - 20); if (dir < 0) ctx.scale(-1, 1);
    ctx.drawImage(p, -pw / 2, 0, pw, ph);
    ctx.restore();
    ctx.restore();
    // super name
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `40px ${FONT_D}`;
    const tx = 640 + dir * 60 + (1 - inK) * dir * 200;
    ctx.lineWidth = 8; ctx.strokeStyle = '#06061a'; ctx.lineJoin = 'round';
    ctx.strokeText(CHARS[s.cfg.char].superName.split(' ')[0], tx, bandY + 45);
    ctx.fillStyle = '#fff'; ctx.fillText(CHARS[s.cfg.char].superName.split(' ')[0], tx, bandY + 45);
    ctx.strokeText(CHARS[s.cfg.char].superName.split(' ')[1] || '', tx, bandY + 90);
    ctx.fillStyle = s.color; ctx.fillText(CHARS[s.cfg.char].superName.split(' ')[1] || '', tx, bandY + 90);
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const ph = this.phase, t = this.phaseT;
    const slam = (text: string, color: string, k: number, size: number, sub?: string) => {
      const s = k < 0.18 ? 2.4 - (k / 0.18) * 1.4 : 1;
      ctx.save();
      ctx.translate(640, 380);
      // band
      const bw = Math.min(1, k / 0.15) * 1280;
      const bgr = ctx.createLinearGradient(-640, 0, 640, 0);
      bgr.addColorStop(0, 'rgba(0,0,0,0)'); bgr.addColorStop(0.3, 'rgba(5,5,20,0.75)'); bgr.addColorStop(0.7, 'rgba(5,5,20,0.75)'); bgr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bgr; ctx.fillRect(-bw / 2, -size * 0.75, bw, size * 1.5 + (sub ? 30 : 0));
      ctx.scale(s, s);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${size}px ${FONT_D}`;
      ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#05051a';
      ctx.strokeText(text, 0, 0);
      const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, color); g.addColorStop(1, '#ff8a3d');
      ctx.fillStyle = g; ctx.fillText(text, 0, 0);
      if (sub) { ctx.font = `600 20px ${FONT_B}`; ctx.fillStyle = '#e8e8ff'; ctx.fillText(sub, 0, size * 0.75); }
      ctx.restore();
    };
    if (ph === 'intro' && t > 0.5) slam(this.isFinalRound ? 'FINAL ROUND' : 'ROUND ' + this.round, '#ffe066', t - 0.5, 76);
    if (ph === 'fight') slam('FIGHT!', '#ff5a3c', t, 104);
    if (ph === 'ko' && t < 2.4) slam('K.O.', '#ff3355', t, 130);
    if (ph === 'result') {
      if (this.roundWinner === -1) slam('DRAW', '#ffffff', t, 96);
      else if (this.roundWinner !== null) {
        const w = this.sides[this.roundWinner];
        slam(CHARS[w.cfg.char].name + ' WINS', w.color, t, 80, this.matchOver ? 'MATCH POINT TAKEN' : undefined);
      }
    }
    if (ph === 'waiting') {
      ctx.save(); ctx.textAlign = 'center'; ctx.font = `600 20px ${FONT_B}`; ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Waiting for opponent…', 640, 380); ctx.restore();
    }
  }
}

export type { Side };
