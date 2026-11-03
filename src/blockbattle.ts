// Block puzzle versus (and solo endless). Mirrors the Battle API so menus, results and online
// play treat both game types the same way.
import { BlockBoard, BShape, N, STONE, SHAPE_BY_KEY } from './blockengine';
import { BlockCpu } from './blockai';
import { Battle, SideCfg, RemoteState } from './battle';
import { Fighter, FState } from './fighter';
import { FX } from './fx';
import { audio } from './audio';
import { art } from './assets';
import { CHARS, charColor } from './chars';
import { input } from './input';
import { Controls, emptyControls } from './engine';
import { block, W, H, FONT_D, FONT_B, PCOL, rrect } from './render';
import { settings } from './settings';

const BP = Battle.prototype as any;

interface Layout { gx: number; gy: number; cell: number; tray: { x: number; y: number; w: number; h: number }[]; trayCell: number; meterX: number; superY: number; }

function duelLayout(side: 0 | 1): Layout {
  const cell = 50, size = cell * N;
  const gx = side === 0 ? 36 : W - 36 - size, gy = 120;
  const tray = [0, 1, 2].map((i) => ({ x: gx + i * (size / 3), y: 548, w: size / 3, h: 164 }));
  return { gx, gy, cell, tray, trayCell: 24, meterX: side === 0 ? gx + size + 8 : gx - 16, superY: gy + size + 8 };
}
function focusLayout(): Layout {
  const cell = 62, size = cell * N, gx = 40, gy = 132;
  const tray = [0, 1, 2].map((i) => ({ x: gx + size + 22, y: gy + i * 164, w: 190, h: 160 }));
  return { gx, gy, cell, tray, trayCell: 30, meterX: gx + size + 6, superY: gy + size + 8 };
}
function miniLayout(): Layout {
  const cell = 27, size = cell * N, gx = W - 40 - size, gy = 132;
  return { gx, gy, cell, tray: [], trayCell: 0, meterX: gx - 14, superY: gy + size + 8 };
}
function soloLayout(): Layout {
  const cell = 62, size = cell * N;
  const gx = 392, gy = 152;
  const tray = [0, 1, 2].map((i) => ({ x: 940, y: 150 + i * 166, w: 290, h: 158 }));
  return { gx, gy, cell, tray, trayCell: 32, meterX: -999, superY: -999 };
}

class BFx {
  bump = 0; vBump = 0; superFlash = 0; koT = -1; shake = 0;
  pops: { x: number; y: number; t: number; color: number }[] = [];
  glow: { rows: number[]; cols: number[]; t: number } | null = null;
  update(dt: number) {
    const s = dt / 1000;
    this.vBump += (-this.bump * 260 - this.vBump * 18) * s;
    this.bump += this.vBump * s;
    this.superFlash = Math.max(0, this.superFlash - s * 1.5);
    this.shake *= Math.pow(0.002, s);
    if (this.koT >= 0) this.koT += s;
    for (const p of this.pops) p.t += s;
    this.pops = this.pops.filter((p) => p.t < 0.35);
    if (this.glow) { this.glow.t += s; if (this.glow.t > 0.45) this.glow = null; }
  }
}

interface Drag { slot: number; px: number; py: number; touch: boolean; side: number; }
interface Cursor { slot: number; x: number; y: number; active: boolean; held: Record<string, number>; prev: Controls; }

class BSide {
  board: BlockBoard | null = null;
  cpu: BlockCpu | null = null;
  fighter: Fighter;
  bfx = new BFx();
  wins = 0;
  pending: { sent: number; cancel: number; kind: FState } | null = null;
  remote: RemoteState | null = null;
  remoteGrid = new Uint8Array(N * N);
  remoteApplied = 0;
  roundStats: any[] = [];
  koShown = false;
  cursor: Cursor = { slot: 0, x: 2, y: 2, active: false, held: {}, prev: emptyControls() };
  cpuAnim: { slot: number; x: number; y: number; t: number } | null = null;
  layout: Layout;
  heartbeat = 0;
  constructor(public cfg: SideCfg, public idx: 0 | 1, solo: boolean, focus = false) {
    this.layout = solo ? soloLayout() : focus ? (idx === 0 ? focusLayout() : miniLayout()) : duelLayout(idx);
    const home = solo ? 196 : focus ? (idx === 0 ? 846 : 986) : idx === 0 ? 566 : 714;
    this.fighter = new Fighter(cfg.char, cfg.alt, idx, home, 652);
    if (solo) this.fighter.scale = 1.25;
  }
  get color() { return charColor(this.cfg.char, this.cfg.alt); }
  get alive(): boolean { return this.board ? this.board.alive : this.remote ? this.remote.al : true; }
  get grid(): Uint8Array { return this.board ? this.board.grid : this.remoteGrid; }
}

export class BlockBattle {
  sides: BSide[];
  fx = new FX();
  phase: 'intro' | 'fight' | 'play' | 'ko' | 'result' | 'waiting' | 'done' = 'waiting';
  phaseT = 0;
  round = 0;
  roundTime = 0;
  winsNeeded: number;
  projectiles: any[] = [];
  burstImg: { x: number; y: number; t: number; s: number }[] = [];
  paused = false;
  roundWinner: 0 | 1 | null | -1 = null;
  cutin: { side: 0 | 1; t: number } | null = null;
  time = 0;
  seed = 1;
  onMatchEnd: ((winner: 0 | 1, sides: any[]) => void) | null = null;
  onSoloOver: ((score: number, stats: any) => void) | null = null;
  hooks: { external: boolean } = { external: false };
  online = false;
  matchOver = false;
  koOrder: number[] = [];
  solo: boolean;
  drag: Drag | null = null;
  best = 0;
  private suddenT = 0;

