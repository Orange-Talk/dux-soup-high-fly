import { loadAll, art, CharId, URLS } from './assets';
import { audio } from './audio';
import { input, NavEvent, SourceId } from './input';
import { Battle, SideCfg } from './battle';
import { Fighter } from './fighter';
import { FX } from './fx';
import { CHARS, charColor } from './chars';
import { settings, record, save } from './settings';
import { W, H, setDpr, FONT_D, block, PCOL } from './render';
import { net as roomNet, DuelPresence } from './net';
import { PeerNet } from './peernet';
declare const __STANDALONE__: boolean;
const STANDALONE = typeof __STANDALONE__ !== 'undefined' && __STANDALONE__;
const peerNet = new PeerNet();
const net: any = STANDALONE ? peerNet : roomNet;
let pendingJoin = '';
import { CpuController, Difficulty } from './ai';
import { PIECES, SHAPES } from './engine';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const cv = $<HTMLCanvasElement>('#cv');
const ctx = cv.getContext('2d')!;
const stage = $('#stage');

// ---------------------------------------------------------------- scaling
let scale = 1;
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight;
  scale = Math.min(vw / W, vh / H);
  stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
  stage.style.transformOrigin = '50% 50%';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const k = Math.max(1, scale * dpr);
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  setDpr(k);
}
stage.style.left = '50%'; stage.style.top = '50%';
window.addEventListener('resize', fit);
fit();

// ---------------------------------------------------------------- screens
type ScreenId = 'loading' | 'title' | 'menu' | 'cpu' | 'select' | 'vs' | 'battle' | 'pause' | 'results' | 'settings' | 'howto' | 'online';
let screen: ScreenId = 'loading';
const handlers: Partial<Record<ScreenId, (e: NavEvent) => void>> = {};
const BACKABLE: ScreenId[] = ['cpu', 'select', 'howto', 'online'];
$('#backbtn').addEventListener('click', () => { const h = handlers[screen]; if (h) h({ src: 'mouse', a: 'back' }); });
function show(id: ScreenId, keepBattle = false) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('on'));
  $('#s-' + id).classList.add('on');
  if (keepBattle && id !== 'battle') $('#s-battle').classList.add('on');
  screen = id;
  $('#pausebtn').classList.toggle('on', id === 'battle' && !!battle);
  $('#backbtn').classList.toggle('on', BACKABLE.includes(id));
  updateTouch();
}
let toastT: any;
function toast(msg: string) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

// generic vertical menu
interface MItem { t: string; s?: string; act: () => void; dis?: boolean; }
class Menu {
  idx = 0; els: HTMLElement[] = [];
  constructor(public root: HTMLElement, public items: MItem[], public horizontal = false) { this.render(); }
  render() {
    this.root.innerHTML = '';
    this.els = this.items.map((it, i) => {
      const b = document.createElement('button');
      b.className = 'mi' + (it.dis ? ' dis' : '');
      b.innerHTML = `<span class="t">${it.t}</span>${it.s ? `<span class="s">${it.s}</span>` : ''}`;
      b.addEventListener('pointerenter', () => { if (this.idx !== i) { this.idx = i; this.paint(); audio.play('menuMove'); } });
      b.addEventListener('click', () => { this.idx = i; this.paint(); this.fire(); });
      this.root.appendChild(b);
      return b;
    });
    this.paint();
  }
  paint() { this.els.forEach((e, i) => e.classList.toggle('sel', i === this.idx)); }
  fire() { const it = this.items[this.idx]; if (it.dis) { audio.play('menuBack'); return; } audio.play('menuSelect'); it.act(); }
  nav(e: NavEvent): boolean {
    const prev = this.horizontal ? 'left' : 'up', next = this.horizontal ? 'right' : 'down';
    if (e.a === prev) { this.idx = (this.idx + this.items.length - 1) % this.items.length; this.paint(); audio.play('menuMove'); return true; }
    if (e.a === next) { this.idx = (this.idx + 1) % this.items.length; this.paint(); audio.play('menuMove'); return true; }
    if (e.a === 'confirm') { this.fire(); return true; }
    return false;
  }
}

// ---------------------------------------------------------------- attract scene (menus)
const menuFx = new FX();
let attract: Fighter[] = [];
let attractT = 0, sparT = 2.5;
let bgMode: 'title' | 'menu' | 'select' | 'battle' = 'title';
let time = 0;
function setupAttract(mode: 'title' | 'menu') {
  bgMode = mode;
  const xs = mode === 'title' ? [330, 950] : [870, 1070];
  const a = new Fighter('nong', false, 0, xs[0], 668);
  const b = new Fighter('nang', false, 1, xs[1], 668);
  a.scale = b.scale = mode === 'title' ? 1.35 : 1.25;
  a.set('idle'); b.set('idle');
  a.onImpact = () => { b.set('hurt'); menuFx.burst(b.bodyPoint[0], b.bodyPoint[1], 14, CHARS.nong.color, 300); audio.play('hit'); };
  b.onImpact = () => { a.set('hurt'); menuFx.burst(a.bodyPoint[0], a.bodyPoint[1], 14, CHARS.nang.color, 300); audio.play('hit'); };
  attract = [a, b];
}

function drawBg(c: CanvasRenderingContext2D, t: number, dark: number) {
  if (!art.bg) { c.fillStyle = '#0b0a20'; c.fillRect(0, 0, W, H); return; }
  const z = 1.03 + Math.sin(t * 0.07) * 0.015;
  const iw = art.bg.width, ih = art.bg.height;
  const s = Math.max(W / iw, H / ih) * z;
  const dw = iw * s, dh = ih * s;
  c.drawImage(art.bg, (W - dw) / 2 + Math.sin(t * 0.05) * 8, (H - dh) / 2, dw, dh);
  c.fillStyle = `rgba(6,5,22,${dark})`; c.fillRect(0, 0, W, H);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(6,5,22,0.55)'); g.addColorStop(0.35, 'rgba(6,5,22,0)'); g.addColorStop(0.8, 'rgba(6,5,22,0)'); g.addColorStop(1, 'rgba(6,5,22,0.6)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // drifting embers
  for (let i = 0; i < 26; i++) {
    const sx = (i * 197.3) % W, sp = 18 + (i % 7) * 7;
    const y = H - ((t * sp + i * 83) % (H + 40));
    const x = sx + Math.sin(t * 0.8 + i) * 18;
    const a = 0.35 + 0.35 * Math.sin(t * 2 + i);
    c.fillStyle = i % 3 ? `rgba(255,180,90,${a})` : `rgba(140,200,255,${a})`;
    c.beginPath(); c.arc(x, y, 1.2 + (i % 3) * 0.7, 0, 6.283); c.fill();
  }
}

// falling decorative pieces behind the title
const deco: { t: string; x: number; y: number; v: number; r: number; vr: number; s: number }[] = [];
function drawDeco(c: CanvasRenderingContext2D, dt: number) {
  if (deco.length < 14 && Math.random() < 0.05) deco.push({ t: PIECES[Math.floor(Math.random() * 7)], x: 40 + Math.random() * (W - 80), y: -80, v: 40 + Math.random() * 60, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.8, s: 16 + Math.random() * 14 });
  for (let i = deco.length - 1; i >= 0; i--) {
    const d = deco[i];
    d.y += d.v * dt; d.r += d.vr * dt;
    if (d.y > H + 80) { deco.splice(i, 1); continue; }
    c.save(); c.globalAlpha = 0.28; c.translate(d.x, d.y); c.rotate(d.r);
    const id = PIECES.indexOf(d.t as any) + 1;
    for (const [x, y] of SHAPES[d.t as keyof typeof SHAPES][0]) c.drawImage(block(id, d.s), (x - 1.5) * d.s, (y - 1) * d.s, d.s, d.s);
    c.restore();
  }
}

