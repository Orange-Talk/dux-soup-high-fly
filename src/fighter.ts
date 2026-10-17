import { art, CharId, META, Img } from './assets';

export type FState = 'offscreen' | 'intro' | 'idle' | 'jab' | 'kick' | 'heavy' | 'super' | 'hurt' | 'ko' | 'victory' | 'block';

const CELL = META.cell;
const DRAW = 250; // logical px for a full frame cell
const AX = 0.547, AY = 0.99; // anchor (feet) inside a frame

let scratch: HTMLCanvasElement | null = null;
function tinted(img: Img, sx: number, sy: number, sw: number, sh: number, color: string): HTMLCanvasElement {
  if (!scratch) { scratch = document.createElement('canvas'); scratch.width = CELL; scratch.height = CELL; }
  if (scratch.width !== sw || scratch.height !== sh) { scratch.width = sw; scratch.height = sh; }
  const x = scratch.getContext('2d')!;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, sw, sh);
  x.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = color; x.fillRect(0, 0, sw, sh);
  return scratch;
}

interface Ghost { x: number; y: number; frame: number; a: number; }

export class Fighter {
  state: FState = 'offscreen';
  t = 0;
  frame = 0;
  x: number;
  y: number;
  offX = 0; vOffX = 0;
  hopY = 0; vHop = 0;
  flash = 0;
  danger = false;
  ghosts: Ghost[] = [];
  private ghostT = 0;
  private impactFired = false;
  onImpact: ((kind: FState) => void) | null = null;
  private queued: FState | null = null;
  scale = 1;
  dim = 0;

  constructor(public id: CharId, public alt: boolean, public side: 0 | 1, public homeX: number, groundY: number) {
    this.x = homeX; this.y = groundY;
  }

  get facing() { return this.side === 0 ? 1 : -1; }
  private fr(name: string): number[] { return art.chars[this.id].frames[name]; }

  set(s: FState) {
    if (this.state === 'ko' && s !== 'victory' && s !== 'idle' && s !== 'intro' && s !== 'offscreen') return;
    if (this.state === 'victory' && s !== 'idle' && s !== 'intro' && s !== 'offscreen') return;
    // don't let small hits interrupt a super
    if (this.state === 'super' && (s === 'jab' || s === 'kick' || s === 'hurt' || s === 'heavy')) { if (s !== 'hurt') this.queued = s; return; }
    if ((this.state === 'heavy') && (s === 'jab' || s === 'kick')) { this.queued = s; return; }
    this.state = s; this.t = 0; this.impactFired = false;
    if (s === 'hurt') { this.vOffX = -this.facing * 420; this.flash = 1; }
    if (s === 'ko') { this.vOffX = -this.facing * 520; this.flash = 1; }
    if (s === 'victory') { this.vHop = -520; }
    if (s === 'intro') { this.x = this.homeX - this.facing * 520; }
    if (s === 'jab') this.vOffX = this.facing * 120;
    if (s === 'kick') this.vOffX = this.facing * 160;
  }

