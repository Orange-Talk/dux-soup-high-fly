// Standalone online play over public MQTT brokers (WebSocket). Each player publishes its
// whole state as a retained message, so the room survives app switching, reconnects and a
// broker going down (we talk to two brokers at once and keep whichever copy is newest).
import type { DuelInfo, DuelPresence, NetStatus } from './net';

declare const __MQTT_URLS__: string;
const URLS: string[] = (typeof __MQTT_URLS__ !== 'undefined' && __MQTT_URLS__ ? __MQTT_URLS__ : 'wss://broker.emqx.io:8084/mqtt,wss://broker.hivemq.com:8884/mqtt').split(',');
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOT = 'blockclashduel/v2/';
const enc = new TextEncoder();
const dec = new TextDecoder();

function lenBytes(n: number): number[] {
  const out: number[] = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
  return out;
}
function str(s: string): number[] { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function packet(type: number, body: number[] | Uint8Array): Uint8Array {
  const b = Array.from(body);
  return new Uint8Array([type, ...lenBytes(b.length), ...b]);
}

type Msg = (topic: string, payload: string, retained: boolean) => void;

/** One tiny MQTT 3.1.1 client over WebSocket with auto-reconnect. */
class Link {
  ws: WebSocket | null = null;
  open = false;
  private buf = new Uint8Array(0);
  private subs: string[] = [];
  private pid = 1;
  private ping: any = null;
  private retry: any = null;
  private dead = false;
  private backoff = 800;
  onOpen: (() => void) | null = null;
  constructor(public url: string, public onMsg: Msg) { this.connect(); }

  connect() {
    if (this.dead) return;
    clearTimeout(this.retry);
    try { this.ws = new WebSocket(this.url, ['mqtt']); } catch { this.schedule(); return; }
    const ws = this.ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const id = 'bcd' + Math.random().toString(36).slice(2, 12);
      const flags = 0x02; // clean session
      ws.send(packet(0x10, [...str('MQTT'), 4, flags, 0, 30, ...str(id)]));
    };
    ws.onmessage = (ev) => this.data(new Uint8Array(ev.data as ArrayBuffer));
    ws.onclose = () => { this.open = false; clearInterval(this.ping); if (this.ws === ws) this.schedule(); };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }
  private schedule() {
    if (this.dead) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(8000, this.backoff * 1.6);
  }
  /** reconnect right away (page came back to the foreground) */
  kick() { if (!this.open && !this.dead) { this.backoff = 800; try { this.ws?.close(); } catch { /* ignore */ } this.connect(); } }

  private data(chunk: Uint8Array) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    let i = 0;
    while (i < b.length) {
      if (b.length - i < 2) break;
      let mult = 1, len = 0, j = i + 1, byte = 0;
      do { if (j >= b.length) { j = -1; break; } byte = b[j++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
      if (j < 0 || j + len > b.length) break;
      this.handle(b[i], b.subarray(j, j + len));
      i = j + len;
    }
    this.buf = b.slice(i);
  }
  private handle(h: number, body: Uint8Array) {
    const type = h >> 4;
    if (type === 2) { // CONNACK
      if (body[1] !== 0) { try { this.ws?.close(); } catch { /* ignore */ } return; }
      this.open = true; this.backoff = 800;
      clearInterval(this.ping);
      this.ping = setInterval(() => { try { this.ws?.send(new Uint8Array([0xc0, 0])); } catch { /* ignore */ } }, 20000);
      for (const t of this.subs) this.sendSub(t);
      this.onOpen?.();
    } else if (type === 3) { // PUBLISH
      const qos = (h >> 1) & 3, retained = !!(h & 1);
      const tl = (body[0] << 8) | body[1];
      const topic = dec.decode(body.subarray(2, 2 + tl));
      const start = 2 + tl + (qos ? 2 : 0);
      this.onMsg(topic, dec.decode(body.subarray(start)), retained);
    }
  }
  private sendSub(t: string) {
    const id = this.pid++ & 0xffff || 1;
    try { this.ws?.send(packet(0x82, [id >> 8, id & 255, ...str(t), 0])); } catch { /* ignore */ }
  }
  subscribe(t: string) { if (!this.subs.includes(t)) this.subs.push(t); if (this.open) this.sendSub(t); }
  publish(t: string, payload: string, retain: boolean) {
    if (!this.open || !this.ws) return;
    const body = [...str(t), ...enc.encode(payload)];
    try { this.ws.send(packet(0x30 | (retain ? 1 : 0), body)); } catch { /* ignore */ }
  }
  close() { this.dead = true; clearInterval(this.ping); clearTimeout(this.retry); try { this.ws?.close(); } catch { /* ignore */ } this.open = false; }
}

export type JoinError = 'notfound' | 'network' | null;
interface Wire { sid: string; seq: number; ts: number; p: DuelPresence | null; }

export class MqttNet {
  status: NetStatus = 'off';
  info: DuelInfo | null = null;
  theirs: DuelPresence | null = null;
  mine: DuelPresence = { app: 'bc', ph: 'select' };
  lobbyCount = 0;
  code = '';
  error: JoinError = null;
  onStatus: ((s: NetStatus) => void) | null = null;
  onDuel: ((p: DuelPresence) => void) | null = null;
  onAway: ((away: boolean) => void) | null = null;
  /** true while the rival has gone quiet (app switched, signal drop) */
  rivalAway = false;
  private links: Link[] = [];
  private role: 'h' | 'g' | null = null;
  private sid = Math.random().toString(36).slice(2, 10);
  private seq = 0;
  private theirSeq = -1;
  private theirSid = '';
  private lastHeard = 0;
  private sendTimer: any = null;
  private lastSend = 0;
  private beat: any = null;
  private joinTimer: any = null;
  private paired = false;
  get duel(): MqttNet | null { return this.paired ? this : null; }

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { for (const l of this.links) l.kick(); this.flush(); }
    });
    window.addEventListener('online', () => { for (const l of this.links) l.kick(); });
  }

  private set(s: NetStatus) { this.status = s; this.onStatus?.(s); }
  async connect(): Promise<boolean> { return true; }

  private topic(role: 'h' | 'g') { return ROOT + this.code + '/' + role; }

  private start(code: string, role: 'h' | 'g') {
    this.reset();
    this.code = code; this.role = role;
    this.paired = false; this.theirs = null; this.theirSeq = -1; this.theirSid = ''; this.lastHeard = 0;
    this.mine = { app: 'bc', ph: 'select', m: 1 };
    const other = role === 'h' ? 'g' : 'h';
    const onMsg: Msg = (topic, payload, retained) => {
      if (topic !== this.topic(other)) return;
      if (!payload) { // rival cleared their slot: they left
        if (this.paired) this.leaveDuel(true);
        return;
      }
      let w: Wire;
      try { w = JSON.parse(payload); } catch { return; }
      if (!w || !w.p || w.p.app !== 'bc') return;
      // a stale room left behind from an earlier session
      if (retained && Date.now() - w.ts > 30 * 60 * 1000) return;
      if (w.sid !== this.theirSid) { this.theirSid = w.sid; this.theirSeq = -1; }
      if (w.seq <= this.theirSeq) return;
      this.theirSeq = w.seq;
      if (!retained || Date.now() - w.ts < 20000) { this.lastHeard = Date.now(); if (this.rivalAway) { this.rivalAway = false; this.onAway?.(false); } }
      this.theirs = w.p;
      this.found();
      this.onDuel?.(this.theirs);
    };
    this.links = URLS.map((u) => {
      const l = new Link(u, onMsg);
      l.onOpen = () => { l.subscribe(this.topic(other)); this.flush(true); };
      return l;
    });
    clearInterval(this.beat);
    this.beat = setInterval(() => {
      this.flush(true);
      if (this.paired && this.lastHeard) {
        const quiet = Date.now() - this.lastHeard;
        if (quiet > 12000 && !this.rivalAway) { this.rivalAway = true; this.onAway?.(true); }
        if (quiet > 90000) this.leaveDuel(true);
      }
    }, 1500);
  }

  private found() {
    if (this.paired) return;
    this.paired = true;
    clearTimeout(this.joinTimer);
    this.info = { host: this.role === 'h', myPeer: this.role!, theirPeer: this.role === 'h' ? 'g' : 'h' };
    this.set('paired');
  }

  /** create a room and wait for the other player */
  host(): Promise<string> {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    this.start(c, 'h');
    this.error = null;
    return new Promise((resolve) => {
      const t0 = Date.now();
      const check = () => {
        if (this.links.some((l) => l.open)) { this.set('searching'); resolve(c); return; }
        if (Date.now() - t0 > 10000) { this.error = 'network'; this.set('unavailable'); resolve(''); return; }
        setTimeout(check, 150);
      };
      check();
    });
  }

  /** join a room by its 4-letter code */
  join(code: string) {
    this.start(code.toUpperCase(), 'g');
    this.error = null;
    this.set('connecting');
    clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => {
      if (this.paired) return;
      this.error = this.links.some((l) => l.open) ? 'notfound' : 'network';
      this.set('unavailable');
    }, 15000);
  }

  pub(patch: Partial<DuelPresence>) {
    Object.assign(this.mine, patch);
    for (const k in patch) if ((patch as any)[k] === undefined) delete (this.mine as any)[k];
    this.flush();
  }

  /** publish my whole state (throttled to ~15 a second) */
  private flush(force = false) {
    if (!this.role) return;
    const now = Date.now();
    const gap = now - this.lastSend;
    if (!force && gap < 100) {
      if (!this.sendTimer) this.sendTimer = setTimeout(() => { this.sendTimer = null; this.flush(true); }, 100 - gap);
      return;
    }
    this.lastSend = now;
    const w: Wire = { sid: this.sid, seq: ++this.seq, ts: now, p: this.mine };
    const s = JSON.stringify(w);
    for (const l of this.links) l.publish(this.topic(this.role), s, true);
  }

  async search(on: boolean) { if (!on) this.reset(); }

  private reset() {
    clearInterval(this.beat); clearTimeout(this.sendTimer); clearTimeout(this.joinTimer);
    this.sendTimer = null;
    if (this.role) for (const l of this.links) l.publish(this.topic(this.role), '', true); // clear my retained slot
    const ls = this.links; this.links = [];
    setTimeout(() => ls.forEach((l) => l.close()), 300);
    this.role = null; this.paired = false; this.info = null; this.theirs = null; this.rivalAway = false;
  }

  async leaveDuel(lost = false) {
    const was = this.paired;
    this.reset();
    this.set(lost && was ? 'lost' : 'lobby');
  }
}