  constructor(a: SideCfg, b: SideCfg | null, winsNeeded: number, opts: { focus?: boolean } = {}) {
    this.solo = !b;
    this.sides = [new BSide(a, 0, this.solo, !!opts.focus)];
    if (b) this.sides.push(new BSide(b, 1, false, !!opts.focus));
    this.winsNeeded = winsNeeded;
    for (const s of this.sides) s.fighter.onImpact = (k) => this.impact(s, k);
    this.fx.shakeOn = settings.shake;
    this.fx.reduced = settings.reducedFlash;
  }

  other(s: BSide): BSide { return this.sides[1 - s.idx] || s; }
  get isFinalRound() { return !this.solo && this.sides[0].wins === this.winsNeeded - 1 && this.sides[1].wins === this.winsNeeded - 1; }

  // ------------------------------------------------------------ round flow
  beginRound(seed: number, round?: number) {
    this.seed = seed;
    this.round = round ?? this.round + 1;
    this.roundTime = 0; this.suddenT = 0;
    this.projectiles = []; this.cutin = null; this.koOrder = []; this.roundWinner = null; this.drag = null;
    for (const s of this.sides) {
      s.pending = null; s.koShown = false; s.bfx = new BFx(); s.cpuAnim = null;
      if (s.cfg.kind !== 'remote') {
        s.board = new BlockBoard((seed * 31 + s.idx * 7919) >>> 0, s.cfg.char, !this.solo);
        s.board.rules.garbageDelay = Math.max(1100, settings.garbageDelay + 500);
        s.board.frozen = true;
        s.board.start();
        s.cpu = s.cfg.kind === 'cpu' ? new BlockCpu(s.cfg.diff || 'normal') : null;
      } else { s.remoteApplied = 0; s.remote = null; s.remoteGrid.fill(0); }
      s.cursor.slot = 0; s.cursor.x = 2; s.cursor.y = 2;
      s.fighter.flash = 0; s.fighter.dim = 0; s.fighter.danger = false;
      s.fighter.set('offscreen'); s.fighter.state = 'offscreen'; s.fighter.set('intro');
    }
    this.phase = 'intro'; this.phaseT = 0;
    audio.musicMode('battle'); audio.musicRate(1);
    audio.play('round');
  }

  private ko(s: BSide) {
    if (s.koShown) return;
    s.koShown = true;
    this.koOrder.push(s.idx);
    s.fighter.set('ko');
    s.bfx.koT = 0;
    this.fx.slow(0.4, 1.0); this.fx.shake(0.8); this.fx.stop(140); this.fx.doFlash(0.5, '#ffffff');
    audio.play('ko'); audio.musicMode('ko');
    this.drag = null;
    if (this.phase === 'play' || this.phase === 'fight') {
      this.phase = 'ko'; this.phaseT = 0;
      for (const x of this.sides) if (x.board) x.board.frozen = true;
    }
  }

  endRound(winner: 0 | 1 | -1) {
    this.roundWinner = winner;
    if (winner >= 0) { const w = this.sides[winner as 0 | 1]; w.wins++; w.fighter.set('victory'); audio.play('victory'); }
    for (const s of this.sides) if (s.board) s.roundStats.push({ ...s.board.stats });
    this.phase = 'result'; this.phaseT = 0;
    this.matchOver = this.sides.some((s) => s.wins >= this.winsNeeded);
  }

