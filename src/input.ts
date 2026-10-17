import { Controls, emptyControls } from './engine';

export type SourceId = 'kb1' | 'kb2' | 'pad0' | 'pad1' | 'pad2' | 'pad3' | 'touch' | 'mouse';
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';
export interface NavEvent { src: SourceId; a: NavAction; }

type Map = Record<keyof Controls, string[]>;
export const KB1: Map = {
  left: ['KeyA'], right: ['KeyD'], soft: ['KeyS'], hard: ['Space'], cw: ['KeyW'], ccw: ['KeyQ'], hold: ['KeyE'], super: ['KeyR'],
};
export const KB2: Map = {
  left: ['ArrowLeft'], right: ['ArrowRight'], soft: ['ArrowDown'], hard: ['Enter', 'NumpadEnter', 'Numpad0'], cw: ['ArrowUp'], ccw: ['Slash', 'Numpad1'], hold: ['ShiftRight', 'Numpad2'], super: ['Period', 'Numpad3'],
};
export const SOLO: Map = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], soft: ['ArrowDown', 'KeyS'], hard: ['Space'],
  cw: ['ArrowUp', 'KeyX', 'KeyW'], ccw: ['KeyZ', 'ControlLeft', 'KeyQ'], hold: ['KeyC', 'ShiftLeft', 'ShiftRight', 'KeyE'], super: ['KeyV', 'KeyR', 'Enter'],
};
const NAV_KB1: Record<NavAction, string[]> = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], confirm: ['Space'], back: ['KeyQ'], pause: ['Escape'] };
const NAV_KB2: Record<NavAction, string[]> = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], confirm: ['Enter', 'NumpadEnter'], back: ['Escape', 'Backspace'], pause: ['KeyP'] };

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Slash', 'Period', 'Tab']);

export class Input {
  keys = new Set<string>();
  private navHeld: Record<string, number> = {};
  navEvents: NavEvent[] = [];
  anyPressed = false;
  touch: Controls = emptyControls();
  /** queued one-shot presses from swipe gestures / tap buttons */
  taps: (keyof Controls)[] = [];
  private activeTaps = new Set<keyof Controls>();
  private cooldownTaps = new Set<keyof Controls>();
  padConnected: boolean[] = [false, false, false, false];
  private padPrev: Record<number, Record<string, boolean>> = {};
  lastSource: SourceId = 'kb2';
  /** keys pressed this frame */
  private fresh = new Set<string>();
  onAnyInput: (() => void) | null = null;
  typing = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.fresh.add(e.code);
      this.anyPressed = true;
      this.onAnyInput?.();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); });
    window.addEventListener('gamepadconnected', () => this.onAnyInput?.());
  }

  private any(codes: string[]) { for (const c of codes) if (this.keys.has(c) || this.fresh.has(c)) return true; return false; }
  /** call at the end of each frame: quick taps count as held for one frame, with 1-frame release before repeating the same key */
  endFrame() {
    this.fresh.clear();
    this.cooldownTaps.clear();
    for (const k of this.activeTaps) {
      (this.touch as any)[k] = this.held.has(k);
      if (!this.held.has(k)) this.cooldownTaps.add(k);
    }
    this.activeTaps.clear();
    if (this.taps.length) {
      const rem: (keyof Controls)[] = [];
      for (const k of this.taps) {
        // Don't fire left & right on the same frame, and wait 1 frame if the same key just released
        const opposite = k === 'left' ? 'right' : k === 'right' ? 'left' : null;
        if (!this.activeTaps.has(k) && !this.cooldownTaps.has(k) && !(opposite && (this.activeTaps.has(opposite) || this.cooldownTaps.has(opposite)))) {
          this.activeTaps.add(k);
          (this.touch as any)[k] = true;
        } else {
          rem.push(k);
        }
      }
      this.taps = rem;
    }
  }
  /** buttons currently held on screen */
  held = new Set<keyof Controls>();

  kbControls(map: Map): Controls {
    const c = emptyControls();
    for (const k in map) (c as any)[k] = this.any((map as any)[k]);
    return c;
  }

  private padButtons(i: number): Record<string, boolean> | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads[i];
    if (!p || !p.connected) return null;
    const b = (n: number) => !!p.buttons[n] && (p.buttons[n].pressed || p.buttons[n].value > 0.5);
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    return {
      a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), lt: b(6), rt: b(7), select: b(8), start: b(9),
      up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.5, right: b(15) || ax > 0.5,
      dup: b(12),
    };
  }

  padControls(i: number): Controls {
    const s = this.padButtons(i);
    const c = emptyControls();
    if (!s) return c;
    c.left = s.left; c.right = s.right; c.soft = s.down; c.hard = s.dup;
    c.cw = s.a || s.rt; c.ccw = s.b || s.lt; c.hold = s.lb || s.rb || s.x; c.super = s.y;
    return c;
  }

  controlsFor(src: SourceId | 'solo'): Controls {
    if (src === 'solo') {
      const c = this.kbControls(SOLO);
      for (let i = 0; i < 4; i++) merge(c, this.padControls(i));
      merge(c, this.touch);
      return c;
    }
    if (src === 'kb1') return this.kbControls(KB1);
    if (src === 'kb2') return this.kbControls(KB2);
    if (src.startsWith('pad')) return this.padControls(+src[3]);
    if (src === 'touch') return { ...this.touch };
    return emptyControls();
  }

  /** call once per frame */
  poll(dt: number) {
    this.navEvents = [];
    const states: [SourceId, Record<NavAction, boolean>][] = [];
    const kbState = (m: Record<NavAction, string[]>) => {
      const r: any = {};
      for (const k in m) r[k] = this.any((m as any)[k]);
      return r as Record<NavAction, boolean>;
    };
    states.push(['kb1', kbState(NAV_KB1)]);
    states.push(['kb2', kbState(NAV_KB2)]);
    for (let i = 0; i < 4; i++) {
      const s = this.padButtons(i);
      this.padConnected[i] = !!s;
      if (!s) continue;
      const prev = this.padPrev[i] || {};
      for (const k in s) if (s[k] && !prev[k]) { this.anyPressed = true; this.onAnyInput?.(); }
      this.padPrev[i] = s;
      states.push([('pad' + i) as SourceId, { up: s.up, down: s.down, left: s.left, right: s.right, confirm: s.a || s.start, back: s.b, pause: s.start }]);
    }
    for (const [src, st] of states) {
      for (const a in st) {
        const key = src + ':' + a;
        if ((st as any)[a]) {
          const h = this.navHeld[key];
          if (h === undefined) { this.navHeld[key] = 0; this.navEvents.push({ src, a: a as NavAction }); this.lastSource = src; }
          else {
            const nh = h + dt;
            const rep = a === 'up' || a === 'down' || a === 'left' || a === 'right';
            if (rep && nh > 380 && Math.floor((nh - 380) / 95) !== Math.floor((h - 380) / 95)) this.navEvents.push({ src, a: a as NavAction });
            this.navHeld[key] = nh;
          }
        } else delete this.navHeld[key];
      }
    }
  }

  pressedNav(a: NavAction, src?: SourceId): NavEvent | undefined {
    return this.navEvents.find((e) => e.a === a && (!src || e.src === src));
  }
}

function merge(a: Controls, b: Controls) { for (const k in b) if ((b as any)[k]) (a as any)[k] = true; }

export const input = new Input();