  update(dt: number) {
    const s = dt / 1000;
    this.t += s;
    this.flash = Math.max(0, this.flash - s * 6);
    // spring offsets
    this.vOffX += (-this.offX * 140 - this.vOffX * 16) * s;
    this.offX += this.vOffX * s;
    if (this.hopY < 0 || this.vHop !== 0) {
      this.vHop += 1800 * s; this.hopY += this.vHop * s;
      if (this.hopY >= 0) { this.hopY = 0; this.vHop = 0; }
    }
    // ghosts
    this.ghostT -= s;
    for (const g of this.ghosts) g.a -= s * 2.2;
    this.ghosts = this.ghosts.filter((g) => g.a > 0);

    const A = this.fr('attack'), K = this.fr('kick'), H = this.fr('hurt'), D = this.fr('death'), R = this.fr('run');
    switch (this.state) {
      case 'offscreen': this.frame = A[0]; break;
      case 'intro': {
        const dur = 0.85;
        const k = Math.min(1, this.t / dur);
        const e = 1 - Math.pow(1 - k, 2.2);
        const start = this.homeX - this.facing * 520;
        this.x = start + (this.homeX - start) * e;
        this.frame = R[Math.floor(this.t * 24) % R.length];
        if (k >= 1) { this.x = this.homeX; this.set('idle'); this.vOffX = this.facing * -60; }
        break;
      }
      case 'idle': case 'block': this.frame = A[0]; break;
      case 'jab': {
        const i = Math.floor(this.t * 34);
        if (i >= 6 && !this.impactFired) { this.impactFired = true; this.onImpact?.('jab'); }
        if (i >= A.length) this.endAction(); else this.frame = A[i];
        break;
      }
      case 'kick': {
        const seq = [7, 8, 9, 10, 11, 12, 13, 14, 15];
        const i = Math.floor(this.t * 28);
        if (i >= 2 && !this.impactFired) { this.impactFired = true; this.onImpact?.('kick'); }
        if (i >= seq.length) this.endAction(); else this.frame = K[seq[i]];
        break;
      }
      case 'heavy': {
        const i = Math.floor(this.t * 30);
        if (i >= 9 && !this.impactFired) { this.impactFired = true; this.onImpact?.('heavy'); }
        if (i >= K.length) this.endAction(); else this.frame = K[i];
        if (i >= 2 && i <= 9 && this.ghostT <= 0) { this.ghostT = 0.035; this.ghosts.push({ x: this.x + this.offX, y: this.y + this.hopY, frame: this.frame, a: 0.55 }); }
        break;
      }
      case 'super': {
        // dash in, spin kick, recover
        const dash = 0.22, kickDur = K.length / 30;
        if (this.t < dash) {
          this.frame = R[Math.floor(this.t * 40) % R.length];
          this.offX = this.facing * 150 * (this.t / dash);
          this.vOffX = 0;
        } else if (this.t < dash + kickDur) {
          const i = Math.floor((this.t - dash) * 30);
          this.frame = K[Math.min(i, K.length - 1)];
          this.offX = this.facing * 150; this.vOffX = 0;
          if (i >= 9 && !this.impactFired) { this.impactFired = true; this.onImpact?.('super'); }
        } else {
          this.frame = A[0];
          this.vOffX = 0;
          this.offX = this.facing * 150 * Math.max(0, 1 - (this.t - dash - kickDur) / 0.25);
          if (this.t > dash + kickDur + 0.25) { this.offX = 0; this.endAction(); }
        }
        if (this.ghostT <= 0 && this.t < dash + kickDur) { this.ghostT = 0.03; this.ghosts.push({ x: this.x + this.offX, y: this.y + this.hopY, frame: this.frame, a: 0.6 }); }
        break;
      }
      case 'hurt': {
        const fwd = Math.floor(this.t * 30);
        if (fwd < H.length) this.frame = H[Math.min(fwd, 7)];
        else {
          const back = Math.floor((this.t - H.length / 30) * 36);
          if (back >= 8) this.endAction(); else this.frame = H[Math.max(0, 7 - back)];
        }
        break;
      }
      case 'ko': {
        const i = Math.floor(this.t * 15);
        this.frame = D[Math.min(i, D.length - 1)];
        break;
      }
      case 'victory': this.frame = -1; break;
    }
  }

  private endAction() {
    const q = this.queued; this.queued = null;
    this.state = 'idle'; this.t = 0;
    if (q) this.set(q);
  }

  /** world position of the fist/foot, for hit sparks */
  get strikePoint(): [number, number] { return [this.x + this.offX + this.facing * 105, this.y - 150 + this.hopY]; }
  get bodyPoint(): [number, number] { return [this.x + this.offX, this.y - 125 + this.hopY]; }