// ---------------------------------------------------------------- state
type Mode = 'versus' | 'cpu' | 'online';
let mode: Mode = 'versus';
let cpuDiff: Difficulty = 'normal';
let battle: Battle | null = null;
let lastCfg: [SideCfg, SideCfg] | null = null;
const altPortrait: Record<string, string> = {};

// ---------------------------------------------------------------- title / main menu
function goTitle() {
  setupAttract('title');
  audio.musicMode('menu');
  show('title');
}
handlers.title = (e) => { if (e.a === 'confirm' || e.a === 'pause') { audio.play('menuSelect'); goMenu(); } };
$('#s-title').addEventListener('click', () => { if (screen === 'title') { audio.unlock(); audio.play('menuSelect'); goMenu(); } });

let mainMenu: Menu;
function goMenu() {
  if (battle) { battle = null; }
  if (net.duel) net.leaveDuel();
  setupAttract('menu');
  audio.musicMode('menu');
  audio.musicRate(1);
  renderRival();
  show('menu');
  if (pendingJoin) { const c = pendingJoin; pendingJoin = ''; mode = 'online'; show('online'); standaloneJoin(c); }
}
function renderRival() {
  const r = record.versus;
  const a = r.nong || 0, b = r.nang || 0;
  const lead = a === b ? (a ? 'Dead even. Settle it.' : 'No matches yet. Who draws first blood?') : (a > b ? 'NONG' : 'NANG') + ' leads by ' + Math.abs(a - b);
  $('#rival').innerHTML = `<h4>HOUSE RIVALRY · LOCAL VERSUS</h4>
    <div class="row"><span class="nm" style="color:${CHARS.nong.color}">NONG</span><span class="sc">${a}</span><span class="sep">–</span><span class="sc">${b}</span><span class="nm" style="color:${CHARS.nang.color}">NANG</span></div>
    <div class="lead">${lead}</div>`;
}
function buildMainMenu() {
  mainMenu = new Menu($('#mainmenu'), [
    { t: 'VERSUS', s: 'Two players on this device', act: () => { mode = 'versus'; goSelect(); } },
    { t: 'VS CPU', s: 'Practice against the computer', act: () => { mode = 'cpu'; goCpu(); } },
    { t: 'ONLINE', s: 'Each of you on your own device', act: () => { mode = 'online'; goOnline(); } },
    { t: 'HOW TO PLAY', s: 'Controls, attacks and supers', act: () => goHowto() },
    { t: 'SETTINGS', s: 'Sound, handling and rules', act: () => goSettings('menu') },
  ]);
}
handlers.menu = (e) => { if (!mainMenu.nav(e) && e.a === 'back') { audio.play('menuBack'); goTitle(); } };

// ---------------------------------------------------------------- cpu difficulty
const DIFFS: { id: Difficulty; t: string; d: string; n: number; c: string }[] = [
  { id: 'easy', t: 'ROOKIE', d: 'Slow, makes mistakes, never holds a piece. Good for learning the ropes.', n: 1, c: '#4ce46c' },
  { id: 'normal', t: 'BRAWLER', d: 'Builds for quads and uses hold. A fair fight for most players.', n: 2, c: '#2fd9ff' },
  { id: 'hard', t: 'CHAMPION', d: 'Plans two pieces ahead and keeps the pressure on.', n: 3, c: '#ff9b2f' },
  { id: 'master', t: 'LEGEND', d: 'Inhumanly fast. You will need T-spins and nerves.', n: 4, c: '#ff4d61' },
];
let cpuIdx = 1;
function goCpu() {
  const root = $('#cpucards');
  root.innerHTML = DIFFS.map((d, i) => `<button class="card" data-i="${i}" style="--c:${d.c}"><div class="lv">LEVEL ${d.n}</div><div class="t" style="color:${d.c}">${d.t}</div><p>${d.d}</p><div class="pips">${[1, 2, 3, 4].map((k) => `<i class="${k <= d.n ? 'on' : ''}"></i>`).join('')}</div></button>`).join('');
  root.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('pointerenter', () => { cpuIdx = +(el as HTMLElement).dataset.i!; paintCpu(); });
    el.addEventListener('click', () => { cpuIdx = +(el as HTMLElement).dataset.i!; pickCpu(); });
  });
  paintCpu();
  show('cpu');
}
function paintCpu() { $('#cpucards').querySelectorAll('.card').forEach((el, i) => el.classList.toggle('sel', i === cpuIdx)); }
function pickCpu() { audio.play('menuSelect'); cpuDiff = DIFFS[cpuIdx].id; goSelect(); }
handlers.cpu = (e) => {
  if (e.a === 'left' || e.a === 'up') { cpuIdx = (cpuIdx + 3) % 4; paintCpu(); audio.play('menuMove'); }
  else if (e.a === 'right' || e.a === 'down') { cpuIdx = (cpuIdx + 1) % 4; paintCpu(); audio.play('menuMove'); }
  else if (e.a === 'confirm') pickCpu();
  else if (e.a === 'back') { audio.play('menuBack'); goMenu(); }
};

// ---------------------------------------------------------------- character select
interface Slot { src: SourceId | 'solo' | null; cur: number; locked: boolean; char: CharId; }
const TILE_CHARS: (CharId | 'random')[] = ['nong', 'random', 'nang'];
let slots: [Slot, Slot] = [{ src: null, cur: 0, locked: false, char: 'nong' }, { src: null, cur: 2, locked: false, char: 'nang' }];
let selectDone = false;
let onlineOppChar: CharId | null = null;
let onlineOppReady = false;

function panelHtml(i: 0 | 1) {
  return `<div class="glow"></div><img class="por" alt=""><div class="info">
    <div class="tag"></div><div class="nm"></div><div class="ti"></div><div class="tl"></div>
    <div class="blk"><div class="k">SUPER MOVE</div><div class="v sup"></div><div class="d supd"></div></div>
    <div class="blk"><div class="k">GARBAGE STYLE</div><div class="v sty"></div><div class="d styd"></div></div>
    <div class="stats"></div></div>
    <div class="ready">READY!</div>
    <div class="join"><div class="big">PLAYER ${i + 1}</div><div class="sm"></div></div>`;
}

function goSelect() {
  selectDone = false;
  bgMode = 'select';
  slots = [{ src: null, cur: 0, locked: false, char: 'nong' }, { src: null, cur: 2, locked: false, char: 'nang' }];
  if (mode !== 'versus') slots[0].src = 'solo';
  $('#pan1').innerHTML = panelHtml(0);
  $('#pan2').innerHTML = panelHtml(1);
  const tiles = $('#tiles');
  const tileHtml = (c: CharId | 'random') => c === 'random'
    ? `<button class="tile rnd" data-c="random"><span class="tn">RANDOM</span><span class="cur c1">P1</span><span class="cur c2">P2</span></button>`
    : `<button class="tile" data-c="${c}"><img src="${c === 'nong' ? URLS.nongPortrait : URLS.nangPortrait}" alt=""><div><div class="tn" style="color:${CHARS[c].color}">${CHARS[c].name}</div><div class="ts">${CHARS[c].title.toUpperCase()}</div></div><span class="cur c1">P1</span><span class="cur c2">${mode === 'cpu' ? 'CPU' : 'P2'}</span></button>`;
  tiles.innerHTML = TILE_CHARS.map(tileHtml).join('');
  tiles.querySelectorAll('.tile').forEach((el, idx) => {
    el.addEventListener('click', () => {
      // mouse: drive the first unlocked slot
      let si = slots.findIndex((s) => !s.locked && (s.src || mode === 'versus'));
      if (mode !== 'versus') si = slots[0].locked ? -1 : 0;
      if (si < 0) return;
      const s = slots[si];
      if (!s.src) { s.src = si === 0 ? 'kb1' : 'kb2'; audio.play('join'); }
      s.cur = idx; paintSelect(); lockSlot(si as 0 | 1);
    });
  });
  $('#selsub').textContent = mode === 'versus' ? 'LOCAL VERSUS' : mode === 'cpu' ? 'VS CPU · ' + DIFFS.find((d) => d.id === cpuDiff)!.t : 'ONLINE DUEL';
  $('#selhint').innerHTML = mode === 'versus'
    ? 'P1 <b>A</b><b>D</b> move · <b>Space</b> pick &nbsp;·&nbsp; P2 <b>←</b><b>→</b> move · <b>Enter</b> pick &nbsp;·&nbsp; controllers: <b>Ⓐ</b> join &nbsp;·&nbsp; <b>Esc</b> back'
    : '<b>←</b><b>→</b> move · <b>Enter</b> or <b>Space</b> pick · <b>Esc</b> back';
  paintSelect();
  show('select');
}

