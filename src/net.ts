// Online play over the artifact "room" capability. Everything travels as presence
// (absolute state, latest wins), so dropped packets never desync the match.
import type { RemoteState } from './battle';
import type { CharId } from './assets';

type Peer = { peer: string; isMe: boolean; sameTab: boolean; presence: Record<string, any>; kind: string };

export type NetStatus = 'off' | 'connecting' | 'unavailable' | 'lobby' | 'searching' | 'paired' | 'lost';

export interface DuelInfo {
  host: boolean; myPeer: string; theirPeer: string;
}

export interface DuelPresence {
  app: 'bc'; ph: 'select' | 'play' | 'post';
  ch?: CharId; rdy?: boolean; nick?: string;
  go?: { rd: number; seed: number; m: number; hc: CharId; gc: CharId }; // host only
  res?: { rd: number; w: 'h' | 'g' | 'd'; m: number }; // host only
  seen?: number; // last round result applied
  m?: number; // match id
  g?: RemoteState;
  again?: number; // wants rematch for match id
}

export class Net {
  room: any = null;
  duel: any = null;
  status: NetStatus = 'off';
  info: DuelInfo | null = null;
  lobbyCount = 0;
  theirs: DuelPresence | null = null;
  mine: DuelPresence = { app: 'bc', ph: 'select' };
  onStatus: ((s: NetStatus) => void) | null = null;
  onDuel: ((p: DuelPresence) => void) | null = null;
  private unsubs: (() => void)[] = [];
  private duelUnsubs: (() => void)[] = [];
  private searching = false;
  private want: string | null = null;
  myPeer = '';

  private set(s: NetStatus) { this.status = s; this.onStatus?.(s); }

  async connect(): Promise<boolean> {
    if (this.room) return true;
    this.set('connecting');
    const c = (window as any).claude;
    if (!c || typeof c.use !== 'function') { this.set('unavailable'); return false; }
    let room: any = null;
    try { room = await c.use('room'); } catch { room = null; }
    if (!room) { this.set('unavailable'); return false; }
    this.room = room;
    this.unsubs.push(room.onPeers(() => this.lobbyTick(), () => this.set('unavailable')));
    await room.presence({ app: 'bc', st: 'idle' }).catch(() => {});
    this.set('lobby');
    return true;
  }

  /** start/stop looking for an opponent */
  async search(on: boolean, ch: CharId) {
    if (!this.room) return;
    this.searching = on;
    this.want = null;
    await this.room.presence({ app: 'bc', st: on ? 'looking' : 'idle', ch, want: null }).catch(() => {});
    this.set(on ? 'searching' : 'lobby');
    this.lobbyTick();
  }

  private lobbyTick() {
    if (!this.room) return;
    const peers: Peer[] = this.room.peers();
    const me = peers.find((p) => p.sameTab);
    if (me) this.myPeer = me.peer;
    const others = peers.filter((p) => !p.sameTab && p.kind === 'viewer' && p.presence && p.presence.app === 'bc');
    this.lobbyCount = others.length;
    this.onStatus?.(this.status);
    if (!this.searching || !this.myPeer || this.duel) return;
    const looking = others.filter((p) => p.presence.st === 'looking').map((p) => p.peer).sort();
    // someone who already wants us?
    const wantsMe = others.find((p) => (p.presence.st === 'looking' || p.presence.st === 'playing') && p.presence.want === this.myPeer);
    let target = wantsMe ? wantsMe.peer : looking[0];
    if (!target) { if (this.want) { this.want = null; this.room.presence({ want: null }).catch(() => {}); } return; }
    if (this.want !== target) { this.want = target; this.room.presence({ want: target }).catch(() => {}); }
    const tp = others.find((p) => p.peer === target);
    if (tp && tp.presence.want === this.myPeer) this.enterDuel(target);
    else if (wantsMe && wantsMe.presence.st === 'playing') this.enterDuel(wantsMe.peer);
  }

  private entering = false;
  private async enterDuel(other: string) {
    if (this.duel || this.entering) return;
    this.entering = true;
    const pair = [this.myPeer, other].sort();
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
    const name = 'duel-' + clean(pair[0]) + '-' + clean(pair[1]);
    try {
      this.duel = await this.room.join(name);
    } catch { this.duel = null; this.entering = false; return; }
    this.entering = false;
    this.searching = false;
    this.info = { host: this.myPeer === pair[0], myPeer: this.myPeer, theirPeer: other };
    this.mine = { app: 'bc', ph: 'select', m: 1 };
    // keep advertising who we paired with so the other side can follow us in
    await this.room.presence({ st: 'playing', want: other }).catch(() => {});
    this.duelUnsubs.push(this.duel.onPeers((ch: any) => {
      const ps: Peer[] = this.duel.peers();
      const them = ps.find((p) => p.peer === other);
      if (ch.left && ch.left.some((p: Peer) => p.peer === other)) { this.leaveDuel(true); return; }
      if (them && them.presence && them.presence.app === 'bc') {
        this.theirs = them.presence as DuelPresence;
        this.onDuel?.(this.theirs);
      }
    }, () => this.leaveDuel(true)));
    await this.duel.presence(this.mine).catch(() => {});
    this.set('paired');
  }

  /** merge into my duel presence */
  pub(patch: Partial<DuelPresence>) {
    Object.assign(this.mine, patch);
    for (const k in patch) if ((patch as any)[k] === undefined) delete (this.mine as any)[k];
    if (!this.duel) return;
    const send: any = {};
    for (const k in patch) send[k] = (patch as any)[k] === undefined ? null : (patch as any)[k];
    this.duel.presence(send).catch(() => {});
  }

  async leaveDuel(lost = false) {
    for (const u of this.duelUnsubs) u();
    this.duelUnsubs = [];
    const d = this.duel; this.duel = null;
    this.theirs = null; this.info = null;
    if (d) await d.leave().catch(() => {});
    if (this.room) await this.room.presence({ st: 'idle', want: null }).catch(() => {});
    this.searching = false;
    this.set(lost ? 'lost' : 'lobby');
  }
}

export const net = new Net();