  draw(ctx: CanvasRenderingContext2D, time: number, color: string) {
    const ch = art.chars[this.id];
    if (!ch) return;
    const atlas = this.alt ? ch.atlasAlt : ch.atlas;
    const D = DRAW * this.scale;
    const x = this.x + this.offX, y = this.y + this.hopY;
    // ground shadow
    const shadowW = this.state === 'ko' && this.t > 0.7 ? 130 : 84;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - Math.min(0.6, -this.hopY / 200));
    const sg = ctx.createRadialGradient(x, this.y, 2, x, this.y, shadowW * this.scale);
    sg.addColorStop(0, 'rgba(0,0,0,0.75)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.scale(1, 0.18);
    ctx.beginPath(); ctx.arc(x, this.y / 0.18, shadowW * this.scale, 0, 6.283); ctx.fill();
    ctx.restore();

    if (this.state === 'victory') {
      const p = this.alt ? ch.portraitAlt : ch.portrait;
      const h = 238 * this.scale;
      const w = (p.width / p.height) * h;
      const breathe = Math.sin(time * 2.4) * 0.012;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1 - breathe * 0.5, 1 + breathe);
      // aura
      ctx.globalCompositeOperation = 'lighter';
      const ag = ctx.createRadialGradient(0, -h * 0.5, 10, 0, -h * 0.5, h * 0.75);
      ag.addColorStop(0, color + '55'); ag.addColorStop(1, color + '00');
      ctx.fillStyle = ag; ctx.fillRect(-h, -h * 1.3, h * 2, h * 1.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(p, -w / 2, -h, w, h);
      ctx.restore();
      return;
    }

    const f = this.frame;
    const sx = (f % META.cols) * CELL, sy = Math.floor(f / META.cols) * CELL;
    const drawFrame = (img: Img, fx: number, fy: number, gx: number, gy: number, alpha = 1, src?: [number, number]) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(gx, gy);
      ctx.scale(this.facing, 1);
      const dx = -AX * D, dy = -AY * D;
      const ssx = src ? src[0] : fx, ssy = src ? src[1] : fy;
      if ((this.state === 'idle' || this.state === 'block' || this.state === 'offscreen') && !src) {
        // breathing: shift the upper body over the legs
        const rate = this.danger ? 3.6 : 2.1;
        const b = (Math.sin(time * rate * Math.PI) * 0.5 + 0.5) * (this.danger ? 4.2 : 3.2) * this.scale;
        const sway = Math.sin(time * rate * Math.PI * 0.5) * 1.2 * this.scale;
        const hip = 0.6;
        ctx.drawImage(img, ssx, ssy + CELL * hip, CELL, CELL * (1 - hip), dx, dy + D * hip, D, D * (1 - hip));
        ctx.drawImage(img, ssx, ssy, CELL, CELL * hip + 2, dx + sway, dy + b, D, D * hip + (2 * D) / CELL);
      } else {
        ctx.drawImage(img, ssx, ssy, CELL, CELL, dx, dy, D, D);
      }
      ctx.restore();
    };
    // afterimages
    for (const g of this.ghosts) {
      const gsx = (g.frame % META.cols) * CELL, gsy = Math.floor(g.frame / META.cols) * CELL;
      const tc = tinted(atlas, gsx, gsy, CELL, CELL, color);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawFrame(tc, 0, 0, g.x, g.y, g.a * 0.5, [0, 0]);
      ctx.restore();
    }
    // scratch canvas is the size of one cell so src offsets are 0
    drawFrame(atlas, sx, sy, x, y);
    if (this.flash > 0.02) {
      const tc = tinted(atlas, sx, sy, CELL, CELL, '#ffffff');
      drawFrame(tc, 0, 0, x, y, this.flash * 0.85, [0, 0]);
    }
    if (this.dim > 0) {
      const tc = tinted(atlas, sx, sy, CELL, CELL, '#0a0a1a');
      drawFrame(tc, 0, 0, x, y, this.dim, [0, 0]);
    }
  }
}