function slotChar(s: Slot): CharId { const c = TILE_CHARS[s.cur]; return c === 'random' ? (s.char || 'nong') : c; }

function paintSelect() {
  const tiles = $('#tiles').querySelectorAll('.tile');
  tiles.forEach((el, i) => {
    el.classList.toggle('h1', !!slots[0].src && slots[0].cur === i);
    el.classList.toggle('h2', (!!slots[1].src || (mode === 'cpu' && slots[0].locked) || (mode === 'online' && onlineOppChar !== null)) && slots[1].cur === i);
  });
  for (const i of [0, 1] as const) {
    const s = slots[i];
    const pan = $(i === 0 ? '#pan1' : '#pan2');
    let c: CharId = TILE_CHARS[s.cur] === 'random' ? (i === 0 ? 'nong' : 'nang') : (TILE_CHARS[s.cur] as CharId);
    if (s.locked) c = s.char;
    const info = CHARS[c];
    const isAlt = i === 1 && slots[0].locked && slots[1].locked && slots[0].char === c && mode !== 'online';
    const col = charColor(c, isAlt);
    pan.style.setProperty('--c', col);
    pan.style.setProperty('--pc', i === 0 ? 'var(--p1)' : 'var(--p2)');
    const empty = mode === 'versus' ? !s.src : mode === 'online' && i === 1 ? onlineOppChar === null : false;
    pan.classList.toggle('empty', empty);
    pan.classList.toggle('locked', s.locked);
    const img = pan.querySelector('.por') as HTMLImageElement;
    const src = isAlt ? altPortrait[c] : c === 'nong' ? URLS.nongPortrait : URLS.nangPortrait;
    if (img.dataset.src !== src) { img.src = src; img.dataset.src = src; img.classList.remove('pop'); void img.offsetWidth; img.classList.add('pop'); }
    const random = TILE_CHARS[s.cur] === 'random' && !s.locked;
    const label = i === 0 ? 'PLAYER 1' : mode === 'cpu' ? 'CPU · ' + DIFFS.find((d) => d.id === cpuDiff)!.t : mode === 'online' ? 'OPPONENT' : 'PLAYER 2';
    pan.querySelector('.tag')!.textContent = label;
    pan.querySelector('.nm')!.textContent = random ? '???' : info.name;
    (pan.querySelector('.nm') as HTMLElement).style.color = random ? '#fff' : col;
    pan.querySelector('.ti')!.textContent = random ? 'Leave it to fate' : info.title;
    pan.querySelector('.tl')!.textContent = random ? 'A random fighter will be picked when you lock in.' : info.tagline;
    pan.querySelector('.sup')!.textContent = random ? '?' : info.superName;
    pan.querySelector('.supd')!.textContent = random ? '' : info.superDesc;
    pan.querySelector('.sty')!.textContent = random ? '?' : info.styleName;
    pan.querySelector('.styd')!.textContent = random ? '' : info.styleDesc;
    pan.querySelector('.stats')!.innerHTML = random ? '' : (['power', 'defense', 'speed'] as const).map((k) => `<div class="stat"><span>${k.toUpperCase()}</span><div class="bars">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= info.stats[k] ? 'on' : ''}"></i>`).join('')}</div></div>`).join('');
    const join = pan.querySelector('.join .sm')!;
    join.innerHTML = mode === 'online' ? 'Waiting for your opponent…' : i === 0 ? 'Press <b>Space</b> or <b>Ⓐ</b> to join' : 'Press <b>Enter</b> or <b>Ⓐ</b> to join';
  }
}

function lockSlot(i: 0 | 1) {
  const s = slots[i];
  if (s.locked) return;
  const c = TILE_CHARS[s.cur];
  s.char = c === 'random' ? (Math.random() < 0.5 ? 'nong' : 'nang') : c;
  if (c === 'random') s.cur = TILE_CHARS.indexOf(s.char);
  s.locked = true;
  audio.play('join');
  menuFx.burst(i === 0 ? 240 : 1040, 400, 30, charColor(s.char, false), 400);
  if (mode === 'cpu' && i === 0) {
    // CPU takes the other fighter
    slots[1].src = null;
    slots[1].char = s.char === 'nong' ? 'nang' : 'nong';
    slots[1].cur = TILE_CHARS.indexOf(slots[1].char);
    setTimeout(() => { slots[1].locked = true; audio.play('join'); paintSelect(); checkSelectDone(); }, 450);
  }
  if (mode === 'online') {
    net.pub({ ph: 'select', ch: s.char, rdy: true });
  }
  paintSelect();
  checkSelectDone();
}

function checkSelectDone() {
  if (selectDone) return;
  if (mode === 'online') { onlineMaybeStart(); return; }
  if (!slots[0].locked || !slots[1].locked) return;
  selectDone = true;
  setTimeout(() => {
    const a = slots[0].char, b = slots[1].char;
    const mirror = a === b;
    const cfgA: SideCfg = { kind: 'human', src: mode === 'versus' ? slots[0].src! : 'solo', char: a, alt: false, label: 'PLAYER 1' };
    const cfgB: SideCfg = mode === 'versus'
      ? { kind: 'human', src: slots[1].src!, char: b, alt: mirror, label: 'PLAYER 2' }
      : { kind: 'cpu', diff: cpuDiff, char: b, alt: mirror, label: 'CPU · ' + DIFFS.find((d) => d.id === cpuDiff)!.t };
    startVs(cfgA, cfgB, () => startBattle(cfgA, cfgB));
  }, 700);
}

handlers.select = (e) => {
  if (selectDone) return;
  if (e.src === 'mouse' && e.a === 'back') {
    audio.play('menuBack');
    if (mode === 'online') { net.leaveDuel(); goMenu(); } else if (mode === 'cpu') goCpu(); else goMenu();
    return;
  }
  if (mode === 'versus') {
    // which slot does this source drive?
    let si = slots.findIndex((s) => s.src === e.src);
    if (si < 0) {
      if (e.a === 'confirm') {
        // join the natural slot for keyboards, first free for pads
        let target = e.src === 'kb1' ? 0 : e.src === 'kb2' ? 1 : slots.findIndex((s) => !s.src);
        if (target < 0 || slots[target].src) target = slots.findIndex((s) => !s.src);
        if (target >= 0) { slots[target].src = e.src; audio.play('join'); paintSelect(); }
        return;
      }
      if (e.a === 'back') { if (!slots[0].src && !slots[1].src) { audio.play('menuBack'); goMenu(); } }
      return;
    }
    navSlot(si as 0 | 1, e);
    return;
  }
  if (mode === 'online' && slots[0].locked) {
    if (e.a === 'back') { slots[0].locked = false; net.pub({ ph: 'select', rdy: false }); audio.play('menuBack'); paintSelect(); }
    return;
  }
  navSlot(0, e);
};

function navSlot(i: 0 | 1, e: NavEvent) {
  const s = slots[i];
  if (s.locked) {
    if (e.a === 'back' && !(mode === 'cpu' && slots[1].locked)) { s.locked = false; audio.play('menuBack'); paintSelect(); }
    else if (e.a === 'back' && mode === 'cpu') { slots[0].locked = false; slots[1].locked = false; audio.play('menuBack'); paintSelect(); }
    return;
  }
  if (e.a === 'left' || e.a === 'up') { s.cur = (s.cur + 2) % 3; audio.play('menuMove'); paintSelect(); }
  else if (e.a === 'right' || e.a === 'down') { s.cur = (s.cur + 1) % 3; audio.play('menuMove'); paintSelect(); }
  else if (e.a === 'confirm') lockSlot(i);
  else if (e.a === 'back') {
    audio.play('menuBack');
    if (mode === 'versus') { s.src = null; paintSelect(); }
    else if (mode === 'online') { net.leaveDuel(); goMenu(); }
    else goCpu();
  }
}

// ---------------------------------------------------------------- VS splash
function startVs(a: SideCfg, b: SideCfg, then: () => void) {
  const pa = a.alt ? altPortrait[a.char] : a.char === 'nong' ? URLS.nongPortrait : URLS.nangPortrait;
  const pb = b.alt ? altPortrait[b.char] : b.char === 'nong' ? URLS.nongPortrait : URLS.nangPortrait;
  const el = $('#s-vs');
  el.style.setProperty('--ca', charColor(a.char, a.alt));
  el.style.setProperty('--cb', charColor(b.char, b.alt));
  el.innerHTML = `<div class="half a"><img src="${pa}" alt=""><div class="nm">${CHARS[a.char].name}</div></div>
    <div class="half b"><img src="${pb}" alt=""><div class="nm">${CHARS[b.char].name}</div></div>
    <div class="sub">FIRST TO ${settings.rounds} ${settings.rounds === 1 ? 'ROUND' : 'ROUNDS'}</div>
    <div class="vs">VS</div>`;
  el.classList.remove('on'); void el.offsetWidth;
  show('vs');
  audio.play('whoosh');
  setTimeout(() => { audio.play('heavyhit'); menuFx.shake(0.6); }, 420);
  setTimeout(then, 2300);
}

// ---------------------------------------------------------------- battle
function startBattle(a: SideCfg, b: SideCfg, seed = (Math.random() * 2 ** 31) >>> 0) {
  lastCfg = [a, b];
  battle = new Battle(a, b, settings.rounds);
  bgMode = 'battle';
  battle.onMatchEnd = (w) => showResults(w);
  if (mode === 'online') setupOnlineBattle(battle);
  else battle.beginRound(seed, 1);
  show('battle');
}

let pauseMenu: Menu;
function pause() {
  if (!battle || screen !== 'battle') return;
  if (mode !== 'online') battle.paused = true;
  const items: MItem[] = mode === 'online'
    ? [{ t: 'RESUME', act: resume }, { t: 'LEAVE MATCH', act: () => { resume(); net.leaveDuel(); goMenu(); } }]
    : [{ t: 'RESUME', act: resume }, { t: 'RESTART MATCH', act: () => { resume(); if (lastCfg) startBattle(lastCfg[0], lastCfg[1]); } }, { t: 'SETTINGS', act: () => goSettings('pause') }, { t: 'QUIT TO MENU', act: () => { battle = null; goMenu(); } }];
  pauseMenu = new Menu($('#pausemenu'), items);
  audio.musicMode('quiet');
  show('pause', true);
}
function resume() { if (battle) { battle.paused = false; audio.musicMode('battle'); show('battle'); } }
handlers.pause = (e) => { if (!pauseMenu.nav(e) && (e.a === 'back' || e.a === 'pause')) { audio.play('menuBack'); resume(); } };
handlers.battle = (e) => { if (e.a === 'pause') pause(); };
$('#pausebtn').addEventListener('click', () => pause());
window.addEventListener('blur', () => { if (screen === 'battle' && mode !== 'online' && battle && battle.phase === 'play') pause(); });

// ---------------------------------------------------------------- results
let resMenu: Menu;
function showResults(w: 0 | 1) {
  if (!battle) return;
  const b = battle;
  const ws = b.sides[w];
  // rivalry book-keeping
  record.matches++;
  if (mode === 'versus' && b.sides[0].cfg.char !== b.sides[1].cfg.char) record.versus[ws.cfg.char] = (record.versus[ws.cfg.char] || 0) + 1;
  if (mode === 'cpu') { const k = cpuDiff; const r = record.cpu[k] || { w: 0, l: 0 }; if (w === 0) r.w++; else r.l++; record.cpu[k] = r; }
  if (mode === 'online') { if (w === 0) record.online.win = (record.online.win || 0) + 1; else record.online.loss = (record.online.loss || 0) + 1; }
  const tot = b.sides.map((s) => {
    const all = [...s.roundStats];
    const sum = { lines: 0, attack: 0, quads: 0, spins: 0, maxCombo: 0, pieces: 0, time: 0 };
    for (const r of all) { sum.lines += r.lines; sum.attack += r.attack; sum.quads += r.quads; sum.spins += r.spins; sum.maxCombo = Math.max(sum.maxCombo, r.maxCombo); sum.pieces += r.pieces; sum.time += r.time; }
    if (!all.length && s.remote && s.remote.stats) { const r = s.remote.stats; Object.assign(sum, { lines: r.lines, attack: r.attack, quads: r.quads, spins: r.spins, maxCombo: r.maxCombo, pieces: r.pieces, time: r.time }); }
    return sum;
  });
  for (const t of tot) { record.quads += 0; record.bestCombo = Math.max(record.bestCombo, t.maxCombo); }
  save();
  const rows: [string, (t: typeof tot[0]) => number, string?][] = [
    ['LINES CLEARED', (t) => t.lines], ['ATTACK SENT', (t) => t.attack], ['QUADS', (t) => t.quads], ['T-SPINS', (t) => t.spins],
    ['BEST COMBO', (t) => Math.max(0, t.maxCombo + 1)], ['PIECES / MIN', (t) => (t.time > 0 ? Math.round((t.pieces / t.time) * 60000) : 0)],
  ];
  const nA = CHARS[b.sides[0].cfg.char].name, nB = CHARS[b.sides[1].cfg.char].name;
  const box = $('#resbox');
  box.style.setProperty('--c', ws.color);
  const hasStats = tot[1].pieces > 0 || mode !== 'online';
  box.innerHTML = `<div class="win"><div class="k">${ws.cfg.label} WINS THE MATCH</div><div class="n">${CHARS[ws.cfg.char].name}</div><div class="s">${b.sides[0].wins} – ${b.sides[1].wins}</div></div>
    <table><thead><tr><td class="a" style="color:${b.sides[0].color}">${nA}</td><td class="l"></td><td class="b" style="color:${b.sides[1].color}">${nB}</td></tr></thead><tbody>
    ${rows.map(([l, f]) => { const a = f(tot[0]), c = hasStats ? f(tot[1]) : 0; return `<tr><td class="a ${a > c ? 'best' : ''}">${a}</td><td class="l">${l}</td><td class="b ${c > a ? 'best' : ''}">${hasStats ? c : '–'}</td></tr>`; }).join('')}
    </tbody></table><div class="menu" id="resmenu"></div>`;
  const items: MItem[] = mode === 'online'
    ? [{ t: 'REMATCH', act: () => onlineRematch() }, { t: 'LEAVE', act: () => { net.leaveDuel(); goMenu(); } }]
    : [{ t: 'REMATCH', act: () => { if (lastCfg) startBattle(lastCfg[0], lastCfg[1]); } }, { t: 'NEW FIGHTERS', act: () => { battle = null; goSelect(); } }, { t: 'MAIN MENU', act: () => { battle = null; goMenu(); } }];
  resMenu = new Menu($('#resmenu'), items, true);
  setTimeout(() => show('results', true), 300);
  // confetti
  for (let i = 0; i < 80; i++) menuFx.spawn({ x: Math.random() * W, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 120, vy: 80 + Math.random() * 160, kind: 'confetti', size: 6, max: 4, g: 60, drag: 0.99, add: false, color: [ws.color, '#ffcf4a', '#ffffff', '#ff6a3d'][i % 4], vr: (Math.random() - 0.5) * 10 });
}
handlers.results = (e) => { resMenu.nav(e); };

// ---------------------------------------------------------------- settings
interface SetRow { k: string; sub: string; get: () => string; seg?: () => [number, number]; change: (d: number) => void; }
let setIdx = 0, setFrom: ScreenId = 'menu';
const cycle = <T,>(arr: T[], v: T, d: number) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
const SET_ROWS: SetRow[] = [
  { k: 'MUSIC', sub: 'Background track volume', get: () => Math.round(settings.music * 10) + '', seg: () => [Math.round(settings.music * 10), 10], change: (d) => { settings.music = Math.max(0, Math.min(1, Math.round(settings.music * 10 + d) / 10)); audio.setVolumes(settings.music, settings.sfx); } },
  { k: 'EFFECTS', sub: 'Sound effects volume', get: () => Math.round(settings.sfx * 10) + '', seg: () => [Math.round(settings.sfx * 10), 10], change: (d) => { settings.sfx = Math.max(0, Math.min(1, Math.round(settings.sfx * 10 + d) / 10)); audio.setVolumes(settings.music, settings.sfx); audio.play('hit'); } },
  { k: 'ROUNDS TO WIN', sub: 'How many rounds take the match', get: () => 'FIRST TO ' + settings.rounds, change: (d) => { settings.rounds = cycle([1, 2, 3], settings.rounds, d); } },
  { k: 'HANDLING', sub: 'How fast pieces slide when you hold a direction', get: () => settings.handling.toUpperCase(), change: (d) => { settings.handling = cycle(['relaxed', 'normal', 'fast'] as const, settings.handling, d) as any; } },
  { k: 'GARBAGE DELAY', sub: 'Time to counter incoming lines before they rise', get: () => ({ 700: 'SHORT', 1100: 'NORMAL', 1700: 'LONG' } as any)[settings.garbageDelay] || 'NORMAL', change: (d) => { settings.garbageDelay = cycle([700, 1100, 1700], settings.garbageDelay, d); } },
  { k: 'SPEED UP', sub: 'Pieces fall faster as the round goes on', get: () => 'EVERY ' + settings.speedUpEvery + 's', change: (d) => { settings.speedUpEvery = cycle([25, 40, 60], settings.speedUpEvery, d); } },
  { k: 'GHOST PIECE', sub: 'Shows where your piece will land', get: () => (settings.ghost ? 'ON' : 'OFF'), change: () => { settings.ghost = !settings.ghost; } },
  { k: 'SCREEN SHAKE', sub: 'Camera shake on big hits', get: () => (settings.shake ? 'ON' : 'OFF'), change: () => { settings.shake = !settings.shake; } },
  { k: 'FLASHING', sub: 'Full-screen flashes on supers and K.O.', get: () => (settings.reducedFlash ? 'REDUCED' : 'FULL'), change: () => { settings.reducedFlash = !settings.reducedFlash; } },
  { k: 'TOUCH BUTTONS', sub: 'On-screen controls for phones and tablets', get: () => settings.touch.toUpperCase(), change: (d) => { settings.touch = cycle(['auto', 'on', 'off'] as const, settings.touch, d) as any; } },
];
function goSettings(from: ScreenId) { setFrom = from; setIdx = 0; paintSettings(); show('settings', from === 'pause'); }
function paintSettings() {
  const root = $('#setrows');
  root.innerHTML = SET_ROWS.map((r, i) => {
    const seg = r.seg ? r.seg() : null;
    return `<div class="row ${i === setIdx ? 'sel' : ''}" data-i="${i}"><div class="k">${r.k}<small>${r.sub}</small></div><div class="v"><button class="arr" data-d="-1" aria-label="Decrease">◀</button>${seg ? `<span class="seg">${Array.from({ length: seg[1] }, (_, n) => `<i class="${n < seg[0] ? 'on' : ''}"></i>`).join('')}</span>` : `<span class="val">${r.get()}</span>`}<button class="arr" data-d="1" aria-label="Increase">▶</button></div></div>`;
  }).join('') + `<div class="row back ${setIdx === SET_ROWS.length ? 'sel' : ''}" data-i="${SET_ROWS.length}"><div class="k">BACK</div></div>`;
  root.querySelectorAll('.row').forEach((el) => {
    const i = +(el as HTMLElement).dataset.i!;
    el.addEventListener('pointerenter', () => { if (setIdx !== i) { setIdx = i; paintSettings(); } });
    el.addEventListener('click', (ev) => {
      const d = (ev.target as HTMLElement).closest('.arr') as HTMLElement | null;
      if (i === SET_ROWS.length) { leaveSettings(); return; }
      SET_ROWS[i].change(d ? +d.dataset.d! : 1); save(); audio.play('menuMove'); paintSettings();
    });
  });
}
function leaveSettings() {
  audio.play('menuBack'); save();
  if (battle) { battle.fx.shakeOn = settings.shake; battle.fx.reduced = settings.reducedFlash; }
  if (setFrom === 'pause') { show('pause', true); } else goMenu();
}
handlers.settings = (e) => {
  const n = SET_ROWS.length + 1;
  if (e.a === 'up') { setIdx = (setIdx + n - 1) % n; audio.play('menuMove'); paintSettings(); }
  else if (e.a === 'down') { setIdx = (setIdx + 1) % n; audio.play('menuMove'); paintSettings(); }
  else if ((e.a === 'left' || e.a === 'right') && setIdx < SET_ROWS.length) { SET_ROWS[setIdx].change(e.a === 'left' ? -1 : 1); save(); audio.play('menuMove'); paintSettings(); }
  else if (e.a === 'confirm') { if (setIdx === SET_ROWS.length) leaveSettings(); else { SET_ROWS[setIdx].change(1); save(); audio.play('menuMove'); paintSettings(); } }
  else if (e.a === 'back') leaveSettings();
};

// ---------------------------------------------------------------- how to play
let howTab = 0;
const HOW = [
  {
    t: 'RULES', cols: [
      `<h5>THE GOAL</h5><p>Clear lines to attack. Every attack drops grey garbage into your rival's well. If their stack spills over the top, they're K.O.</p><p>Win rounds to win the match. Pieces fall faster the longer a round runs.</p>`,
      `<h5>ATTACKS</h5><table><tr><td>Single</td><td>0</td></tr><tr><td>Double</td><td>1</td></tr><tr><td>Triple</td><td>2</td></tr><tr><td>Quad (4 lines)</td><td>4</td></tr><tr><td>T-Spin Single / Double / Triple</td><td>2 / 4 / 6</td></tr><tr><td>Back-to-back bonus</td><td>+1</td></tr><tr><td>Combo (clears in a row)</td><td>+1 to +5</td></tr><tr><td>All Clear</td><td>+10</td></tr></table>`,
      `<h5>DEFENSE &amp; SUPERS</h5><p>Incoming garbage waits on the meter beside your well. Orange is still on its way. Red will rise on your next piece. Attack back to cancel it out.</p><p>Clearing lines fills your <b>Super</b> bar. When it says SUPER READY, fire your fighter's special move.</p><p>Nong's <b>Shadow Slam</b> erases incoming garbage and hits for 4. Nang's <b>Emerald Burst</b> blows away your bottom 4 rows and hits for 2.</p>`,
    ],
  },
  {
    t: 'CONTROLS', cols: [
      `<h5>PLAYER 1 · LEFT KEYS</h5><table><tr><td>Move</td><td><kbd>A</kbd><kbd>D</kbd></td></tr><tr><td>Soft drop</td><td><kbd>S</kbd></td></tr><tr><td>Hard drop</td><td><kbd>Space</kbd></td></tr><tr><td>Rotate right / left</td><td><kbd>W</kbd> <kbd>Q</kbd></td></tr><tr><td>Hold</td><td><kbd>E</kbd></td></tr><tr><td>Super</td><td><kbd>R</kbd></td></tr></table>`,
      `<h5>PLAYER 2 · RIGHT KEYS</h5><table><tr><td>Move</td><td><kbd>←</kbd><kbd>→</kbd></td></tr><tr><td>Soft drop</td><td><kbd>↓</kbd></td></tr><tr><td>Hard drop</td><td><kbd>Enter</kbd></td></tr><tr><td>Rotate right / left</td><td><kbd>↑</kbd> <kbd>/</kbd></td></tr><tr><td>Hold</td><td><kbd>Right Shift</kbd></td></tr><tr><td>Super</td><td><kbd>.</kbd></td></tr></table><p style="margin-top:10px">Playing alone? Both key sets work, plus <kbd>Z</kbd><kbd>X</kbd> rotate, <kbd>C</kbd> hold, <kbd>V</kbd> super.</p>`,
      `<h5>CONTROLLER</h5><table><tr><td>Move / soft drop</td><td>D-pad or stick</td></tr><tr><td>Hard drop</td><td>D-pad ↑</td></tr><tr><td>Rotate right / left</td><td>Ⓐ / Ⓑ</td></tr><tr><td>Hold</td><td>Ⓧ or bumpers</td></tr><tr><td>Super</td><td>Ⓨ</td></tr><tr><td>Pause</td><td>Start</td></tr></table><p style="margin-top:10px">On a phone or tablet, on-screen buttons appear in VS CPU and Online.</p>`,
    ],
  },
];
function goHowto() { howTab = 0; paintHow(); show('howto'); }
function paintHow() {
  $('#howtabs').innerHTML = HOW.map((h, i) => `<button class="tab ${i === howTab ? 'on' : ''}" data-i="${i}">${h.t}</button>`).join('');
  $('#howtabs').querySelectorAll('.tab').forEach((el) => el.addEventListener('click', () => { howTab = +(el as HTMLElement).dataset.i!; paintHow(); audio.play('menuMove'); }));
  $('#howbody').innerHTML = HOW[howTab].cols.map((c) => `<div class="c">${c}</div>`).join('');
}
handlers.howto = (e) => {
  if (e.a === 'left' || e.a === 'right') { howTab = (howTab + 1) % HOW.length; paintHow(); audio.play('menuMove'); }
  else if (e.a === 'back' || e.a === 'confirm') { audio.play('menuBack'); goMenu(); }
};

