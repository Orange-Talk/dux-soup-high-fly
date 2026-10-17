// Standalone online play: direct peer-to-peer over WebRTC using the free PeerJS service.
// Same surface as Net (net.ts) so the match logic is shared.
import { Peer, DataConnection } from 'peerjs';
import type { DuelInfo, DuelPresence, NetStatus } from './net';

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'blockclashduel-';
declare const __PEER_HOST__: string;

function peerOpts(): any {
  if (typeof __PEER_HOST__ !== 'undefined' && __PEER_HOST__) {
    const [host, port] = __PEER_HOST__.split(':');
    return { host, port: +port, path: '/', secure: false, debug: 0 };
  }
  return { debug: 0 };
}

export type JoinError = 'notfound' | 'network' | null;

export class PeerNet {
  status: NetStatus = 'off';
  info: DuelInfo | null = null;
  theirs: DuelPresence | null = null;
  mine: DuelPresence = { app: 'bc', ph: 'select' };
  lobbyCount = 0;
  code = '';
  error: JoinError = null;
  onStatus: ((s: NetStatus) => void) | null = null;
  onDuel: ((p: DuelPresence) => void) | null = null;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  get duel() { return this.conn; }

  private set(s: NetStatus) { this.status = s; this.onStatus?.(s); }

  async connect(): Promise<boolean> { return true; }

  /** create a room and wait for the other player */
  host(): Promise<string> {
    this.reset();
    return new Promise((resolve) => {
      const attempt = (tries: number) => {
        let c = '';
        for (let i = 0; i < 4; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)];
        const p = new Peer(PREFIX + c.toLowerCase(), peerOpts());
        this.peer = p;
        p.on('open', () => { this.code = c; this.set('searching'); resolve(c); });
        p.on('connection', (conn) => {
          if (this.conn) { conn.on('open', () => conn.close()); return; }
          this.setup(conn, true);
        });
        p.on('error', (e: any) => {
          if (e && e.type === 'unavailable-id' && tries < 5) { p.destroy(); attempt(tries + 1); return; }
          if (!this.conn) { this.error = 'network'; this.set('unavailable'); resolve(''); }
        });
        p.on('disconnected', () => { if (!this.conn) { try { p.reconnect(); } catch { /* ignore */ } } });
      };
      attempt(0);
    });
  }

  /** join a room by its 4-letter code */
  join(code: string) {
    this.reset();
    this.code = code.toUpperCase();
    this.set('connecting');
    const p = new Peer(peerOpts());
    this.peer = p;
    let done = false;
    p.on('open', () => {
      const conn = p.connect(PREFIX + code.toLowerCase(), { reliable: true });
      this.setup(conn, false);
      setTimeout(() => { if (!this.conn && !done) { done = true; this.error = 'notfound'; this.set('unavailable'); } }, 12000);
    });
    p.on('error', (e: any) => {
      if (this.conn) return;
      done = true;
      this.error = e && e.type === 'peer-unavailable' ? 'notfound' : 'network';
      this.set('unavailable');
    });
  }

  private setup(conn: DataConnection, host: boolean) {
    conn.on('open', () => {
      this.conn = conn;
      this.theirs = null;
      this.mine = { app: 'bc', ph: 'select', m: 1 };
      this.info = { host, myPeer: host ? 'h' : 'g', theirPeer: host ? 'g' : 'h' };
      conn.send({ t: 'full', p: this.mine });
      this.set('paired');
    });
    conn.on('data', (d: any) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'full') this.theirs = { ...(d.p || {}) };
      else if (d.t === 'p') {
        const t: any = this.theirs || { app: 'bc', ph: 'select' };
        for (const k in d.p) { if (d.p[k] === null) delete t[k]; else t[k] = d.p[k]; }
        this.theirs = t;
      }
      if (this.theirs) this.onDuel?.(this.theirs);
    });
    conn.on('close', () => { if (this.conn === conn) this.leaveDuel(true); });
    conn.on('error', () => { if (this.conn === conn) this.leaveDuel(true); });
  }

  pub(patch: Partial<DuelPresence>) {
    Object.assign(this.mine, patch);
    for (const k in patch) if ((patch as any)[k] === undefined) delete (this.mine as any)[k];
    if (!this.conn || !this.conn.open) return;
    const send: any = {};
    for (const k in patch) send[k] = (patch as any)[k] === undefined ? null : (patch as any)[k];
    try { this.conn.send({ t: 'p', p: send }); } catch { /* channel closing */ }
  }

  async search(on: boolean) { if (!on) this.reset(); }

  private reset() {
    const c = this.conn; this.conn = null;
    if (c) try { c.close(); } catch { /* ignore */ }
    if (this.peer) try { this.peer.destroy(); } catch { /* ignore */ }
    this.peer = null; this.info = null; this.theirs = null; this.error = null;
  }

  async leaveDuel(lost = false) {
    const wasPaired = !!this.conn;
    this.reset();
    this.set(lost && wasPaired ? 'lost' : 'lobby');
  }
}
