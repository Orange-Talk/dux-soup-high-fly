// Particles, floating text, screen shake, hit-stop
export type PKind = 'spark' | 'shard' | 'ember' | 'ring' | 'smoke' | 'star' | 'streak' | 'confetti';
export interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number; size: number;
  color: string; kind: PKind; rot: number; vr: number; g: number; drag: number; add: boolean;
}
export interface FloatText {
  text: string; sub?: string; x: number; y: number; life: number; max: number; color: string; size: number; big: boolean; vy: number;
}

export class FX {
  ps: Particle[] = [];
  texts: FloatText[] = [];
  trauma = 0;
  hitstop = 0;
  flash = 0;
  flashColor = '#fff';
  slowmo = 1;
  slowmoT = 0;
  shakeOn = true;
  reduced = false;

  spawn(p: Partial<Particle> & { x: number; y: number }) {
    if (this.ps.length > 900) this.ps.shift();
    this.ps.push({ vx: 0, vy: 0, life: 0, max: 0.6, size: 4, color: '#fff', kind: 'spark', rot: Math.random() * 6.28, vr: 0, g: 0, drag: 0.98, add: true, ...p });
  }

  burst(x: number, y: number, n: number, color: string, speed = 260, kind: PKind = 'spark', size = 4, life = 0.6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.8);
      this.spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, kind, size: size * (0.6 + Math.random() * 0.8), max: life * (0.6 + Math.random() * 0.7), g: kind === 'shard' ? 900 : 120, drag: 0.94, vr: (Math.random() - 0.5) * 14 });
    }
  }

  ring(x: number, y: number, color: string, size = 80, life = 0.45) {
    this.spawn({ x, y, color, kind: 'ring', size, max: life, add: true });
  }

  text(text: string, x: number, y: number, color: string, size = 28, big = false, sub?: string) {
    this.texts.push({ text, sub, x, y, life: 0, max: big ? 1.5 : 1.15, color, size, big, vy: big ? -10 : -22 });
  }

  shake(amount: number) { if (this.shakeOn) this.trauma = Math.min(1, this.trauma + amount); }
  stop(ms: number) { if (!this.reduced) this.hitstop = Math.max(this.hitstop, ms); }
  doFlash(a: number, color = '#fff') { if (this.reduced) a *= 0.3; this.flash = Math.max(this.flash, a); this.flashColor = color; }
  slow(factor: number, secs: number) { this.slowmo = factor; this.slowmoT = secs; }

  update(dt: number) {
    const s = dt / 1000;
    this.trauma = Math.max(0, this.trauma - s * 1.6);
    this.flash = Math.max(0, this.flash - s * 3.2);
    if (this.slowmoT > 0) { this.slowmoT -= s; if (this.slowmoT <= 0) this.slowmo = 1; }
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += s;
      if (p.life >= p.max) { this.ps.splice(i, 1); continue; }
      p.vy += p.g * s;
      p.vx *= Math.pow(p.drag, s * 60); p.vy *= Math.pow(p.drag, s * 60);
      p.x += p.vx * s; p.y += p.vy * s;
      p.rot += p.vr * s;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += s;
      t.y += t.vy * s;
      t.vy *= Math.pow(0.9, s * 60);
      if (t.life >= t.max) this.texts.splice(i, 1);
    }
  }

  shakeOffset(time: number): [number, number] {
    const k = this.trauma * this.trauma * 18;
    if (k < 0.05) return [0, 0];
    return [Math.sin(time * 0.071) * k * (Math.random() * 0.4 + 0.8), Math.cos(time * 0.093) * k * (Math.random() * 0.4 + 0.8)];
  }

  draw(ctx: CanvasRenderingContext2D, fontDisplay: string) {
    for (const p of this.ps) {
      const k = 1 - p.life / p.max;
      ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      switch (p.kind) {
        case 'spark': case 'ember': {
          ctx.globalAlpha = k;
          ctx.fillStyle = p.color;
          const sz = p.size * (p.kind === 'ember' ? 1 : 0.5 + k * 0.5);
          ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, 6.283); ctx.fill();
          break;
        }
        case 'streak': {
          ctx.globalAlpha = k;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size * k; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
          break;
        }
        case 'shard': case 'confetti': {
          ctx.globalAlpha = Math.min(1, k * 1.6);
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.kind === 'confetti') ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
          else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          ctx.restore();
          break;
        }
        case 'ring': {
          const e = 1 - Math.pow(k, 2);
          ctx.globalAlpha = k * 0.9;
          ctx.strokeStyle = p.color; ctx.lineWidth = 2 + 8 * k;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * e, 0, 6.283); ctx.stroke();
          break;
        }
        case 'smoke': {
          ctx.globalAlpha = k * 0.35;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, 6.283); ctx.fill();
          break;
        }
        case 'star': {
          ctx.globalAlpha = k;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          const r = p.size;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) { const rr = i % 2 ? r * 0.25 : r; const a = (i / 8) * 6.283; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill(); ctx.restore();
          break;
        }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    for (const t of this.texts) {
      const p = t.life / t.max;
      const pop = t.life < 0.12 ? 0.6 + (t.life / 0.12) * 0.55 : t.life < 0.2 ? 1.15 - ((t.life - 0.12) / 0.08) * 0.15 : 1;
      const a = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(pop, pop);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `${t.size}px ${fontDisplay}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, t.size * 0.22);
      ctx.strokeStyle = 'rgba(8,6,22,0.92)';
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      if (t.sub) {
        ctx.font = `${Math.round(t.size * 0.5)}px ${fontDisplay}`;
        ctx.lineWidth = 4;
        ctx.strokeText(t.sub, 0, t.size * 0.78);
        ctx.fillStyle = '#fff';
        ctx.fillText(t.sub, 0, t.size * 0.78);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