// ---------------------------------------------------------------- online
let onlMenu: Menu | null = null;
function onlineView(st: string, msg: string, items: MItem[], dots = false) {
  $('#onl').innerHTML = `<div class="st">${st}</div>${dots ? '<div class="dots"><i></i><i></i><i></i></div>' : ''}<div class="msg">${msg}</div><div class="menu" id="onlmenu"></div>`;
  onlMenu = new Menu($('#onlmenu'), items);
}
async function goOnline() {
  show('online');
  if (STANDALONE) { standaloneOnlineMenu(); return; }
  onlineView('CONNECTING', 'Opening the arena doors…', [{ t: 'BACK', act: goMenu }], true);
  const ok = await net.connect();
  if (screen !== 'online') return;
  if (!ok) {
    onlineView('ONLINE IS OFFLINE', 'Online play works when this game is opened inside Claude while you are signed in. You can still play Versus on one device, or try again later.', [{ t: 'BACK', act: goMenu }]);
    return;
  }
  onlineSearch();
}
// ---- standalone (plain web link) online: room codes
function shareLink(code: string) { return location.href.split('#')[0] + '#' + code; }
function standaloneOnlineMenu() {
  peerNet.search(false);
  onlineView('PLAY A FRIEND', 'One of you creates a room and sends the link. The other opens it, or picks Join and types the 4-letter code.', [
    { t: 'CREATE A ROOM', s: 'Get a link to send your rival', act: standaloneHost },
    { t: 'JOIN WITH A CODE', s: 'Type the code you were sent', act: () => standaloneJoinForm() },
    { t: 'BACK', act: goMenu },
  ]);
}
async function standaloneHost() {
  onlineView('OPENING A ROOM', 'Hang tight…', [{ t: 'CANCEL', act: () => { peerNet.search(false); standaloneOnlineMenu(); } }], true);
  const code = await peerNet.host();
  if (screen !== 'online' || peerNet.status === 'paired') return;
  if (!code) { standaloneError(); return; }
  const link = shareLink(code);
  const canShare = typeof (navigator as any).share === 'function';
  onlineView('ROOM ' + code, `Send this link to your rival. The match starts as soon as they open it.<br><span id="sharelink" style="user-select:text;-webkit-user-select:text;color:var(--gold);font-weight:700">${link}</span>`, [
    { t: canShare ? 'SHARE LINK' : 'COPY LINK', act: () => {
      if (canShare) { (navigator as any).share({ title: 'Block Clash Duel', text: 'Fight me in Block Clash Duel', url: link }).catch(() => {}); return; }
      const done = () => toast('Link copied. Paste it in a text to your rival.');
      const fallback = () => { const r = document.createRange(); const el = $('#sharelink'); r.selectNodeContents(el); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); toast('Link selected. Copy it and send it.'); };
      try { navigator.clipboard.writeText(link).then(done, fallback); } catch { fallback(); }
    } },
    { t: 'CANCEL', act: () => { peerNet.search(false); standaloneOnlineMenu(); } },
  ], true);
}
function standaloneJoinForm(prefill = '') {
  onlineView('JOIN A ROOM', `Type the 4-letter code<br><input id="codein" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${prefill}" style="margin-top:14px;width:220px;text-align:center;font:44px var(--fd);letter-spacing:10px;text-transform:uppercase;padding:8px 0;border-radius:12px;border:2px solid var(--gold);background:rgba(0,0,0,.4);color:#fff;outline:none">`, [
    { t: 'JOIN', act: () => { const v = ($('#codein') as HTMLInputElement).value.trim().toUpperCase(); if (v.length === 4) standaloneJoin(v); else toast('Codes are 4 letters'); } },
    { t: 'BACK', act: standaloneOnlineMenu },
  ]);
  const inp = $('#codein') as HTMLInputElement;
  inp.addEventListener('focus', () => { input.typing = true; });
  inp.addEventListener('blur', () => { input.typing = false; });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); onlMenu?.fire(); }
    if (e.key === 'Escape') { inp.blur(); }
  });
  setTimeout(() => inp.focus(), 50);
}
function standaloneJoin(code: string) {
  onlineView('JOINING ROOM ' + code, 'Connecting to your rival…', [{ t: 'CANCEL', act: () => { peerNet.search(false); standaloneOnlineMenu(); } }], true);
  peerNet.join(code);
}
function standaloneError() {
  const nf = peerNet.error === 'notfound';
  onlineView(nf ? 'ROOM NOT FOUND' : 'CONNECTION TROUBLE', nf ? `Nobody is waiting in room ${peerNet.code}. Ask your rival to create a room and send a fresh link.` : 'Could not reach the matchmaking service. Check your internet connection and try again.', [
    { t: 'TRY AGAIN', act: standaloneOnlineMenu }, { t: 'BACK', act: goMenu },
  ]);
}
function onlineSearch() {
  net.search(true, 'nong');
  paintOnlineSearch();
}
function paintOnlineSearch() {
  if (screen !== 'online' || STANDALONE) return;
  const others = net.lobbyCount;
  onlineView('FINDING YOUR RIVAL', `Open this same game on the other device and choose <b>Online</b>. You'll be paired automatically.<br><span style="color:var(--muted)">${others ? others + ' other ' + (others === 1 ? 'player is' : 'players are') + ' here right now' : 'Nobody else is here yet'}</span>`, [{ t: 'CANCEL', act: () => { net.search(false, 'nong'); goMenu(); } }], true);
}
net.onStatus = (s: string) => {
  if (s === 'searching' && screen === 'online') paintOnlineSearch();
  if (s === 'paired') onlinePaired();
  if (s === 'unavailable' && STANDALONE && screen === 'online') standaloneError();
  if (s === 'lost') { toast('Your opponent left the match'); if (screen !== 'menu' && screen !== 'title') goMenu(); }
};
handlers.online = (e) => { if (onlMenu && !onlMenu.nav(e) && e.a === 'back') { audio.play('menuBack'); net.search(false, 'nong'); goMenu(); } };

