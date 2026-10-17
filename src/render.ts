import { COLS, ROWS, HIDDEN, SHAPES, PieceType, Active, ID_TYPE, GARBAGE, BOX } from './engine';

export const W = 1280, H = 720;
export const CELL = 27;
export const BW = COLS * CELL, BH = (ROWS - HIDDEN) * CELL;
export const BOARD_Y = 128;
export const BOARD_X = [116, W - 116 - BW];
export const GROUND_Y = 650;
export const FONT_D = "'Bungee', 'Impact', 'Arial Black', sans-serif";
export const FONT_B = "'Chakra Petch', 'Trebuchet MS', 'Segoe UI', sans-serif";

export const PCOL: Record<number, string> = {
  1: '#2fd9ff', // I
  2: '#ffd23a', // O
  3: '#b764ff', // T
  4: '#4ce46c', // S
  5: '#ff4d61', // Z
  6: '#3f7dff', // J
  7: '#ff9b2f', // L
  8: '#59607a', // garbage
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

const cache = new Map<string, HTMLCanvasElement>();
let DPR = 1;
export function setDpr(d: number) { if (d !== DPR) { DPR = d; cache.clear(); } }

/** Pre-rendered beveled block */
export function block(id: number, size: number, variant = 0): HTMLCanvasElement {
  const key = id + ':' + size + ':' + variant + ':' + DPR;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const s = Math.ceil(size * DPR);
  c.width = s; c.height = s;
  const x = c.getContext('2d')!;
  x.scale(DPR, DPR);
  const base = PCOL[id] || '#888';
  const r = Math.max(2, size * 0.14);
  const rr = (px: number, py: number, w: number, h: number, rad: number) => {
    x.beginPath(); x.moveTo(px + rad, py); x.arcTo(px + w, py, px + w, py + h, rad); x.arcTo(px + w, py + h, px, py + h, rad); x.arcTo(px, py + h, px, py, rad); x.arcTo(px, py, px + w, py, rad); x.closePath();
  };
  if (id === GARBAGE) {
    // carved stone with a rune glint
    const g = x.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, variant === 2 ? '#6d5a8a' : '#646c88'); g.addColorStop(1, variant === 2 ? '#3b2f52' : '#353b52');
    rr(0.5, 0.5, size - 1, size - 1, r * 0.6); x.fillStyle = g; x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 1; x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(2, 2, size - 4, 2);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(2, size - 4, size - 4, 2);
    x.strokeStyle = variant === 2 ? 'rgba(220,150,255,0.55)' : 'rgba(150,220,255,0.5)';
    x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(size * 0.35, size * 0.3); x.lineTo(size * 0.62, size * 0.5); x.lineTo(size * 0.38, size * 0.72); x.stroke();
    return c;
  }
  if (variant === 9) {
    // ghost
    rr(1.5, 1.5, size - 3, size - 3, r);
    x.fillStyle = shade(base, -0.55).replace('rgb', 'rgba').replace(')', ',0.35)');
    x.fill();
    x.strokeStyle = base; x.globalAlpha = 0.75; x.lineWidth = 1.6; x.stroke();
    return c;
  }
  if (variant === 8) {
    // dead / greyed
    rr(0.5, 0.5, size - 1, size - 1, r);
    x.fillStyle = '#3a3d4c'; x.fill();
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(2, 2, size - 4, 3);
    return c;
  }
  // body gradient
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, shade(base, 0.32)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -0.35));
  rr(0.5, 0.5, size - 1, size - 1, r);
  x.fillStyle = g; x.fill();
  // inner facet
  const m = size * 0.2;
  const ig = x.createLinearGradient(0, m, 0, size - m);
  ig.addColorStop(0, shade(base, 0.18)); ig.addColorStop(1, shade(base, -0.12));
  rr(m, m, size - 2 * m, size - 2 * m, r * 0.6);
  x.fillStyle = ig; x.fill();
  // bevel edges
  x.save(); rr(0.5, 0.5, size - 1, size - 1, r); x.clip();
  x.fillStyle = 'rgba(255,255,255,0.35)';
  x.beginPath(); x.moveTo(0, 0); x.lineTo(size, 0); x.lineTo(size - m, m); x.lineTo(m, m); x.lineTo(m, size - m); x.lineTo(0, size); x.closePath(); x.fill();
  x.fillStyle = 'rgba(0,0,0,0.28)';
  x.beginPath(); x.moveTo(size, size); x.lineTo(0, size); x.lineTo(m, size - m); x.lineTo(size - m, size - m); x.lineTo(size - m, m); x.lineTo(size, 0); x.closePath(); x.fill();
  x.restore();
  // glint
  x.fillStyle = 'rgba(255,255,255,0.75)';
  x.beginPath(); x.ellipse(size * 0.3, size * 0.27, size * 0.11, size * 0.06, -0.6, 0, 6.283); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 1;
  rr(0.5, 0.5, size - 1, size - 1, r); x.stroke();
  return c;
}