  // ------------------------------------------------------------ input
  private gridCell(s: BSide, lx: number, ly: number, shape: BShape, touch: boolean): [number, number, number, number] {
    const L = s.layout, c = L.cell;
    const lift = touch ? c * 1.6 : 0;
    const left = lx - (shape.w * c) / 2, top = ly - (shape.h * c) / 2 - lift;
    return [Math.round((left - L.gx) / c), Math.round((top - L.gy) / c), left, top];
  }
  private mySide(): BSide | null {
    // pointer always drives the first local human
    return this.sides.find((s) => s.cfg.kind === 'human' && s.board) || null;
  }
  pointerDown(x: number, y: number, touch: boolean) {
    const s = this.mySide();
    if (!s || !s.board || this.phase !== 'play' && this.phase !== 'fight') return;
    const L = s.layout;
    // super bar tap
    if (!this.solo && y >= L.superY - 6 && y <= L.superY + 24 && x >= L.gx && x <= L.gx + L.cell * N) { s.board.fireSuper(); this.flushEvents(s); return; }
    L.tray.forEach((t, i) => {
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h && s.board!.tray[i]) {
        this.drag = { slot: i, px: x, py: y, touch, side: s.idx };
        s.cursor.active = false;
        audio.play('hold');
      }
    });
  }
  pointerMove(x: number, y: number) { if (this.drag) { this.drag.px = x; this.drag.py = y; } }
  pointerUp(x: number, y: number) {
    const d = this.drag; this.drag = null;
    if (!d) return;
    const s = this.sides[d.side];
    const sh = s.board && s.board.tray[d.slot];
    if (!s.board || !sh) return;
    const [cx, cy] = this.gridCell(s, x, y, sh, d.touch);
    if (s.board.place(d.slot, cx, cy)) this.flushEvents(s);
    else audio.play('menuBack');
  }

  private keyInput(s: BSide, dt: number) {
    const b = s.board!;
    const c = input.controlsFor(s.cfg.src || 'solo');
    const cur = s.cursor;
    const fire = (k: keyof Controls) => {
      const on = c[k];
      if (!on) { delete cur.held[k]; return false; }
      const h = cur.held[k];
      if (h === undefined) { cur.held[k] = 0; return true; }
      const nh = h + dt; cur.held[k] = nh;
      const rep = k === 'left' || k === 'right' || k === 'soft' || k === 'cw';
      return rep && nh > 200 && Math.floor((nh - 200) / 75) !== Math.floor((h - 200) / 75);
    };
    let any = false;
    if (fire('left')) { cur.x--; any = true; }
    if (fire('right')) { cur.x++; any = true; }
    if (fire('cw')) { cur.y--; any = true; }
    if (fire('soft')) { cur.y++; any = true; }
    if (fire('ccw') || fire('hold')) { this.nextSlot(s, 1); any = true; audio.play('menuMove'); }
    if (fire('super')) { b.fireSuper(); any = true; }
    if (fire('hard')) {
      any = true;
      const sh = b.tray[cur.slot];
      if (sh && b.place(cur.slot, cur.x, cur.y)) { if (!b.tray[cur.slot]) this.nextSlot(s, 1); }
      else audio.play('menuBack');
    }
    if (any) {
      cur.active = true;
      if (!b.tray[cur.slot]) this.nextSlot(s, 1);
      const sh = b.tray[cur.slot];
      if (sh) { cur.x = Math.max(0, Math.min(N - sh.w, cur.x)); cur.y = Math.max(0, Math.min(N - sh.h, cur.y)); }
      if (s.board!.events.length) this.flushEvents(s);
    }
  }
  private nextSlot(s: BSide, d: number) {
    const b = s.board!;
    for (let i = 1; i <= 3; i++) { const j = (s.cursor.slot + d * i + 3) % 3; if (b.tray[j]) { s.cursor.slot = j; return; } }
  }

  // ------------------------------------------------------------ events
  private flushEvents(s: BSide) {
    if (!s.board || !s.board.events.length) return;
    this.trackNet(s);
    for (const e of s.board.events) if (e.k === 'send') { const o = this.other(s); if (o !== s && o.board && o.cfg.kind !== 'remote') o.board.receive(e.lines); }
    this.handleEvents(s);
  }

  private cellXY(s: BSide, x: number, y: number): [number, number] { const L = s.layout; return [L.gx + (x + 0.5) * L.cell, L.gy + (y + 0.5) * L.cell]; }

  private handleEvents(s: BSide) {
    const b = s.board!;
    const evs = b.events; b.events = [];
    let clear: any = null, sent = 0, cancel = 0, kind = 'jab', superFired = false;
    const human = s.cfg.kind === 'human';
    for (const e of evs) {
      switch (e.k) {
        case 'place':
          audio.play(human ? 'lock' : 'tick');
          for (const [x, y] of e.cells) s.bfx.pops.push({ x, y, t: 0, color: e.color });
          s.bfx.bump += 0; s.bfx.vBump += 60;
          break;
        case 'clear': clear = e; break;
        case 'send': sent += e.lines; kind = e.kind; break;
        case 'cancel': cancel += e.lines; break;
        case 'incoming': if (human) audio.play('warn'); break;
        case 'garbageIn':
          audio.play('garbage'); s.bfx.vBump -= 160; s.bfx.shake = 8;
          for (const [x, y] of e.cells) { const [px, py] = this.cellXY(s, x, y); this.fx.burst(px, py, 6, '#9aa3c0', 160, 'spark', 2.5, 0.35); s.bfx.pops.push({ x, y, t: 0, color: STONE }); }
          this.fx.shake(0.15 + e.lines * 0.02);
          break;
        case 'superReady': audio.play('superReady'); s.bfx.superFlash = 0.6; break;
        case 'super': superFired = true; break;
        case 'burst':
          audio.play('burst');
          for (const [x, y] of e.cells) { const [px, py] = this.cellXY(s, x, y); this.fx.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 600, vy: -200 - Math.random() * 500, kind: 'shard', size: 10, max: 1, g: 1100, color: s.color, add: false }); }
          break;
        case 'deal': if (human) audio.play('tick'); break;
        case 'ko': this.ko(s); break;
      }
    }
    if (superFired) { BP.startSuper.call(this, s); }
    if (clear) this.onClear(s, clear);
    if (this.solo) {
      if (clear) s.fighter.set(clear.lines >= 3 ? 'heavy' : clear.lines >= 2 || clear.combo >= 3 ? 'kick' : 'jab');
      return;
    }
    if (superFired) s.pending = { sent, cancel, kind: 'super' };
    else if ((clear && clear.lines > 0) || sent || cancel) {
      const st: FState = kind === 'heavy' ? 'heavy' : kind === 'kick' ? 'kick' : 'jab';
      s.pending = { sent, cancel, kind: st };
      s.fighter.set(st);
      if (st === 'heavy') audio.play('whoosh');
    }
  }

  private callout(s: BSide, text: string, color: string, size = 30, sub?: string, big = false) {
    const L = s.layout;
    const x = L.gx + (L.cell * N) / 2;
    let y = L.gy + L.cell * N * 0.32;
    const live = this.fx.texts.filter((t) => Math.abs(t.x - x) < 5 && t.life < t.max * 0.8);
    for (const t of live) y = Math.max(y, t.y + t.size * (t.sub ? 1.55 : 0.95) + 10);
    if (y > L.gy + L.cell * N * 0.8) { for (const t of live) t.life = t.max; y = L.gy + L.cell * N * 0.32; }
    this.fx.text(text, x, y, color, size, big, sub);
  }

  private onClear(s: BSide, e: any) {
    const lines = e.lines;
    if (lines >= 4) audio.play('quad'); else audio.play(('clear' + Math.min(3, lines)) as any);
    if (e.combo > 1) audio.play('combo', e.combo - 1);
    s.bfx.glow = { rows: e.rows, cols: e.cols, t: 0 };
    for (const [x, y, v] of e.cells) {
      const [px, py] = this.cellXY(s, x, y);
      const col = PCOL[v] || '#fff';
      for (let k = 0; k < 2; k++) this.fx.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 520, vy: -120 - Math.random() * 420, kind: 'shard', size: 6 + Math.random() * 6, max: 0.9, g: 1300, color: col, add: false, vr: (Math.random() - 0.5) * 20 });
      if (Math.random() < 0.5) this.fx.spawn({ x: px, y: py, vx: (Math.random() - 0.5) * 400, vy: (Math.random() - 0.5) * 300, kind: 'spark', size: 3, max: 0.5, color: '#fff' });
    }
    const names = ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'PENTA!', 'INSANE!'];
    const praise = ['', 'GOOD', 'GREAT', 'AMAZING', 'UNREAL', 'LEGENDARY'];
    const sub = e.combo > 1 ? 'COMBO x' + e.combo : undefined;
    if (lines >= 2) this.callout(s, names[Math.min(6, lines)], lines >= 4 ? '#5fe3ff' : lines === 3 ? '#ffd74a' : '#fff', lines >= 3 ? 40 : 32, sub, lines >= 3);
    else if (e.combo > 1) this.callout(s, praise[Math.min(5, e.combo - 1)] || 'NICE', '#ffe27a', 30, sub);
    if (this.solo) this.fx.text('+' + e.score, s.layout.gx + s.layout.cell * N / 2 + 200, 62, '#ffcf4a', 26);
    const big = lines >= 3;
    if (big) { this.fx.shake(0.4); this.fx.stop(80); this.fx.doFlash(0.2, s.color); }
    else this.fx.shake(0.08 * lines);
    s.bfx.vBump += 80 + lines * 30;
  }

  private impact(s: BSide, k: FState) { BP.impact.call(this, s, k); }
  private hit(o: BSide, lines: number, heavy: boolean, color: string) { BP.hit.call(this, o, lines, heavy, color); }
  private counter(s: BSide, lines: number) { BP.counter.call(this, s, lines); }

  // ------------------------------------------------------------ online
  applyRemote(r: RemoteState) {
    const s = this.sides.find((x) => x.cfg.kind === 'remote');
    if (!s) return;
    const prev = s.remote;
    s.remote = r;
    for (let i = 0; i < N * N; i++) s.remoteGrid[i] = parseInt(r.b[i] || '0', 16) || 0;
    if (this.phase !== 'play' && this.phase !== 'ko' && this.phase !== 'fight') return;
    const me = this.other(s);
    if (me.board && r.sent > s.remoteApplied) { const n = r.sent - s.remoteApplied; s.remoteApplied = r.sent; me.board.receive(n); this.flushEvents(me); }
    if (!prev) return;
    if (r.cl && (!prev.cl || r.cl[0] !== prev.cl[0])) {
      const lines = r.cl[1];
      if (lines >= 4) audio.play('quad'); else if (lines > 0) audio.play(('clear' + Math.min(3, lines)) as any);
      if (lines >= 2) this.callout(s, ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!', 'PENTA!', 'INSANE!'][Math.min(6, lines)], '#fff', 30);
      s.bfx.vBump += 80;
    }
    if (r.ak && (!prev.ak || r.ak[0] !== prev.ak[0])) {
      const st: FState = (['jab', 'kick', 'heavy', 'super'] as FState[])[r.ak[2]] || 'jab';
      if (st !== 'super') { s.pending = { sent: r.ak[3], cancel: r.ak[4] || 0, kind: st }; s.fighter.set(st); if (st === 'heavy') audio.play('whoosh'); }
    }
    if (r.su !== prev.su) { BP.startSuper.call(this, s); s.pending = { sent: r.ak ? r.ak[3] : 4, cancel: 0, kind: 'super' }; }
    if (r.gi && (!prev.gi || r.gi[0] !== prev.gi[0])) { audio.play('garbage'); s.bfx.vBump -= 140; }
    if (!r.al && prev.al) this.ko(s);
  }
  private netCl = [0, 0, 0, 0];
  private netAk = [0, 0, 0, 0, 0];
  private netSu = 0;
  private netGi = [0, 0];
  private trackNet(s: BSide) {
    if (!this.online || s.cfg.kind === 'remote' || !s.board) return;
    for (const e of s.board.events) {
      if (e.k === 'clear') this.netCl = [this.netCl[0] + 1, e.lines, 0, 0];
      if (e.k === 'send') this.netAk = [this.netAk[0] + 1, 0, ['jab', 'kick', 'heavy', 'super'].indexOf(e.kind), e.lines, 0];
      if (e.k === 'super') this.netSu++;
      if (e.k === 'garbageIn') this.netGi = [this.netGi[0] + 1, e.lines];
    }
  }
  localState(): RemoteState | null {
    const s = this.sides.find((x) => x.cfg.kind !== 'remote');
    if (!s || !s.board) return null;
    const b = s.board;
    let g = '';
    for (let i = 0; i < N * N; i++) g += b.grid[i].toString(16);
    return {
      b: g, cur: null, h: 0, q: '', inc: b.incoming.map((i) => [i.lines, i.age >= b.rules.garbageDelay ? 1 : 0]).slice(0, 6),
      sup: Math.round(b.superMeter), sc: b.stats.score, ln: b.stats.lines, lv: 1, al: b.alive, sent: b.sentTotal,
      cl: this.netCl, ak: this.netAk, su: this.netSu, gi: this.netGi, cc: 0, hd: 0, stats: b.stats as any,
    };
  }

  // ------------------------------------------------------------ update
  update(dtReal: number) {
    if (this.paused) return;
    this.time += dtReal / 1000;
    const dtVis = dtReal * this.fx.slowmo;
    this.fx.update(dtVis);
    if (this.fx.hitstop > 0) this.fx.hitstop -= dtReal;
    else for (const s of this.sides) { s.fighter.update(dtVis); s.bfx.update(dtVis); }
    this.phaseT += dtReal / 1000;
    for (const b of this.burstImg) b.t += dtVis / 1000;
    this.burstImg = this.burstImg.filter((b) => b.t < 0.35);
    if (this.cutin) { this.cutin.t += dtReal / 1000; if (this.cutin.t > 1.2) this.cutin = null; }
    for (const p of this.projectiles) {
      p.t += dtVis / 1000;
      const k = Math.min(1, p.t / p.dur);
      if (Math.random() < 0.9) this.fx.spawn({ x: p.x + (p.tx - p.x) * k, y: p.y + (p.ty - p.y) * k + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, kind: 'spark', size: 3, max: 0.3, color: p.color });
      if (k >= 1) { const o = this.sides[1 - p.from]; if (o) { if (p.lines > 0) this.hit(o, p.lines, true, p.color); else { this.fx.burst(p.tx, p.ty, 20, '#fff6c4', 300); audio.play('cancel'); } } }
    }
    this.projectiles = this.projectiles.filter((p) => p.t < p.dur);

    switch (this.phase) {
      case 'intro': if (this.phaseT > (this.solo ? 1.2 : 1.7)) { this.phase = 'fight'; this.phaseT = 0; audio.play('fight'); } break;
      case 'fight':
        if (this.phaseT > 0.3) for (const s of this.sides) if (s.board) s.board.frozen = false;
        if (this.phaseT > 0.9) { this.phase = 'play'; this.phaseT = 0; }
        break;
      case 'ko':
        if (this.solo && this.phaseT > 1.6 && this.roundWinner === null) {
          this.roundWinner = -1; this.phase = 'done';
          const b = this.sides[0].board!;
          this.onSoloOver?.(b.stats.score, b.stats);
        } else if (!this.solo && !this.hooks.external && this.phaseT > 2.4 && this.roundWinner === null) {
          const w: 0 | 1 | -1 = this.koOrder.length >= 2 ? -1 : this.koOrder[0] === 0 ? 1 : 0;
          this.endRound(w);
        }
        break;
      case 'result':
        if (!this.hooks.external && this.phaseT > 2.6) {
          if (this.matchOver) { this.phase = 'done'; this.onMatchEnd?.(this.sides[0].wins > this.sides[1].wins ? 0 : 1, this.sides); }
          else this.beginRound((this.seed * 1103515245 + 12345) >>> 0);
        }
        break;
    }

    if (this.phase === 'play' || this.phase === 'fight') {
      this.roundTime += dtReal / 1000;
      // sudden death: after 2 minutes a stone drops on both grids every 8 seconds
      if (!this.solo && this.roundTime > 120) {
        this.suddenT -= dtReal;
        if (this.suddenT <= 0) {
          this.suddenT = 8000;
          if (this.roundTime < 121) this.fx.text('SUDDEN DEATH', 640, 300, '#ff5a6e', 40, true);
          for (const s of this.sides) if (s.board) s.board.receive(1);
        }
      }
      for (const s of this.sides) {
        const b = s.board;
        if (!b) continue;
        b.update(dtReal);
        if (s.cfg.kind === 'human' && !b.frozen) this.keyInput(s, dtReal);
        if (s.cpu && !b.frozen) {
          if (s.cpuAnim) {
            s.cpuAnim.t += dtReal / 1000;
            if (s.cpuAnim.t >= 0.32) { const a = s.cpuAnim; s.cpuAnim = null; b.place(a.slot, a.x, a.y); }
          } else {
            const m = s.cpu.update(b, dtReal);
            if (m) s.cpuAnim = { slot: m.slot, x: m.x, y: m.y, t: 0 };
          }
        }
        if (b.events.length) this.flushEvents(s);
      }
    }
    for (const s of this.sides) {
      const fill = s.board ? s.board.fillRatio() : 0;
      s.fighter.danger = this.phase === 'play' && s.alive && fill > 0.72;
      if (s.fighter.danger && s.cfg.kind === 'human') { s.heartbeat -= dtReal / 1000; if (s.heartbeat <= 0) { audio.play('heartbeat'); s.heartbeat = 0.9; } }
    }
  }

  // ------------------------------------------------------------ draw
  draw(ctx: CanvasRenderingContext2D, drawBg: (ctx: CanvasRenderingContext2D, t: number, dark: number) => void) {
    const [shx, shy] = this.fx.shakeOffset(this.time * 1000);
    ctx.save();
    ctx.translate(shx, shy);
    drawBg(ctx, this.time, 0.42);
    const sp = ctx.createRadialGradient(this.solo ? 196 : 640, 610, 20, this.solo ? 196 : 640, 560, 330);
    sp.addColorStop(0, 'rgba(255,230,190,0.16)'); sp.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = sp; ctx.fillRect(0, 300, W, 420);
    for (const s of this.sides) this.drawGrid(ctx, s);
    const order = [...this.sides].sort((a, b) => (a.fighter.state === 'idle' ? 0 : 1) - (b.fighter.state === 'idle' ? 0 : 1));
    for (const s of order) s.fighter.draw(ctx, this.time, s.color);
    for (const b of this.burstImg) {
      const k = b.t / 0.35, sz = 170 * b.s * (0.6 + k * 0.6);
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.globalCompositeOperation = 'lighter';
      ctx.translate(b.x, b.y); ctx.rotate(k * 0.6); ctx.drawImage(art.burst, -sz / 2, -sz / 2, sz, sz); ctx.restore();
    }
    for (const p of this.projectiles) {
      const k = Math.min(1, p.t / p.dur);
      const x = p.x + (p.tx - p.x) * k, y = p.y + (p.ty - p.y) * k;
      const dir = p.tx > p.x ? 1 : -1, sz = p.kind === 'super' ? 190 : 140;
      ctx.save(); ctx.translate(x, y); ctx.scale(-dir, 1); ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(art.strike, -sz * 0.5, -sz * 0.36, sz, sz * 0.71); ctx.restore();
    }
    this.drawDrag(ctx);
    this.fx.draw(ctx, FONT_D);
    ctx.restore();
    if (this.solo) this.drawSoloHud(ctx);
    else BP.drawHud.call(this, ctx);
    if (this.cutin) BP.drawCutin.call(this, ctx);
    if (!this.solo) BP.drawBanner.call(this, ctx);
    else this.drawSoloBanner(ctx);
    if (this.fx.flash > 0.01) { ctx.fillStyle = this.fx.flashColor; ctx.globalAlpha = this.fx.flash * 0.5; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  private drawShape(ctx: CanvasRenderingContext2D, sh: BShape, x: number, y: number, cell: number, alpha = 1, variant = 0) {
    const img = block(sh.color, cell, variant);
    ctx.globalAlpha = alpha;
    for (const [cx, cy] of sh.cells) ctx.drawImage(img, x + cx * cell, y + cy * cell, cell, cell);
    ctx.globalAlpha = 1;
  }

  private drawGrid(ctx: CanvasRenderingContext2D, s: BSide) {
    const L = s.layout, c = L.cell, size = c * N;
    const gx = L.gx + (Math.random() - 0.5) * s.bfx.shake, gy = L.gy + s.bfx.bump * 0.05;
    const fill = s.board ? s.board.fillRatio() : 0;
    const danger = this.phase === 'play' && s.alive && fill > 0.72;
    const pulse = danger ? 0.5 + 0.5 * Math.sin(this.time * 9) : 0;
    // frame
    ctx.save();
    ctx.shadowColor = danger ? `rgba(255,40,60,${0.5 + pulse * 0.4})` : s.color; ctx.shadowBlur = 26;
    rrect(ctx, gx - 8, gy - 8, size + 16, size + 16, 14); ctx.fillStyle = 'rgba(6,7,20,0.92)'; ctx.fill();
    ctx.restore();
    ctx.save();
    rrect(ctx, gx - 8, gy - 8, size + 16, size + 16, 14);
    const fg = ctx.createLinearGradient(gx, gy, gx + size, gy + size);
    const fc = danger ? '#ff3b55' : s.color;
    fg.addColorStop(0, fc); fg.addColorStop(0.5, 'rgba(255,255,255,0.25)'); fg.addColorStop(1, fc);
    ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    // cells
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const px = gx + x * c, py = gy + y * c;
      ctx.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)';
      ctx.fillRect(px + 1, py + 1, c - 2, c - 2);
    }
    const grid = s.grid;
    const dead = s.bfx.koT >= 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = grid[y * N + x];
      if (!v) continue;
      let sz = c;
      const pop = s.bfx.pops.find((p) => p.x === x && p.y === y);
      if (pop) sz = c * (0.6 + 0.4 * Math.min(1, pop.t / 0.18)) + (pop.t < 0.18 ? 0 : Math.sin(Math.min(1, (pop.t - 0.18) / 0.17) * Math.PI) * 4);
      const img = block(v === STONE ? 8 : v, c, dead && y * N + x < s.bfx.koT * 50 ? 8 : v === STONE ? 1 : 0);
      ctx.drawImage(img, gx + x * c + (c - sz) / 2, gy + y * c + (c - sz) / 2, sz, sz);
    }
    // line clear glow
    if (s.bfx.glow) {
      const a = 1 - s.bfx.glow.t / 0.45;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${a * 0.6})`;
      for (const r of s.bfx.glow.rows) ctx.fillRect(gx, gy + r * c, size, c);
      for (const cc of s.bfx.glow.cols) ctx.fillRect(gx + cc * c, gy, c, size);
      ctx.restore();
    }
    // drag / keyboard preview on this grid
    const b = s.board;
    if (b && this.drag && this.drag.side === s.idx) {
      const sh = b.tray[this.drag.slot];
      if (sh) {
        const [cx, cy] = this.gridCell(s, this.drag.px, this.drag.py, sh, this.drag.touch);
        if (b.canPlace(sh, cx, cy)) this.preview(ctx, s, sh, cx, cy, gx, gy);
      }
    } else if (b && s.cursor.active && s.cfg.kind === 'human') {
      const sh = b.tray[s.cursor.slot];
      if (sh) {
        const ok = b.canPlace(sh, s.cursor.x, s.cursor.y);
        if (ok) this.preview(ctx, s, sh, s.cursor.x, s.cursor.y, gx, gy);
        else { this.drawShape(ctx, sh, gx + s.cursor.x * c, gy + s.cursor.y * c, c, 0.35, 8); }
        ctx.strokeStyle = ok ? '#ffffff' : '#ff5a6e'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(gx + s.cursor.x * c + 1, gy + s.cursor.y * c + 1, sh.w * c - 2, sh.h * c - 2); ctx.setLineDash([]);
      }
    }
    // cpu piece flying in
    if (b && s.cpuAnim) {
      const sh = b.tray[s.cpuAnim.slot];
      if (sh) {
        const t = s.cpuAnim.t / 0.32, e = 1 - Math.pow(1 - Math.min(1, t), 3);
        const tr = L.tray[s.cpuAnim.slot] || { x: L.gx + c * N / 2, y: L.gy + c * N + 40, w: 0, h: 0 };
        const fx0 = tr.x + tr.w / 2 - (sh.w * L.trayCell) / 2, fy0 = tr.y + tr.h / 2 - (sh.h * L.trayCell) / 2;
        const tx = gx + s.cpuAnim.x * c, ty = gy + s.cpuAnim.y * c;
        const cs = (L.trayCell || c) + (c - (L.trayCell || c)) * e;
        this.drawShape(ctx, sh, fx0 + (tx - fx0) * e, fy0 + (ty - fy0) * e, cs, 0.95);
      }
    }
    // tray
    if (b) {
      L.tray.forEach((t, i) => {
        ctx.save();
        rrect(ctx, t.x + 6, t.y + 6, t.w - 12, t.h - 12, 12);
        ctx.fillStyle = 'rgba(10,10,30,0.7)'; ctx.fill();
        const sel = s.cursor.active && s.cursor.slot === i && s.cfg.kind === 'human';
        ctx.strokeStyle = sel ? s.color : 'rgba(255,255,255,0.12)'; ctx.lineWidth = sel ? 2.5 : 1.5; ctx.stroke();
        ctx.restore();
        const sh = b.tray[i];
        if (!sh || (this.drag && this.drag.side === s.idx && this.drag.slot === i) || (s.cpuAnim && s.cpuAnim.slot === i)) return;
        const tc = L.trayCell;
        const fits = b.fits(sh);
        this.drawShape(ctx, sh, t.x + t.w / 2 - (sh.w * tc) / 2, t.y + t.h / 2 - (sh.h * tc) / 2, tc, fits ? 1 : 0.35, fits ? 0 : 8);
      });
    }
    if (this.solo) return;
    // incoming meter
    const mh = size;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; rrect(ctx, L.meterX, gy, 8, mh, 4); ctx.fill();
    const inc = b ? b.incoming.map((i) => ({ lines: i.lines, ready: i.age >= b.rules.garbageDelay })) : (s.remote?.inc || []).map(([l, r]) => ({ lines: l, ready: !!r }));
    let tot = 0;
    for (const i of inc) {
      const h = Math.min(i.lines, 16 - tot) * (mh / 16);
      if (h <= 0) break;
      const y0 = gy + mh - tot * (mh / 16) - h;
      ctx.fillStyle = i.ready ? `rgba(255,50,70,${0.6 + 0.4 * Math.sin(this.time * 18)})` : 'rgba(255,170,60,0.95)';
      rrect(ctx, L.meterX + 1, y0 + 1, 6, h - 2, 3); ctx.fill();
      tot += i.lines;
    }
    if (tot) { ctx.save(); ctx.font = `14px ${FONT_D}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ff5a6e'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; const ty = gy + mh - Math.min(tot, 16) * (mh / 16) - 10; ctx.strokeText(String(tot), L.meterX + 4, ty); ctx.fillText(String(tot), L.meterX + 4, ty); ctx.restore(); }
    // super bar (tap it to fire)
    const sm = b ? b.superMeter / b.rules.superCost : (s.remote?.sup || 0) / 100;
    const full = sm >= 1;
    ctx.save();
    rrect(ctx, gx, L.superY, size, 18, 9); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
    ctx.strokeStyle = full ? s.color : 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (sm > 0) { ctx.save(); rrect(ctx, gx + 2, L.superY + 2, (size - 4) * Math.min(1, sm), 14, 7); ctx.clip(); ctx.fillStyle = full ? '#fff' : s.color; ctx.fillRect(gx, L.superY, size, 18); ctx.restore(); }
    ctx.font = `11px ${FONT_D}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = full ? '#0b0b1c' : 'rgba(255,255,255,0.75)';
    ctx.fillText(full ? (s.cfg.kind === 'human' ? 'SUPER READY · TAP' : 'SUPER READY') : 'SUPER', gx + size / 2, L.superY + 9.5);
    ctx.restore();
  }

  private preview(ctx: CanvasRenderingContext2D, s: BSide, sh: BShape, cx: number, cy: number, gx: number, gy: number) {
    const c = s.layout.cell, b = s.board!;
    const { rows, cols } = b.previewClears(sh, cx, cy);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (const r of rows) ctx.fillRect(gx, gy + r * c, c * N, c);
    for (const k of cols) ctx.fillRect(gx + k * c, gy, c, c * N);
    ctx.restore();
    this.drawShape(ctx, sh, gx + cx * c, gy + cy * c, c, 0.45);
    if (rows.length || cols.length) {
      // the blocks that would vanish glow in the piece's color
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = PCOL[sh.color]; ctx.lineWidth = 3;
      for (const r of rows) ctx.strokeRect(gx + 2, gy + r * c + 2, c * N - 4, c - 4);
      for (const k of cols) ctx.strokeRect(gx + k * c + 2, gy + 2, c - 4, c * N - 4);
      ctx.restore();
    }
  }

  private drawDrag(ctx: CanvasRenderingContext2D) {
    const d = this.drag;
    if (!d) return;
    const s = this.sides[d.side];
    const sh = s.board && s.board.tray[d.slot];
    if (!sh) return;
    const [, , left, top] = this.gridCell(s, d.px, d.py, sh, d.touch);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 8;
    this.drawShape(ctx, sh, left, top, s.layout.cell, 0.95);
    ctx.restore();
  }

  private drawSoloHud(ctx: CanvasRenderingContext2D) {
    const s = this.sides[0], b = s.board;
    if (!b) return;
    const L = s.layout, cx = L.gx + (L.cell * N) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `600 13px ${FONT_B}`; ctx.fillStyle = 'rgba(220,220,255,0.7)';
    ctx.fillText('SCORE', cx, 28);
    ctx.font = `52px ${FONT_D}`; ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(5,5,18,0.85)';
    ctx.strokeText(String(b.stats.score), cx, 80); ctx.fillStyle = '#fff'; ctx.fillText(String(b.stats.score), cx, 80);
    const best = Math.max(this.best, b.stats.score);
    ctx.textAlign = 'right';
    ctx.font = `600 13px ${FONT_B}`; ctx.fillStyle = 'rgba(220,220,255,0.7)'; ctx.fillText('BEST', 1240, 40);
    ctx.font = `30px ${FONT_D}`; ctx.fillStyle = b.stats.score > this.best && this.best > 0 ? '#ffcf4a' : '#fff'; ctx.fillText(String(best), 1240, 78);
    ctx.textAlign = 'left';
    ctx.font = `600 13px ${FONT_B}`; ctx.fillStyle = 'rgba(220,220,255,0.7)'; ctx.fillText('LINES', 40, 40);
    ctx.font = `30px ${FONT_D}`; ctx.fillStyle = '#fff'; ctx.fillText(String(b.stats.lines), 40, 78);
    if (b.streak > 1) {
      ctx.textAlign = 'center';
      ctx.font = `22px ${FONT_D}`; ctx.fillStyle = s.color;
      ctx.fillText('COMBO x' + b.streak, cx + 260, 136);
    }
    ctx.restore();
  }

  private drawSoloBanner(ctx: CanvasRenderingContext2D) {
    const t = this.phaseT;
    const slam = (text: string, color: string, k: number, size: number) => {
      const sc = k < 0.18 ? 2.4 - (k / 0.18) * 1.4 : 1;
      ctx.save(); ctx.translate(640, 380);
      ctx.fillStyle = 'rgba(5,5,20,0.7)'; ctx.fillRect(-640, -size * 0.75, 1280, size * 1.5);
      ctx.scale(sc, sc); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${size}px ${FONT_D}`; ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = '#05051a';
      ctx.strokeText(text, 0, 0); ctx.fillStyle = color; ctx.fillText(text, 0, 0); ctx.restore();
    };
    if (this.phase === 'intro' && t > 0.3) slam('ENDLESS', '#ffe066', t - 0.3, 80);
    if (this.phase === 'fight') slam('GO!', '#ff5a3c', t, 110);
    if (this.phase === 'ko') slam('NO MORE MOVES', '#ff5a6e', t, 64);
  }
}

export { SHAPE_BY_KEY };