let onlineMatch = 1;
let onlineStarted = false;
function onlinePaired() {
  audio.play('join');
  toast('Rival found! Pick your fighter');
  onlineOppChar = null; onlineOppReady = false; onlineStarted = false; onlineMatch = 1;
  mode = 'online';
  goSelect();
}
net.onDuel = (p: DuelPresence) => {
  // character select updates
  if (screen === 'select' && mode === 'online') {
    const prev = onlineOppChar;
    onlineOppChar = p.ch || null;
    onlineOppReady = !!p.rdy && !!p.ch;
    if (p.ch) { slots[1].char = p.ch; slots[1].cur = TILE_CHARS.indexOf(p.ch); }
    slots[1].locked = onlineOppReady;
    if (prev !== onlineOppChar || true) paintSelect();
    onlineMaybeStart();
  }
  // host told us to start
  if (p.go && net.info && !net.info.host) {
    if (!onlineStarted && p.go.rd === 1 && p.go.m === onlineMatch && (screen === 'select' || screen === 'results')) {
      onlineStarted = true;
      launchOnline(p.go.seed, p.go.gc, p.go.hc);
    } else if (battle && onlineStarted && p.go.m === onlineMatch && p.go.rd === battle.round + 1 && battle.phase === 'result') {
      battle.beginRound(p.go.seed, p.go.rd);
    }
  }
  if (battle && mode === 'online') {
    if (p.g) battle.applyRemote(p.g);
    if (!net.info!.host && p.res && p.res.m === onlineMatch && p.res.rd === battle.round && battle.roundWinner === null) {
      const w = p.res.w === 'd' ? -1 : p.res.w === 'h' ? 1 : 0;
      battle.endRound(w as any);
      net.pub({ seen: battle.round });
    }
  }
  // rematch handshake (host)
  if (net.info && net.info.host && screen === 'results' && p.again === onlineMatch && net.mine.again === onlineMatch) {
    onlineMatch++; onlineStarted = false;
    const seed = (Math.random() * 2 ** 31) >>> 0;
    net.pub({ go: { rd: 1, seed, m: onlineMatch, hc: slots[0].char, gc: onlineOppChar || 'nang' }, res: undefined, again: undefined });
    onlineStarted = true;
    launchOnline(seed, slots[0].char, onlineOppChar || 'nang');
  }
  if (net.info && !net.info.host && p.go && p.go.m > onlineMatch && screen === 'results') {
    onlineMatch = p.go.m; onlineStarted = true; net.pub({ again: undefined, seen: 0 });
    launchOnline(p.go.seed, p.go.gc, p.go.hc);
  }
};
function onlineMaybeStart() {
  if (!net.info || !net.info.host || onlineStarted) return;
  if (slots[0].locked && onlineOppReady && onlineOppChar) {
    onlineStarted = true;
    const seed = (Math.random() * 2 ** 31) >>> 0;
    net.pub({ go: { rd: 1, seed, m: onlineMatch, hc: slots[0].char, gc: onlineOppChar } });
    launchOnline(seed, slots[0].char, onlineOppChar);
  }
}
function launchOnline(seed: number, mine: CharId, theirs: CharId) {
  const host = net.info!.host;
  const mirror = mine === theirs;
  const a: SideCfg = { kind: 'human', src: 'solo', char: mine, alt: mirror && !host, label: 'YOU' };
  const b: SideCfg = { kind: 'remote', char: theirs, alt: mirror && host, label: 'RIVAL' };
  onlineSeed = seed;
  startVs(a, b, () => startBattle(a, b));
}
let onlineSeed = 1;
let pubT = 0;
let resultSentFor = 0;
function setupOnlineBattle(b: Battle) {
  b.online = true;
  b.hooks = { external: true };
  resultSentFor = 0;
  net.pub({ ph: 'play', seen: 0, res: undefined });
  b.beginRound(onlineSeed, 1);
}
function onlineTick(dt: number) {
  if (!battle || mode !== 'online' || !net.info) return;
  pubT -= dt;
  if (pubT <= 0) { pubT = 50; const g = battle.localState(); if (g) net.pub({ g }); }
  const host = net.info.host;
  if (host) {
    // decide round results
    if (battle.phase === 'ko' && battle.phaseT > 2.2 && resultSentFor !== battle.round) {
      resultSentFor = battle.round;
      const meDead = !battle.sides[0].alive, themDead = !battle.sides[1].alive;
      const w: 'h' | 'g' | 'd' = meDead && themDead ? 'd' : meDead ? 'g' : 'h';
      net.pub({ res: { rd: battle.round, w, m: onlineMatch } });
      battle.endRound(w === 'd' ? -1 : w === 'h' ? 0 : 1);
    }
    if (battle.phase === 'result' && battle.phaseT > 2.6 && !battle.matchOver) {
      const seen = net.theirs?.seen || 0;
      if (seen >= battle.round || battle.phaseT > 6) {
        const seed = (Math.random() * 2 ** 31) >>> 0;
        const rd = battle.round + 1;
        net.pub({ go: { rd, seed, m: onlineMatch, hc: battle.sides[0].cfg.char, gc: battle.sides[1].cfg.char } });
        battle.beginRound(seed, rd);
      }
    }
  }
  if (battle.phase === 'result' && battle.phaseT > 2.6 && battle.matchOver) {
    battle.phase = 'done';
    showResults(battle.sides[0].wins > battle.sides[1].wins ? 0 : 1);
  }
}
function onlineRematch() {
  net.pub({ again: onlineMatch });
  toast('Waiting for your rival to accept the rematch');
  if (net.theirs) net.onDuel?.(net.theirs);
}