export interface IncomingView { lines: number; ready: boolean; }
export interface BoardView {
  grid: Uint8Array; tint: Uint8Array;
  cur: Active | null; ghostY: number | null;
  hold: PieceType | null; canHold: boolean; queue: PieceType[];
  incoming: IncomingView[];
  superMeter: number; superCost: number;
  clearingRows: number[] | null; clearProgress: number;
  alive: boolean; score: number; lines: number; level: number; combo: number; b2b: boolean;
}

/** visual-only state per board */
export class BoardFx {
  bumpY = 0; vBump = 0;
  shakeX = 0;
  koT = -1; // time since KO for grey-out sweep
  lockFlash: { cells: [number, number][]; t: number } | null = null;
  rise = 0; // garbage rise flash
  dangerT = 0;
  superFlash = 0;
  update(dt: number) {
    const s = dt / 1000;
    this.vBump += (-this.bumpY * 260 - this.vBump * 18) * s;
    this.bumpY += this.vBump * s;
    this.shakeX *= Math.pow(0.0005, s);
    if (this.koT >= 0) this.koT += s;
    if (this.lockFlash) { this.lockFlash.t += s; if (this.lockFlash.t > 0.18) this.lockFlash = null; }
    this.rise = Math.max(0, this.rise - s * 2.5);
    this.superFlash = Math.max(0, this.superFlash - s * 1.5);
    this.dangerT += s;
  }
  bump(v: number) { this.vBump += v; }
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export { rrect };

export function drawMini(ctx: CanvasRenderingContext2D, t: PieceType, cx: number, cy: number, size: number, alpha = 1, grey = false) {
  const cells = SHAPES[t][0];
  let minx = 9, maxx = -9, miny = 9, maxy = -9;
  for (const [x, y] of cells) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const w = (maxx - minx + 1) * size, h = (maxy - miny + 1) * size;
  const id = ({ I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 } as any)[t];
  const img = block(id, size, grey ? 8 : 0);
  ctx.globalAlpha = alpha;
  for (const [x, y] of cells) ctx.drawImage(img, cx - w / 2 + (x - minx) * size, cy - h / 2 + (y - miny) * size, size, size);
  ctx.globalAlpha = 1;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, label: string) {
  ctx.save();
  rrect(ctx, x, y, w, h, 10);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(14,16,40,0.86)'); g.addColorStop(1, 'rgba(8,9,24,0.86)');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = color + '66'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `13px ${FONT_D}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(label, x + w / 2, y + 7);
  ctx.restore();
}

export interface DrawOpts { side: 0 | 1; color: string; time: number; ghost: boolean; name: string; showDanger: boolean; }

export function drawBoard(ctx: CanvasRenderingContext2D, v: BoardView, fx: BoardFx, o: DrawOpts) {
  const bx = BOARD_X[o.side] + fx.shakeX, by = BOARD_Y + fx.bumpY;
  const top = stackTopOf(v.grid);
  const danger = o.showDanger && v.alive && top < 6;
  const dangerPulse = danger ? 0.5 + 0.5 * Math.sin(fx.dangerT * 9) : 0;

  // well glow + frame
  ctx.save();
  ctx.shadowColor = danger ? `rgba(255,40,60,${0.5 + dangerPulse * 0.4})` : o.color;
  ctx.shadowBlur = 26;
  rrect(ctx, bx - 7, by - 7, BW + 14, BH + 14, 12);
  ctx.fillStyle = 'rgba(6,7,20,0.9)';
  ctx.fill();
  ctx.restore();
  // frame gradient border
  ctx.save();
  rrect(ctx, bx - 7, by - 7, BW + 14, BH + 14, 12);
  const fg = ctx.createLinearGradient(bx, by, bx + BW, by + BH);
  const fc = danger ? '#ff3b55' : o.color;
  fg.addColorStop(0, fc); fg.addColorStop(0.5, 'rgba(255,255,255,0.25)'); fg.addColorStop(1, fc);
  ctx.strokeStyle = fg; ctx.lineWidth = 3; ctx.stroke();
  ctx.restore();

  // well interior
  ctx.save();
  ctx.beginPath(); ctx.rect(bx, by, BW, BH); ctx.clip();
  const ig = ctx.createLinearGradient(0, by, 0, by + BH);
  ig.addColorStop(0, 'rgba(20,22,52,0.92)'); ig.addColorStop(1, 'rgba(10,10,28,0.95)');
  ctx.fillStyle = ig; ctx.fillRect(bx, by, BW, BH);
  // grid
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 1; x < COLS; x++) { ctx.moveTo(bx + x * CELL + 0.5, by); ctx.lineTo(bx + x * CELL + 0.5, by + BH); }
  for (let y = 1; y < ROWS - HIDDEN; y++) { ctx.moveTo(bx, by + y * CELL + 0.5); ctx.lineTo(bx + BW, by + y * CELL + 0.5); }
  ctx.stroke();
  if (danger) {
    const dg = ctx.createLinearGradient(0, by, 0, by + BH * 0.5);
    dg.addColorStop(0, `rgba(255,30,50,${0.18 + dangerPulse * 0.14})`); dg.addColorStop(1, 'rgba(255,30,50,0)');
    ctx.fillStyle = dg; ctx.fillRect(bx, by, BW, BH * 0.5);
  }
  if (fx.superFlash > 0) {
    ctx.fillStyle = o.color; ctx.globalAlpha = fx.superFlash * 0.35; ctx.fillRect(bx, by, BW, BH); ctx.globalAlpha = 1;
  }

