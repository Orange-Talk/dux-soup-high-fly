// Music playback + synthesized sound effects (Web Audio)
import bgmB64 from '../assets/bgm.mp3';

type SfxName =
  | 'move' | 'rotate' | 'spinrot' | 'hold' | 'land' | 'lock' | 'hard' | 'clear1' | 'clear2' | 'clear3' | 'quad'
  | 'tspin' | 'combo' | 'b2b' | 'pc' | 'whoosh' | 'hit' | 'heavyhit' | 'garbage' | 'warn' | 'cancel'
  | 'super' | 'superReady' | 'round' | 'fight' | 'ko' | 'victory' | 'menuMove' | 'menuSelect' | 'menuBack'
  | 'heartbeat' | 'tick' | 'join' | 'burst' | 'count';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  filter!: BiquadFilterNode;
  reverb!: ConvolverNode;
  reverbSend!: GainNode;
  noise!: AudioBuffer;
  bgmBuf: AudioBuffer | null = null;
  bgmSrc: AudioBufferSourceNode | null = null;
  musicVol = 0.5;
  sfxVol = 0.7;
  private loading: Promise<void> | null = null;
  private lastPlayed: Record<string, number> = {};

  unlock() {
    if (!this.ctx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx!;
      this.master = c.createGain(); this.master.gain.value = 0.9;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.master.connect(comp); comp.connect(c.destination);
      this.music = c.createGain(); this.music.gain.value = this.musicVol * 0.55;
      this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 900; this.filter.Q.value = 0.7;
      this.music.connect(this.filter); this.filter.connect(this.master);
      this.sfx = c.createGain(); this.sfx.gain.value = this.sfxVol;
      this.sfx.connect(this.master);
      // noise buffer
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // simple generated reverb impulse
      this.reverb = c.createConvolver();
      const ir = c.createBuffer(2, c.sampleRate * 1.8, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const a = ir.getChannelData(ch); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / a.length, 3); }
      this.reverb.buffer = ir;
      this.reverbSend = c.createGain(); this.reverbSend.gain.value = 0.35;
      this.reverbSend.connect(this.reverb); this.reverb.connect(this.sfx);
      this.loadMusic();
    }
    if (this.ctx!.state === 'suspended') this.ctx!.resume();
  }

  private loadMusic() {
    if (this.loading || !this.ctx) return;
    this.loading = Promise.resolve().then(() => { const bin = atob(bgmB64 as unknown as string); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }).then((ab) => new Promise<AudioBuffer>((res, rej) => this.ctx!.decodeAudioData(ab, res, rej)))
      .then((buf) => { this.bgmBuf = buf; this.startMusic(); }).catch(() => {});
  }

  private startMusic() {
    if (!this.ctx || !this.bgmBuf || this.bgmSrc) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.bgmBuf; s.loop = true;
    s.connect(this.music); s.start();
    this.bgmSrc = s;
  }

  setVolumes(music: number, sfx: number) {
    this.musicVol = music; this.sfxVol = sfx;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(music * 0.55, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  /** 'menu' muffles the track, 'battle' opens it up, 'quiet' ducks it */
  musicMode(mode: 'menu' | 'battle' | 'quiet' | 'ko') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = mode === 'battle' ? 18000 : mode === 'menu' ? 850 : mode === 'ko' ? 400 : 1400;
    this.filter.frequency.cancelScheduledValues(t);
    this.filter.frequency.setTargetAtTime(f, t, mode === 'battle' ? 0.25 : 0.4);
    const g = (mode === 'quiet' ? 0.35 : mode === 'ko' ? 0.25 : 1) * this.musicVol * 0.55;
    this.music.gain.setTargetAtTime(g, t, 0.3);
  }

  musicRate(r: number) {
    if (this.bgmSrc && this.ctx) this.bgmSrc.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.5);
  }

  // ---- synth helpers
  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  private tone(type: OscillatorType, f0: number, f1: number, t: number, a: number, dec: number, vol: number, dest?: AudioNode, rev = 0) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + dec);
    const g = c.createGain(); this.env(g, t, a, vol, dec);
    o.connect(g); g.connect(dest || this.sfx);
    if (rev) { const s = c.createGain(); s.gain.value = rev; g.connect(s); s.connect(this.reverbSend); }
    o.start(t); o.stop(t + a + dec + 0.05);
  }
  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1, rev = 0) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    if (rev) { const r = c.createGain(); r.gain.value = rev; g.connect(r); r.connect(this.reverbSend); }
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  private chord(freqs: number[], t: number, dur: number, vol: number, type: OscillatorType = 'sawtooth', cutoff = 2400, rev = 0.4) {
    const c = this.ctx!;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + dur);
    const g = c.createGain(); this.env(g, t, 0.01, vol, dur);
    f.connect(g); g.connect(this.sfx);
    const r = c.createGain(); r.gain.value = rev; g.connect(r); r.connect(this.reverbSend);
    for (const fr of freqs) for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = fr; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    }
  }

  play(name: SfxName, arg = 0) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // de-dupe rapid repeats
    const last = this.lastPlayed[name] || 0;
    if (now - last < 0.025 && name !== 'combo') return;
    this.lastPlayed[name] = now;
    const t = now + 0.005;
    const N = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    switch (name) {
      case 'move': this.tone('triangle', 1250, 1150, t, 0.002, 0.03, 0.08); break;
      case 'tick': this.tone('square', 1800, 1800, t, 0.001, 0.02, 0.03); break;
      case 'rotate': this.tone('triangle', 700, 1050, t, 0.003, 0.05, 0.11); break;
      case 'spinrot': this.tone('sine', 900, 1800, t, 0.003, 0.09, 0.14); this.tone('triangle', 1350, 2400, t + 0.03, 0.003, 0.08, 0.06); break;
      case 'hold': this.tone('sine', 500, 900, t, 0.005, 0.07, 0.12); this.tone('sine', 900, 600, t + 0.06, 0.005, 0.06, 0.08); break;
      case 'land': this.tone('sine', 220, 160, t, 0.002, 0.05, 0.08); break;
      case 'lock': this.tone('sine', 190, 90, t, 0.002, 0.08, 0.22); this.noiseHit(t, 0.04, 0.12, 'bandpass', 2400, 1200, 1.5); break;
      case 'hard':
        this.tone('sine', 150, 45, t, 0.002, 0.16, 0.5);
        this.noiseHit(t, 0.09, 0.3, 'lowpass', 3000, 300, 0.7);
        break;
      case 'clear1': case 'clear2': case 'clear3': {
        const n = name === 'clear1' ? 1 : name === 'clear2' ? 2 : 3;
        const base = [76, 79, 83, 88];
        for (let i = 0; i < n + 1; i++) this.tone('triangle', N(base[i] + n), N(base[i] + n), t + i * 0.045, 0.004, 0.22, 0.13, undefined, 0.25);
        this.noiseHit(t, 0.18, 0.08, 'highpass', 6000, 9000, 0.7);
        break;
      }
      case 'quad':
        this.chord([N(60), N(64), N(67), N(72)], t, 0.9, 0.12, 'sawtooth', 3500, 0.6);
        for (let i = 0; i < 6; i++) this.tone('triangle', N(84 + [0, 4, 7, 12, 16, 19][i]), N(84 + [0, 4, 7, 12, 16, 19][i]), t + i * 0.04, 0.003, 0.3, 0.08, undefined, 0.4);
        this.noiseHit(t, 0.5, 0.22, 'bandpass', 800, 6000, 0.8, 0.3);
        this.tone('sine', 110, 40, t, 0.003, 0.4, 0.5);
        break;
      case 'tspin':
        this.chord([N(67), N(71), N(74)], t, 0.6, 0.1, 'square', 3000, 0.5);
        this.tone('sine', 1500, 3000, t, 0.005, 0.25, 0.08, undefined, 0.5);
        break;
      case 'combo': {
        const step = Math.min(arg, 12);
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
        this.tone('square', N(72 + scale[step]), N(72 + scale[step]), t, 0.003, 0.12, 0.06, undefined, 0.3);
        this.tone('sine', N(84 + scale[step]), N(84 + scale[step]), t, 0.003, 0.16, 0.08);
        break;
      }
      case 'b2b': this.tone('sine', N(91), N(91), t + 0.08, 0.004, 0.4, 0.09, undefined, 0.6); this.tone('sine', N(96), N(96), t + 0.14, 0.004, 0.4, 0.07, undefined, 0.6); break;
      case 'pc': this.chord([N(72), N(76), N(79), N(84), N(88)], t, 1.6, 0.11, 'triangle', 6000, 0.8); break;
      case 'whoosh': this.noiseHit(t, 0.28, 0.28, 'bandpass', 500, 4000, 1.2); break;
      case 'hit':
        this.noiseHit(t, 0.08, 0.5, 'lowpass', 4000, 600, 0.8);
        this.tone('sine', 180, 60, t, 0.002, 0.12, 0.55);
        this.tone('square', 90, 50, t, 0.002, 0.06, 0.12);
        break;
      case 'heavyhit':
        this.noiseHit(t, 0.25, 0.7, 'lowpass', 5000, 200, 0.6, 0.4);
        this.tone('sine', 140, 30, t, 0.002, 0.45, 0.8);
        this.tone('sawtooth', 80, 35, t, 0.002, 0.22, 0.2);
        break;
      case 'garbage':
        this.noiseHit(t, 0.35, 0.35, 'lowpass', 400, 80, 1.5);
        this.tone('sine', 70, 40, t, 0.01, 0.3, 0.35);
        break;
      case 'warn': this.tone('square', 880, 880, t, 0.004, 0.08, 0.06); this.tone('square', 660, 660, t + 0.11, 0.004, 0.08, 0.06); break;
      case 'cancel': this.tone('triangle', 1600, 500, t, 0.002, 0.15, 0.12); this.noiseHit(t, 0.12, 0.2, 'highpass', 3000, 1500, 1); break;
      case 'superReady': for (let i = 0; i < 3; i++) this.tone('triangle', N(79 + i * 5), N(79 + i * 5), t + i * 0.06, 0.003, 0.25, 0.09, undefined, 0.5); break;
      case 'super':
        this.noiseHit(t, 0.7, 0.3, 'bandpass', 200, 5000, 1.5, 0.5);
        this.chord([N(57), N(64), N(69), N(76)], t + 0.1, 1.3, 0.11, 'sawtooth', 2800, 0.8);
        this.tone('sine', 60, 30, t + 0.45, 0.005, 0.8, 0.7);
        break;
      case 'burst': this.noiseHit(t, 0.6, 0.45, 'lowpass', 6000, 150, 0.5, 0.5); this.tone('sine', 100, 30, t, 0.004, 0.6, 0.7); break;
      case 'round':
        for (const [f, v] of [[220, 0.25], [331, 0.15], [523, 0.08], [697, 0.05]] as [number, number][]) this.tone('sine', f, f * 0.995, t, 0.004, 1.6, v, undefined, 0.6);
        break;
      case 'count': this.tone('square', 660, 660, t, 0.003, 0.12, 0.07, undefined, 0.3); break;
      case 'fight':
        this.noiseHit(t, 0.4, 0.35, 'bandpass', 400, 3000, 1, 0.5);
        this.chord([N(62), N(69), N(74)], t, 0.7, 0.13, 'sawtooth', 4000, 0.6);
        this.tone('sine', 120, 40, t, 0.003, 0.4, 0.6);
        break;
      case 'ko':
        this.tone('sine', 120, 25, t, 0.003, 1.4, 0.9);
        this.noiseHit(t, 1.0, 0.6, 'lowpass', 3000, 80, 0.5, 0.8);
        this.chord([N(45), N(52), N(57)], t + 0.05, 1.8, 0.12, 'sawtooth', 1500, 0.9);
        break;
      case 'victory': {
        const seq = [72, 76, 79, 84, 79, 84, 88];
        seq.forEach((n, i) => this.tone('square', N(n), N(n), t + i * 0.1, 0.004, i === seq.length - 1 ? 0.8 : 0.12, 0.07, undefined, 0.4));
        this.chord([N(60), N(64), N(67)], t + 0.6, 1.2, 0.08, 'triangle', 5000, 0.6);
        break;
      }
      case 'menuMove': this.tone('triangle', 1400, 1500, t, 0.002, 0.04, 0.07); break;
      case 'menuSelect': this.tone('triangle', N(84), N(84), t, 0.003, 0.08, 0.1); this.tone('triangle', N(91), N(91), t + 0.06, 0.003, 0.14, 0.1, undefined, 0.3); break;
      case 'menuBack': this.tone('triangle', N(84), N(84), t, 0.003, 0.06, 0.08); this.tone('triangle', N(77), N(77), t + 0.05, 0.003, 0.1, 0.08); break;
      case 'join': this.tone('sine', N(72), N(84), t, 0.004, 0.18, 0.15, undefined, 0.4); this.noiseHit(t, 0.15, 0.1, 'highpass', 5000, 8000); break;
      case 'heartbeat': this.tone('sine', 60, 45, t, 0.005, 0.12, 0.35); this.tone('sine', 55, 40, t + 0.16, 0.005, 0.14, 0.25); break;
    }
  }
}

export const audio = new AudioEngine();
export type { SfxName };