// ---------------------------------------------------------------- touch controls
const TOUCH: { id: keyof typeof input.touch; label: string; x: number; y: number; sm?: boolean }[] = [
  { id: 'hold', label: 'HOLD', x: 13, y: 420, sm: true }, { id: 'ccw', label: 'TURN', x: 13, y: 520, sm: true },
  { id: 'super', label: 'SUPER', x: 1183, y: 420, sm: true }, { id: 'hard', label: 'DROP', x: 1183, y: 520, sm: true },
];
function buildTouch() {
  const root = $('#touch');
  for (const b of TOUCH) {
    const el = document.createElement('button');
    el.textContent = b.label;
    if (b.sm) el.className = 'sm';
    el.style.left = b.x + 'px'; el.style.top = b.y + 'px';
    const on = (v: boolean) => (e: PointerEvent) => { e.preventDefault(); e.stopPropagation(); (input.touch as any)[b.id] = v; if (v) input.held.add(b.id); else input.held.delete(b.id); el.classList.toggle('on', v); if (v) audio.unlock(); };
    el.addEventListener('pointerdown', on(true));
    el.addEventListener('pointerup', on(false));
    el.addEventListener('pointerleave', on(false));
    el.addEventListener('pointercancel', on(false));
    root.appendChild(el);
  }
  // swipe gestures on the board: drag sideways to move, tap to rotate, flick down to drop, hold down to soft drop
  const g = $('#gest');
  let sx = 0, sy = 0, st = 0, moved = 0, id = -1, softing = false, lx = 0;
  const pt = (e: PointerEvent) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; };
  g.addEventListener('pointerdown', (e) => {
    e.preventDefault(); audio.unlock();
    id = e.pointerId; const [x, y] = pt(e); sx = lx = x; sy = y; st = performance.now(); moved = 0; softing = false;
    try { g.setPointerCapture(id); } catch { /* ignore */ }
  });
  g.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const [x, y] = pt(e);
    const step = 26;
    while (x - lx > step) { input.taps.push('right'); lx += step; moved++; }
    while (lx - x > step) { input.taps.push('left'); lx -= step; moved++; }
    if (y - sy > 60 && Math.abs(x - sx) < 50 && performance.now() - st > 220) { softing = true; input.touch.soft = true; }
  });
  const end = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    const [x, y] = pt(e);
    const dt = performance.now() - st, dy = y - sy, dx = x - sx;
    if (softing) { input.touch.soft = false; return; }
    if (dy > 70 && dt < 320 && Math.abs(dx) < 60) input.taps.push('hard');
    else if (dy < -70 && dt < 320) input.taps.push('hold');
    else if (moved === 0 && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300) input.taps.push('cw');
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
}
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
function updateTouch() {
  const want = settings.touch === 'on' || (settings.touch === 'auto' && isTouch);
  $('#touch').classList.toggle('on', want && screen === 'battle' && mode !== 'versus');
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(50, now - last); last = now;
  time += dt / 1000;
  input.poll(dt);
  if (screen === 'title' && input.anyPressed && !input.navEvents.length) { audio.play('menuSelect'); goMenu(); }
  input.anyPressed = false;
  let pausedThisFrame = false;
  const startScreen = screen;
  for (const e of input.navEvents) {
    if (screen !== startScreen) break; // one screen change per frame
    if (e.a === 'pause') { if (pausedThisFrame) continue; pausedThisFrame = true; }
    if (screen === 'battle' && e.a !== 'pause') continue;
    handlers[screen]?.(e);
  }
  menuFx.update(dt);
  // draw
  ctx.clearRect(0, 0, W, H);
  if (battle && (screen === 'battle' || screen === 'pause' || screen === 'results' || (screen === 'settings' && setFrom === 'pause'))) {
    battle.update(dt);
    onlineTick(dt);
    battle.draw(ctx, drawBg);
    menuFx.draw(ctx, FONT_D);
    if ($('#touch').classList.contains('on') && battle.round === 1 && (battle.phase === 'intro' || battle.phase === 'fight')) {
      ctx.save(); ctx.textAlign = 'center'; ctx.font = `600 17px 'Chakra Petch', sans-serif`;
      ctx.fillStyle = 'rgba(5,5,20,0.8)'; ctx.fillRect(116, 540, 270, 92);
      ctx.fillStyle = '#fff';
      ['Drag sideways to move', 'Tap to rotate · flick down to drop', 'Flick up to hold'].forEach((t, i) => ctx.fillText(t, 251, 566 + i * 26));
      ctx.restore();
    }
  } else {
    const [sx, sy] = menuFx.shakeOffset(now);
    ctx.save(); ctx.translate(sx, sy);
    drawBg(ctx, time, bgMode === 'select' ? 0.55 : bgMode === 'menu' ? 0.25 : 0.35);
    if (bgMode === 'title' || bgMode === 'menu') {
      drawDeco(ctx, dt / 1000);
      sparT -= dt / 1000;
      if (sparT <= 0 && attract.length) {
        sparT = 2.6 + Math.random() * 2.4;
        const who = attract[Math.random() < 0.5 ? 0 : 1];
        who.set(Math.random() < 0.55 ? 'jab' : Math.random() < 0.6 ? 'kick' : 'heavy');
      }
      for (const f of attract) { f.update(dt); }
      for (const f of attract) f.draw(ctx, time, charColor(f.id, false));
    }
    menuFx.draw(ctx, FONT_D);
    ctx.restore();
  }
  input.endFrame();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
input.onAnyInput = () => { audio.unlock(); if (screen === 'title') { /* handled by nav */ } };
window.addEventListener('pointerdown', () => audio.unlock());
async function boot() {
  const bar = $('#s-loading .bar i');
  const fonts = (document as any).fonts;
  const fontP = fonts ? Promise.race([Promise.all([fonts.load(`40px 'Bungee'`), fonts.load(`600 16px 'Chakra Petch'`)]), new Promise((r) => setTimeout(r, 2500))]) : Promise.resolve();
  await Promise.all([loadAll((f) => { bar.style.width = Math.round(f * 100) + '%'; }), fontP]);
  for (const id of ['nong', 'nang'] as CharId[]) {
    try { altPortrait[id] = (art.chars[id].portraitAlt as HTMLCanvasElement).toDataURL('image/png'); } catch { altPortrait[id] = id === 'nong' ? URLS.nongPortrait : URLS.nangPortrait; }
  }
  audio.setVolumes(settings.music, settings.sfx);
  buildMainMenu();
  buildTouch();
  if (STANDALONE) {
    const h = location.hash.replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(h)) { pendingJoin = h; history.replaceState(null, '', location.pathname + location.search); }
    $('#s-title .press').textContent = pendingJoin ? 'TAP TO JOIN THE FIGHT' : 'PRESS ANY BUTTON';
  }
  goTitle();
  // hidden test hooks for automated play-testing
  (window as any).__bc = { get battle() { return battle; }, get screen() { return screen; }, autoPlay: (d: Difficulty = 'normal') => { const s = battle && battle.sides[0]; if (s) { s.cfg.kind = 'cpu'; s.cpu = new CpuController(d); (battle as any).autoDiff = d; } }, startCpuDemo: (d: Difficulty = 'hard', d2: Difficulty = d) => { mode = 'cpu'; const a: SideCfg = { kind: 'cpu', diff: d2, char: 'nong', alt: false, label: 'CPU A' }; const b: SideCfg = { kind: 'cpu', diff: d, char: 'nang', alt: false, label: 'CPU B' }; startBattle(a, b); }, net };
}
requestAnimationFrame(frame);
boot();