  // cells
  const clearing = v.clearingRows;
  const koRow = fx.koT >= 0 ? ROWS - Math.floor(fx.koT * 30) : 99;
  for (let y = HIDDEN; y < ROWS; y++) {
    const isClr = clearing && clearing.includes(y);
    for (let x = 0; x < COLS; x++) {
      const id = v.grid[y * COLS + x];
      if (!id) continue;
      const px = bx + x * CELL, py = by + (y - HIDDEN) * CELL;
      if (isClr) {
        const p = v.clearProgress;
        // flash white, then shrink from the center outwards
        const delay = Math.abs(x - 4.5) / 4.5 * 0.35;
        const k = Math.max(0, Math.min(1, (p - delay) / (1 - delay)));
        const s = CELL * (1 - k);
        ctx.drawImage(block(id, CELL, id === GARBAGE ? v.tint[y * COLS + x] : 0), px, py, CELL, CELL);
        ctx.fillStyle = `rgba(255,255,255,${0.85 - k * 0.5})`;
        ctx.fillRect(px + (CELL - s) / 2, py + (CELL - s) / 2, s, s);
        continue;
      }
      const dead = y >= koRow || !v.alive && fx.koT < 0;
      ctx.drawImage(block(id, CELL, dead ? 8 : id === GARBAGE ? v.tint[y * COLS + x] : 0), px, py, CELL, CELL);
    }
  }
  if (fx.rise > 0) {
    const rg = ctx.createLinearGradient(0, by + BH - 120, 0, by + BH);
    rg.addColorStop(0, 'rgba(255,60,80,0)'); rg.addColorStop(1, `rgba(255,60,80,${fx.rise * 0.5})`);
    ctx.fillStyle = rg; ctx.fillRect(bx, by + BH - 120, BW, 120);
  }
  // ghost + active piece
  if (v.cur && v.alive) {
    const p = v.cur;
    const id = ({ I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 } as any)[p.t];
    if (o.ghost && v.ghostY !== null && v.ghostY !== p.y) {
      const gi = block(id, CELL, 9);
      for (const [cx, cy] of SHAPES[p.t][p.r]) {
        const yy = v.ghostY + cy;
        if (yy < HIDDEN) continue;
        ctx.drawImage(gi, bx + (p.x + cx) * CELL, by + (yy - HIDDEN) * CELL, CELL, CELL);
      }
    }
    const bi = block(id, CELL, 0);
    ctx.save();
    ctx.shadowColor = PCOL[id]; ctx.shadowBlur = 12;
    for (const [cx, cy] of SHAPES[p.t][p.r]) {
      const yy = p.y + cy;
      if (yy < HIDDEN) continue;
      ctx.drawImage(bi, bx + (p.x + cx) * CELL, by + (yy - HIDDEN) * CELL, CELL, CELL);
    }
    ctx.restore();
  }
  if (fx.lockFlash) {
    const a = 1 - fx.lockFlash.t / 0.18;
    ctx.fillStyle = `rgba(255,255,255,${a * 0.55})`;
    for (const [cx, cy] of fx.lockFlash.cells) if (cy >= HIDDEN) ctx.fillRect(bx + cx * CELL, by + (cy - HIDDEN) * CELL, CELL, CELL);
  }
  // inner vignette
  const vg = ctx.createLinearGradient(bx, 0, bx + BW, 0);
  vg.addColorStop(0, 'rgba(0,0,0,0.25)'); vg.addColorStop(0.12, 'rgba(0,0,0,0)'); vg.addColorStop(0.88, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = vg; ctx.fillRect(bx, by, BW, BH);
  ctx.restore();

  // spawn-zone indicator line
  ctx.fillStyle = danger ? `rgba(255,60,80,${0.4 + dangerPulse * 0.5})` : 'rgba(255,255,255,0.0)';
  ctx.fillRect(bx, by - 1, BW, 2);

  // ---- side panels
  const outer = o.side === 0 ? bx - 108 : bx + BW + 14;
  const inner = o.side === 0 ? bx + BW + 30 : bx - 30 - 86;
  // HOLD
  panel(ctx, outer, by, 94, 84, o.color, 'HOLD');
  if (v.hold) drawMini(ctx, v.hold, outer + 47, by + 50, 18, v.canHold ? 1 : 0.4, !v.canHold);
  // NEXT
  panel(ctx, inner, by, 86, 296, o.color, 'NEXT');
  v.queue.slice(0, 5).forEach((t, i) => {
    const s = i === 0 ? 19 : 15;
    const cy = i === 0 ? by + 58 : by + 108 + (i - 1) * 50;
    drawMini(ctx, t, inner + 43, cy, s, i === 0 ? 1 : 0.85);
  });
  // stats under hold
  ctx.save();
  ctx.textAlign = 'center';
  const sx = outer + 47;
  const stat = (label: string, val: string, y: number) => {
    ctx.fillStyle = 'rgba(200,205,255,0.55)'; ctx.font = `600 11px ${FONT_B}`; ctx.fillText(label, sx, y);
    ctx.fillStyle = '#fff'; ctx.font = `19px ${FONT_D}`; ctx.fillText(val, sx, y + 20);
  };
  ctx.textBaseline = 'top';
  stat('SCORE', String(v.score), by + 104);
  stat('LINES', String(v.lines), by + 154);
  stat('SPEED', 'LV ' + v.level, by + 204);
  ctx.restore();

  // garbage meter (between board and center)
  const gx = o.side === 0 ? bx + BW + 11 : bx - 19;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  rrect(ctx, gx, by, 8, BH, 4); ctx.fill();
  let total = 0;
  for (const inc of v.incoming) {
    const h = Math.min(inc.lines, 20 - total) * CELL;
    if (h <= 0) break;
    const y0 = by + BH - total * CELL - h;
    const pulse = inc.ready ? 0.6 + 0.4 * Math.sin(o.time * 18) : 1;
    ctx.fillStyle = inc.ready ? `rgba(255,50,70,${pulse})` : 'rgba(255,170,60,0.95)';
    rrect(ctx, gx + 1, y0 + 1, 6, h - 2, 3); ctx.fill();
    total += inc.lines;
  }
  if (total > 0) {
    ctx.save();
    ctx.font = `14px ${FONT_D}`; ctx.textAlign = 'center';
    ctx.fillStyle = '#ff5a6e';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    const ty = by + BH - Math.min(total, 20) * CELL - 10;
    ctx.strokeText(String(total), gx + 4, ty); ctx.fillText(String(total), gx + 4, ty);
    ctx.restore();
  }

  // super meter under board
  const smy = by + BH + 16;
  const fill = v.superMeter / v.superCost;
  const full = fill >= 1;
  ctx.save();
  rrect(ctx, bx, smy, BW, 16, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
  ctx.strokeStyle = full ? o.color : 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; ctx.stroke();
  if (fill > 0) {
    ctx.save();
    rrect(ctx, bx + 2, smy + 2, (BW - 4) * Math.min(1, fill), 12, 6); ctx.clip();
    const sg = ctx.createLinearGradient(bx, 0, bx + BW, 0);
    sg.addColorStop(0, shade(o.color, -0.3)); sg.addColorStop(1, full ? '#ffffff' : o.color);
    ctx.fillStyle = sg; ctx.fillRect(bx, smy, BW, 16);
    if (full) {
      const sh = ((o.time * 1.4) % 1.4) - 0.2;
      const lg = ctx.createLinearGradient(bx + BW * sh - 40, 0, bx + BW * sh + 40, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.8)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(bx, smy, BW, 16);
    }
    ctx.restore();
  }
  ctx.font = `11px ${FONT_D}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = full ? '#0b0b1c' : 'rgba(255,255,255,0.75)';
  ctx.fillText(full ? 'SUPER READY' : 'SUPER', bx + BW / 2, smy + 8.5);
  ctx.restore();
}

export function stackTopOf(grid: Uint8Array): number {
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y * COLS + x]) return y - HIDDEN;
  return ROWS - HIDDEN;
}

/** board-space to screen coords */
export function cellToScreen(side: 0 | 1, x: number, y: number): [number, number] {
  return [BOARD_X[side] + x * CELL + CELL / 2, BOARD_Y + (y - HIDDEN) * CELL + CELL / 2];
}

export { ID_TYPE, BOX };
