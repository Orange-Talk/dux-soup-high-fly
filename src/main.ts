import { loadAll, art, CharId, URLS, portraitUrl } from './assets';
import { audio } from './audio';
import { input, NavEvent, SourceId } from './input';
import { Battle, SideCfg } from './battle';
import { Fighter } from './fighter';
import { FX } from './fx';
import { CHARS, charColor, getUnlockedChars, unlockSecretChar } from './chars';
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

// ---------------------------------------------------------------- scaling & mobile browser lockdown
let scale = 1;
let extraX = 0;
function fit() {
  const vv = window.visualViewport;
  const vw = vv ? vv.width : window.innerWidth;
  const vh = vv ? vv.height : window.innerHeight;
  scale = Math.min(vw / W, vh / H);
  extraX = Math.max(0, Math.min(260, Math.ceil((vw / scale - W) / 2)));
  stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
  stage.style.transformOrigin = '50% 50%';
  stage.style.setProperty('--extra-x', extraX + 'px');
  const totalW = W + extraX * 2;
  cv.style.left = -extraX + 'px';
  cv.style.width = totalW + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const k = Math.max(1, scale * dpr);
  cv.width = Math.round(totalW * k); cv.height = Math.round(H * k);
  ctx.setTransform(k, 0, 0, k, extraX * k, 0);
  setDpr(k);
  if (typeof touchEls !== 'undefined' && touchEls.length) updateTouch();
}
stage.style.left = '50%'; stage.style.top = '50%';
window.addEventListener('resize', fit);
window.visualViewport?.addEventListener('resize', fit);
// Prevent iOS Safari double-tap zoom, pinch-zoom, rubber-band scroll, and long-press callouts
for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) {
  window.addEventListener(ev, (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
  }, { passive: false });
}
document.addEventListener('touchmove', (e) => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  e.preventDefault();
}, { passive: false });

// ---------------------------------------------------------------- screens
type ScreenId = 'loading' | 'title' | 'menu' | 'cpu' | 'select' | 'vs' | 'battle' | 'pause' | 'results' | 'settings' | 'howto' | 'online' | 'touchcfg';
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
  const rx = -extraX, rw = W + extraX * 2;
  if (!art.bg) { c.fillStyle = '#0b0a20'; c.fillRect(rx, 0, rw, H); return; }
  const z = 1.03 + Math.sin(t * 0.07) * 0.015;
  const iw = art.bg.width, ih = art.bg.height;
  const s = Math.max(rw / iw, H / ih) * z;
  const dw = iw * s, dh = ih * s;
  c.drawImage(art.bg, (W - dw) / 2 + Math.sin(t * 0.05) * 8, (H - dh) / 2, dw, dh);
  c.fillStyle = `rgba(6,5,22,${dark})`; c.fillRect(rx, 0, rw, H);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(6,5,22,0.55)'); g.addColorStop(0.35, 'rgba(6,5,22,0)'); g.addColorStop(0.8, 'rgba(6,5,22,0)'); g.addColorStop(1, 'rgba(6,5,22,0.6)');
  c.fillStyle = g; c.fillRect(rx, 0, rw, H);
  // drifting embers
  for (let i = 0; i < 30; i++) {
    const sx = rx + ((i * 197.3) % rw), sp = 18 + (i % 7) * 7;
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
  { id: 'easy', t: 'ROOKIE', d: 'Relaxed pace, makes plenty of mistakes, never hard-drops. Great for casual play.', n: 1, c: '#4ce46c' },
  { id: 'normal', t: 'BRAWLER', d: 'Steady pace with occasional slips. A fun, fair match for most players.', n: 2, c: '#2fd9ff' },
  { id: 'hard', t: 'CHAMPION', d: 'Fast hands, uses hold and keeps the pressure on.', n: 3, c: '#ff9b2f' },
  { id: 'master', t: 'LEGEND', d: 'Lightning fast. Bring your combos, T-spins and supers.', n: 4, c: '#ff4d61' },
];
let cpuIdx = 0;
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
function getSelectTiles(): (CharId | 'random')[] {
  const unlocked = getUnlockedChars();
  return [...unlocked, 'random'];
}
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
  const tileChars = getSelectTiles();
  const p2Idx = Math.max(0, tileChars.indexOf('nang'));
  slots = [{ src: null, cur: 0, locked: false, char: 'nong' }, { src: null, cur: p2Idx, locked: false, char: 'nang' }];
  if (mode !== 'versus') slots[0].src = 'solo';
  $('#pan1').innerHTML = panelHtml(0);
  $('#pan2').innerHTML = panelHtml(1);
  const tiles = $('#tiles');
  const tileHtml = (c: CharId | 'random') => c === 'random'
    ? `<button class="tile rnd" data-c="random"><span class="tn">RANDOM</span><span class="cur c1">P1</span><span class="cur c2">P2</span></button>`
    : `<button class="tile" data-c="${c}"><img src="${portraitUrl(c)}" alt=""><div><div class="tn" style="color:${CHARS[c].color}">${CHARS[c].name}</div><div class="ts">${CHARS[c].title.toUpperCase()}</div></div><span class="cur c1">P1</span><span class="cur c2">${mode === 'cpu' ? 'CPU' : 'P2'}</span></button>`;
  tiles.innerHTML = tileChars.map(tileHtml).join('');
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

function slotChar(s: Slot): CharId { const c = getSelectTiles()[s.cur]; return !c || c === 'random' ? (s.char || 'nong') : c; }

function paintSelect() {
  const tileChars = getSelectTiles();
  const tiles = $('#tiles').querySelectorAll('.tile');
  tiles.forEach((el, i) => {
    el.classList.toggle('h1', !!slots[0].src && slots[0].cur === i);
    el.classList.toggle('h2', (!!slots[1].src || (mode === 'cpu' && slots[0].locked) || (mode === 'online' && onlineOppChar !== null)) && slots[1].cur === i);
  });
  for (const i of [0, 1] as const) {
    const s = slots[i];
    const pan = $(i === 0 ? '#pan1' : '#pan2');
    let c: CharId = tileChars[s.cur] === 'random' || !tileChars[s.cur] ? (i === 0 ? 'nong' : 'nang') : (tileChars[s.cur] as CharId);
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
    const src = isAlt ? altPortrait[c] : portraitUrl(c);
    if (img.dataset.src !== src) { img.src = src; img.dataset.src = src; img.classList.remove('pop'); void img.offsetWidth; img.classList.add('pop'); }
    const random = tileChars[s.cur] === 'random' && !s.locked;
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
  const tileChars = getSelectTiles();
  const unlocked = getUnlockedChars();
  const c = tileChars[s.cur];
  s.char = c === 'random' || !c ? unlocked[Math.floor(Math.random() * unlocked.length)] : c;
  if (c === 'random') s.cur = Math.max(0, tileChars.indexOf(s.char));
  s.locked = true;
  audio.play('join');
  menuFx.burst(i === 0 ? 240 : 1040, 400, 30, charColor(s.char, false), 400);
  if (mode === 'cpu' && i === 0) {
    // CPU takes a different fighter
    slots[1].src = null;
    const others = unlocked.filter((ch) => ch !== s.char);
    slots[1].char = others.length ? others[Math.floor(Math.random() * others.length)] : (s.char === 'nong' ? 'nang' : 'nong');
    slots[1].cur = Math.max(0, tileChars.indexOf(slots[1].char));
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
  const n = getSelectTiles().length;
  if (s.locked) {
    if (e.a === 'back' && !(mode === 'cpu' && slots[1].locked)) { s.locked = false; audio.play('menuBack'); paintSelect(); }
    else if (e.a === 'back' && mode === 'cpu') { slots[0].locked = false; slots[1].locked = false; audio.play('menuBack'); paintSelect(); }
    return;
  }
  if (e.a === 'left' || e.a === 'up') { s.cur = (s.cur + n - 1) % n; audio.play('menuMove'); paintSelect(); }
  else if (e.a === 'right' || e.a === 'down') { s.cur = (s.cur + 1) % n; audio.play('menuMove'); paintSelect(); }
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
  const pa = a.alt ? altPortrait[a.char] : portraitUrl(a.char);
  const pb = b.alt ? altPortrait[b.char] : portraitUrl(b.char);
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
  const touchItems: MItem[] = (isTouch || settings.touch !== 'off') && mode !== 'versus'
    ? [
        { t: 'CONTROLS: ' + (settings.touch === 'buttons' ? 'BUTTONS' : 'SWIPE'), s: 'Tap to switch between Swipe & Buttons', act: () => { toggleTouchMode(); pause(); } },
        { t: 'CUSTOMIZE BUTTONS', s: 'Move, resize or hide mobile buttons', act: () => openTouchCustomizer('pause') },
      ]
    : [];
  const items: MItem[] = mode === 'online'
    ? [{ t: 'RESUME', act: resume }, ...touchItems, { t: 'LEAVE MATCH', act: () => { resume(); net.leaveDuel(); goMenu(); } }]
    : [{ t: 'RESUME', act: resume }, ...touchItems, { t: 'RESTART MATCH', act: () => { resume(); if (lastCfg) startBattle(lastCfg[0], lastCfg[1]); } }, { t: 'SETTINGS', act: () => goSettings('pause') }, { t: 'QUIT TO MENU', act: () => { battle = null; goMenu(); } }];
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
  for (const t of tot) { record.quads += t.quads; record.bestCombo = Math.max(record.bestCombo, t.maxCombo); }
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
  { k: 'MOBILE CONTROLS', sub: 'Swipe gestures (default) or full Left/Right buttons', get: () => settings.touch.toUpperCase(), change: (d) => { settings.touch = cycle(['swipe', 'buttons', 'off'] as const, settings.touch, d); updateTouch(); } },
  { k: 'BUTTON LAYOUT', sub: 'Drag, resize & show/hide mobile buttons', get: () => 'CUSTOMIZE', change: () => { openTouchCustomizer('settings'); } },
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
      SET_ROWS[i].change(d ? +d.dataset.d! : 1);
      if (screen !== 'settings') return;
      save(); audio.play('menuMove'); paintSettings();
    });
  });
}
function leaveSettings() {
  audio.play('menuBack'); save();
  if (battle) { battle.fx.shakeOn = settings.shake; battle.fx.reduced = settings.reducedFlash; }
  if (setFrom === 'pause') { pause(); } else goMenu();
}
handlers.settings = (e) => {
  const n = SET_ROWS.length + 1;
  if (e.a === 'up') { setIdx = (setIdx + n - 1) % n; audio.play('menuMove'); paintSettings(); }
  else if (e.a === 'down') { setIdx = (setIdx + 1) % n; audio.play('menuMove'); paintSettings(); }
  else if ((e.a === 'left' || e.a === 'right') && setIdx < SET_ROWS.length) { SET_ROWS[setIdx].change(e.a === 'left' ? -1 : 1); if (screen === 'settings') { save(); audio.play('menuMove'); paintSettings(); } }
  else if (e.a === 'confirm') { if (setIdx === SET_ROWS.length) leaveSettings(); else { SET_ROWS[setIdx].change(1); if (screen === 'settings') { save(); audio.play('menuMove'); paintSettings(); } } }
  else if (e.a === 'back') leaveSettings();
};

// ---------------------------------------------------------------- how to play
let howTab = 0;
const HOW = [
  {
    t: 'RULES', cols: [
      `<h5>THE GOAL</h5><p>Clear lines to attack. Every attack drops grey garbage into your rival's well. If their stack spills over the top, they're K.O.</p><p>Win rounds to win the match. Pieces fall faster the longer a round runs.</p>`,
      `<h5>ATTACKS</h5><table><tr><td>Single</td><td>0</td></tr><tr><td>Double</td><td>1</td></tr><tr><td>Triple</td><td>2</td></tr><tr><td>Quad (4 lines)</td><td>4</td></tr><tr><td>T-Spin Single / Double / Triple</td><td>2 / 4 / 6</td></tr><tr><td>Back-to-back bonus</td><td>+1</td></tr><tr><td>Combo (clears in a row)</td><td>+1 to +5</td></tr><tr><td>All Clear</td><td>+10</td></tr></table>`,
      `<h5>DEFENSE &amp; SUPERS</h5><p>Incoming garbage waits on the meter beside your well. Orange is still on its way. Red will rise on your next piece. Attack back to cancel it out.</p><p>Clearing lines fills your <b>Super</b> bar. When it says SUPER READY, fire your fighter's special move.</p><p>Nong's <b>Shadow Slam</b> erases incoming garbage and hits for 4. Nang's <b>Emerald Burst</b> blows away your bottom 4 rows and hits for 2. Stucchi's <b>Arya Attack!</b> sends his husky Arya lunging to cancel 3 incoming, clear 2 rows &amp; hit for 3.</p>`,
    ],
  },
  {
    t: 'CONTROLS', cols: [
      `<h5>PHONE · SWIPE &amp; BUTTONS</h5><table><tr><td>Slide left / right</td><td>Move</td></tr><tr><td>Tap screen</td><td>Rotate</td></tr><tr><td>Flick straight down</td><td>Hard drop</td></tr><tr><td>Hold down</td><td>Soft drop</td></tr><tr><td>Flick up / Tap Hold</td><td>Hold piece</td></tr><tr><td>Tap Super</td><td>Fire Super</td></tr></table><p style="margin-top:8px">Tap <b>SWIPE</b> at the top of a match to switch to <b>BUTTONS</b> mode, or open <b>Pause / Settings → Customize Buttons</b> to drag &amp; resize any button.</p>`,
      `<h5>KEYBOARD · P1 &amp; P2</h5><table><tr><td>P1 Move / Drop</td><td><kbd>A</kbd><kbd>D</kbd> / <kbd>S</kbd> <kbd>Space</kbd></td></tr><tr><td>P1 Rotate / Hold / Super</td><td><kbd>W</kbd><kbd>Q</kbd> / <kbd>E</kbd> / <kbd>R</kbd></td></tr><tr><td>P2 Move / Drop</td><td><kbd>←</kbd><kbd>→</kbd> / <kbd>↓</kbd> <kbd>Enter</kbd></td></tr><tr><td>P2 Rotate / Hold / Super</td><td><kbd>↑</kbd><kbd>/</kbd> / <kbd>Shift</kbd> / <kbd>.</kbd></td></tr></table><p style="margin-top:8px">Playing solo? Both key sets work, plus <kbd>Z</kbd><kbd>X</kbd> rotate, <kbd>C</kbd> hold, <kbd>V</kbd> super.</p>`,
      `<h5>CONTROLLER</h5><table><tr><td>Move / soft drop</td><td>D-pad or stick</td></tr><tr><td>Hard drop</td><td>D-pad ↑</td></tr><tr><td>Rotate right / left</td><td>Ⓐ / Ⓑ</td></tr><tr><td>Hold</td><td>Ⓧ or bumpers</td></tr><tr><td>Super</td><td>Ⓨ</td></tr><tr><td>Pause</td><td>Start</td></tr></table>`,
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
    if (p.ch) { slots[1].char = p.ch; slots[1].cur = Math.max(0, getSelectTiles().indexOf(p.ch)); }
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

// ---------------------------------------------------------------- touch controls & FPS-style HUD customizer
type TouchModeKey = 'swipe' | 'buttons';
interface TouchBtnDef {
  id: keyof typeof input.touch;
  icon: string;
  label: string;
  cls?: string;
  dpad?: boolean;
  wing: 'left' | 'right';
  swipe: [number, number, number, number, boolean];   // [x, y, w, h, defaultOn] in SWIPE mode
  buttons: [number, number, number, number, boolean]; // [x, y, w, h, defaultOn] in BUTTONS mode
}

// Ergonomic landscape thumb arcs:
// On wide phones (like iPhone 16), left/right buttons automatically shift outward into the widescreen side wings (`extraX`).
// Every button can also be dragged anywhere, resized (60%–165%), or toggled ON/OFF in the Button Customizer.
const TOUCH_BTNS: TouchBtnDef[] = [
  { id: 'left',  icon: '◀', label: 'LEFT',   dpad: true, wing: 'left',  swipe: [8, 514, 92, 92, false],    buttons: [8, 514, 92, 92, true] },
  { id: 'right', icon: '▶', label: 'RIGHT',  dpad: true, wing: 'left',  swipe: [106, 514, 92, 92, false],  buttons: [106, 514, 92, 92, true] },
  { id: 'soft',  icon: '▼', label: 'DOWN',   dpad: true, wing: 'left',  swipe: [57, 614, 92, 78, false],   buttons: [57, 614, 92, 78, true] },
  { id: 'hold',  icon: '⇄', label: 'HOLD',               wing: 'left',  swipe: [12, 468, 88, 74, true],    buttons: [12, 424, 88, 76, true] },
  { id: 'ccw',   icon: '⟲', label: 'TURN',               wing: 'left',  swipe: [12, 554, 88, 74, true],    buttons: [1066, 452, 84, 84, true] },
  { id: 'cw',    icon: '⟳', label: 'ROTATE', cls: 'pri', wing: 'right', swipe: [1166, 510, 102, 102, false], buttons: [1166, 510, 102, 102, true] },
  { id: 'hard',  icon: '⬇', label: 'DROP',   cls: 'drp', wing: 'right', swipe: [1180, 554, 88, 74, true],  buttons: [1056, 554, 94, 94, true] },
  { id: 'super', icon: '★', label: 'SUPER',  cls: 'sup', wing: 'right', swipe: [1180, 468, 88, 74, true],  buttons: [1172, 412, 92, 80, true] },
];

const touchEls: { def: TouchBtnDef; el: HTMLButtonElement }[] = [];
let superBtns: HTMLButtonElement[] = [];
let cfgFrom: ScreenId = 'settings';
let cfgMode: TouchModeKey = 'swipe';
let cfgSelected: keyof typeof input.touch = 'hard';

function getDefaultBtnState(def: TouchBtnDef, m: TouchModeKey) {
  const base = m === 'buttons' ? def.buttons : def.swipe;
  // In BUTTONS mode, ccw ('TURN') sits on the right cluster; in SWIPE mode it sits on the left
  const wing = m === 'buttons' && def.id === 'ccw' ? 'right' : def.wing;
  const wingShift = Math.min(extraX, 115);
  const dx = wing === 'left' ? -wingShift : wingShift;
  return { x: base[0] + dx, y: base[1], w: base[2], h: base[3], s: 1, on: base[4] };
}

function getBtnState(def: TouchBtnDef, m: TouchModeKey) {
  const d = getDefaultBtnState(def, m);
  const saved = settings.touchLayout?.[m + ':' + def.id];
  const s = saved?.s ? Math.max(0.6, Math.min(1.65, saved.s)) : d.s;
  const w = Math.round(d.w * s);
  const h = Math.round(d.h * s);
  const rawX = saved && typeof saved.x === 'number' ? saved.x : d.x;
  const rawY = saved && typeof saved.y === 'number' ? saved.y : d.y;
  const x = Math.max(-extraX + 4, Math.min(W + extraX - w - 4, rawX));
  const y = Math.max(12, Math.min(H - h - 8, rawY));
  const on = saved && typeof saved.on === 'boolean' ? saved.on : d.on;
  return { x, y, w, h, s, on };
}

function ensureBtnCustom(def: TouchBtnDef, m: TouchModeKey) {
  if (!settings.touchLayout) settings.touchLayout = {};
  const key = m + ':' + def.id;
  if (!settings.touchLayout[key]) {
    const st = getBtnState(def, m);
    settings.touchLayout[key] = { x: st.x, y: st.y, s: st.s, on: st.on };
  }
  return settings.touchLayout[key];
}

function setTouchControl(id: keyof typeof input.touch, v: boolean, el?: HTMLElement) {
  (input.touch as any)[id] = v;
  if (v) input.held.add(id); else input.held.delete(id);
  if (el) el.classList.toggle('on', v);
}

function toggleTouchMode() {
  settings.touch = settings.touch === 'buttons' ? 'swipe' : 'buttons';
  save();
  audio.play('menuSelect');
  updateTouch();
  toast(settings.touch === 'buttons' ? 'BUTTONS MODE · Left/Right thumb controls' : 'SWIPE MODE · Slide, tap & flick');
}

function openTouchCustomizer(from: ScreenId) {
  cfgFrom = from;
  cfgMode = settings.touch === 'buttons' ? 'buttons' : 'swipe';
  cfgSelected = 'hard';
  audio.play('menuSelect');
  show('touchcfg', true);
  paintTouchCfg();
}

function paintTouchCfg() {
  const def = TOUCH_BTNS.find((b) => b.id === cfgSelected) || TOUCH_BTNS[0];
  const st = getBtnState(def, cfgMode);
  $('#cfglbl').textContent = `${def.label} · ${Math.round(st.s * 100)}%`;
  $('#cfgmode').textContent = `MODE: ${cfgMode.toUpperCase()}`;
  $('#cfgtog').textContent = st.on ? 'HIDE' : 'SHOW';
  for (const { def: b, el } of touchEls) {
    el.classList.toggle('cfg-sel', screen === 'touchcfg' && b.id === cfgSelected);
  }
}

function closeTouchCustomizer() {
  save();
  audio.play('menuSelect');
  toast('Button layout saved');
  if (cfgFrom === 'pause') pause();
  else goSettings(setFrom);
}
handlers.touchcfg = (e) => { if (e.a === 'back' || e.a === 'pause') closeTouchCustomizer(); };

function buildTouch() {
  const root = $('#touch');
  const dpadPtrs = new Map<number, { id: keyof typeof input.touch; el: HTMLButtonElement }>();
  const pt = (e: PointerEvent): [number, number] => {
    const r = stage.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  let dragState: { pid: number; def: TouchBtnDef; el: HTMLButtonElement; sx: number; sy: number; bx: number; by: number } | null = null;

  for (const b of TOUCH_BTNS) {
    const el = document.createElement('button');
    if (b.cls) el.className = b.cls;
    el.dataset.cid = b.id;
    el.innerHTML = `<span class="ic">${b.icon}</span><span class="lb">${b.label}</span>`;
    if (b.id === 'super') superBtns.push(el);

    // Customizer drag & select support (active when screen === 'touchcfg')
    el.addEventListener('pointerdown', (e) => {
      if (screen !== 'touchcfg') return;
      e.preventDefault(); e.stopPropagation();
      cfgSelected = b.id;
      audio.play('menuMove');
      const [sx, sy] = pt(e);
      const st = getBtnState(b, cfgMode);
      dragState = { pid: e.pointerId, def: b, el, sx, sy, bx: st.x, by: st.y };
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      updateTouch();
      paintTouchCfg();
    }, true);

    el.addEventListener('pointermove', (e) => {
      if (screen !== 'touchcfg' || !dragState || dragState.pid !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      const [x, y] = pt(e);
      const c = ensureBtnCustom(dragState.def, cfgMode);
      const d = getDefaultBtnState(dragState.def, cfgMode);
      const w = Math.round(d.w * c.s), h = Math.round(d.h * c.s);
      c.x = Math.max(-extraX + 4, Math.min(W + extraX - w - 4, Math.round(dragState.bx + (x - dragState.sx))));
      c.y = Math.max(12, Math.min(H - h - 8, Math.round(dragState.by + (y - dragState.sy))));
      updateTouch();
      paintTouchCfg();
    }, true);

    const endCfgDrag = (e: PointerEvent) => {
      if (!dragState || dragState.pid !== e.pointerId) return;
      e.preventDefault(); e.stopPropagation();
      dragState = null;
      save();
    };
    el.addEventListener('pointerup', endCfgDrag, true);
    el.addEventListener('pointercancel', endCfgDrag, true);

    if (b.dpad) {
      // Rocker D-pad: sliding thumb between ◀, ▶, and ▼ smoothly switches direction without lifting
      el.addEventListener('pointerdown', (e) => {
        if (screen === 'touchcfg') return;
        e.preventDefault(); e.stopPropagation(); audio.unlock();
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        dpadPtrs.set(e.pointerId, { id: b.id, el });
        setTouchControl(b.id, true, el);
      });
      el.addEventListener('pointermove', (e) => {
        if (screen === 'touchcfg') return;
        const cur = dpadPtrs.get(e.pointerId);
        if (!cur) return;
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('button') as HTMLButtonElement | null;
        const nextId = hit?.dataset.cid as keyof typeof input.touch | undefined;
        if (hit && (nextId === 'left' || nextId === 'right' || nextId === 'soft') && nextId !== cur.id) {
          setTouchControl(cur.id, false, cur.el);
          dpadPtrs.set(e.pointerId, { id: nextId, el: hit });
          setTouchControl(nextId, true, hit);
        }
      });
      const endDpad = (e: PointerEvent) => {
        const cur = dpadPtrs.get(e.pointerId);
        if (!cur) return;
        dpadPtrs.delete(e.pointerId);
        setTouchControl(cur.id, false, cur.el);
      };
      el.addEventListener('pointerup', endDpad);
      el.addEventListener('pointercancel', endDpad);
    } else {
      const on = (v: boolean) => (e: PointerEvent) => {
        if (screen === 'touchcfg') return;
        e.preventDefault(); e.stopPropagation();
        if (v) audio.unlock();
        setTouchControl(b.id, v, el);
      };
      el.addEventListener('pointerdown', on(true));
      el.addEventListener('pointerup', on(false));
      el.addEventListener('pointerleave', on(false));
      el.addEventListener('pointercancel', on(false));
    }
    root.appendChild(el);
    touchEls.push({ def: b, el });
  }

  // Customizer top toolbar buttons
  $('#cfgmode').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    cfgMode = cfgMode === 'swipe' ? 'buttons' : 'swipe';
    settings.touch = cfgMode;
    audio.play('menuMove');
    updateTouch();
    paintTouchCfg();
  });
  const resizeSel = (ds: number) => (e: Event) => {
    e.preventDefault(); e.stopPropagation();
    const def = TOUCH_BTNS.find((b) => b.id === cfgSelected);
    if (!def) return;
    const c = ensureBtnCustom(def, cfgMode);
    c.s = Math.max(0.6, Math.min(1.65, Math.round((c.s + ds) * 10) / 10));
    audio.play('menuMove');
    updateTouch();
    paintTouchCfg();
  };
  $('#cfgszdn').addEventListener('click', resizeSel(-0.1));
  $('#cfgszup').addEventListener('click', resizeSel(0.1));
  $('#cfgtog').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const def = TOUCH_BTNS.find((b) => b.id === cfgSelected);
    if (!def) return;
    const c = ensureBtnCustom(def, cfgMode);
    c.on = !c.on;
    audio.play('menuMove');
    updateTouch();
    paintTouchCfg();
  });
  $('#cfgrst').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (settings.touchLayout) {
      for (const k of Object.keys(settings.touchLayout)) {
        if (k.startsWith(cfgMode + ':')) delete settings.touchLayout[k];
      }
    }
    save();
    audio.play('menuBack');
    updateTouch();
    paintTouchCfg();
    toast(cfgMode.toUpperCase() + ' buttons reset to default');
  });
  $('#cfgsave').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    closeTouchCustomizer();
  });

  $('#touchmodebtn').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    toggleTouchMode();
  });

  // Multi-touch gesture surface across the stage:
  // - Tracks each finger independently so two thumbs never cancel each other.
  // - Tapping the HOLD box or SUPER bar on the HUD triggers Hold / Super directly.
  // - In SWIPE mode: forgiving drag sideways to move, tap to rotate, straight-down flick to drop, hold down to soft drop, flick up to hold.
  const g = $('#gest');
  interface PtrTrack { sx: number; sy: number; lx: number; st: number; moved: number; softing: boolean; }
  const ptrs = new Map<number, PtrTrack>();
  const syncSoft = () => {
    let anySoft = false;
    for (const p of ptrs.values()) if (p.softing) { anySoft = true; break; }
    input.touch.soft = anySoft || input.held.has('soft');
  };

  g.addEventListener('pointerdown', (e) => {
    if (screen === 'touchcfg') return;
    e.preventDefault(); audio.unlock();
    const [x, y] = pt(e);
    // Direct HUD tap zones: P1 HOLD panel (top-left) and P1 SUPER bar (bottom of well)
    if (x >= 4 && x <= 108 && y >= 120 && y <= 220) {
      input.taps.push('hold');
      return;
    }
    if (x >= 108 && x <= 394 && y >= 672 && y <= 718) {
      input.taps.push('super');
      return;
    }
    ptrs.set(e.pointerId, { sx: x, sy: y, lx: x, st: performance.now(), moved: 0, softing: false });
    try { g.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  g.addEventListener('pointermove', (e) => {
    const tr = ptrs.get(e.pointerId);
    if (!tr) return;
    if (settings.touch === 'buttons') return; // In BUTTONS mode, use the Left/Right buttons for movement
    const [x, y] = pt(e);
    const step = 25;
    while (x - tr.lx > step) { input.taps.push('right'); tr.lx += step; tr.moved++; }
    while (tr.lx - x > step) { input.taps.push('left'); tr.lx -= step; tr.moved++; }
    // Forgiving soft-drop hold: pull down and hold
    if (!tr.softing && tr.moved <= 1 && y - tr.sy > 48 && Math.abs(x - tr.sx) < 55 && performance.now() - tr.st > 180) {
      tr.softing = true;
      syncSoft();
    } else if (tr.softing && y - tr.sy < 24) {
      tr.softing = false;
      syncSoft();
    }
  });

  const end = (e: PointerEvent) => {
    const tr = ptrs.get(e.pointerId);
    if (!tr) return;
    ptrs.delete(e.pointerId);
    const [x, y] = pt(e);
    const dt = performance.now() - tr.st, dy = y - tr.sy, dx = x - tr.sx;
    if (tr.softing) { syncSoft(); return; }
    if (settings.touch === 'buttons') {
      // In BUTTONS mode, tapping the board still rotates for convenience, without swipe drops
      if (Math.abs(dx) < 22 && Math.abs(dy) < 22 && dt < 360) input.taps.push('cw');
      return;
    }
    // Strict vertical-only flick for hard drop so sliding left/right never accidentally slams a piece
    if (tr.moved === 0 && dy > 68 && dt < 260 && Math.abs(dx) < Math.abs(dy) * 0.55) {
      input.taps.push('hard');
    } else if (tr.moved === 0 && dy < -58 && dt < 300 && Math.abs(dx) < Math.abs(dy) * 0.65) {
      input.taps.push('hold');
    } else if (tr.moved === 0 && Math.abs(dx) < 22 && Math.abs(dy) < 22 && dt < 360) {
      input.taps.push('cw');
    }
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
}

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
function updateTouch() {
  const editing = screen === 'touchcfg';
  const activeMode: TouchModeKey | 'off' = editing
    ? cfgMode
    : settings.touch === 'off' ? 'off' : settings.touch === 'buttons' ? 'buttons' : (isTouch || settings.touch === 'swipe' ? 'swipe' : 'off');
  const on = editing || (activeMode !== 'off' && screen === 'battle' && mode !== 'versus' && (isTouch || settings.touch === 'buttons'));
  const root = $('#touch');
  root.classList.toggle('on', on);
  root.classList.toggle('editing', editing);
  const modeKey: TouchModeKey = activeMode === 'buttons' ? 'buttons' : 'swipe';
  for (const { def, el } of touchEls) {
    const st = getBtnState(def, modeKey);
    el.style.left = st.x + 'px';
    el.style.top = st.y + 'px';
    el.style.width = st.w + 'px';
    el.style.height = st.h + 'px';
    el.style.setProperty('--bs', String(st.s));
    el.classList.toggle('btn-hidden', !st.on);
    el.classList.toggle('cfg-sel', editing && def.id === cfgSelected);
  }
  const mbtn = $('#touchmodebtn');
  if (mbtn) {
    mbtn.classList.toggle('on', !editing && on);
    mbtn.textContent = modeKey === 'buttons' ? 'BUTTONS' : 'SWIPE';
  }
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
  ctx.clearRect(-extraX, 0, W + extraX * 2, H);
  if (battle && (screen === 'battle' || screen === 'pause' || screen === 'results' || screen === 'touchcfg' || (screen === 'settings' && setFrom === 'pause'))) {
    battle.update(dt);
    onlineTick(dt);
    battle.draw(ctx, drawBg);
    menuFx.draw(ctx, FONT_D);
    // Highlight on-screen SUPER button when Super meter is full
    const p1 = battle.sides[0]?.board;
    const supReady = !!p1 && p1.superMeter >= p1.rules.superCost;
    for (const sb of superBtns) {
      sb.classList.toggle('super-ready', supReady);
      const lb = sb.querySelector('.lb');
      if (lb) lb.textContent = supReady ? 'READY!' : 'SUPER';
    }
    if (screen === 'battle' && $('#touch').classList.contains('on') && battle.round === 1 && (battle.phase === 'intro' || battle.phase === 'fight')) {
      ctx.save(); ctx.textAlign = 'center'; ctx.font = `600 16px 'Chakra Petch', sans-serif`;
      ctx.fillStyle = 'rgba(5,5,20,0.84)'; ctx.fillRect(112, 534, 278, 98);
      ctx.strokeStyle = 'rgba(255,207,74,0.45)'; ctx.lineWidth = 1.5; ctx.strokeRect(112, 534, 278, 98);
      ctx.fillStyle = '#fff';
      const lines = settings.touch === 'buttons'
        ? ['Use ◀ ▶ on left to move', 'Tap ⟳ ROTATE or board to turn', 'Pause (II) → Customize Buttons']
        : ['Slide left / right to move', 'Tap to rotate · flick down to drop', 'Pause (II) → Customize Buttons'];
      lines.forEach((t, i) => {
        ctx.fillStyle = i === 2 ? '#ffcf4a' : '#fff';
        ctx.fillText(t, 251, 560 + i * 26);
      });
      ctx.restore();
    }
  } else {
    const [sx, sy] = menuFx.shakeOffset(now);
    ctx.save(); ctx.translate(sx, sy);
    drawBg(ctx, time, bgMode === 'select' ? 0.55 : bgMode === 'menu' ? 0.25 : 0.35);
    if (screen === 'touchcfg') {
      // Draw board reference outlines when customizing buttons from the main Settings menu
      ctx.save();
      ctx.fillStyle = 'rgba(6,5,22,0.8)';
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      for (const [bx, lbl] of [[116, 'YOUR WELL (P1)'], [1280 - 116 - 270, 'RIVAL WELL (P2)']] as const) {
        ctx.fillRect(bx, 128, 270, 540);
        ctx.strokeRect(bx, 128, 270, 540);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = `22px ${FONT_D}`;
        ctx.textAlign = 'center';
        ctx.fillText(lbl, bx + 135, 400);
        ctx.fillStyle = 'rgba(6,5,22,0.8)';
      }
      ctx.strokeRect(14, 128, 90, 86);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `14px ${FONT_D}`;
      ctx.fillText('HOLD BOX', 59, 176);
      ctx.restore();
    } else if (bgMode === 'title' || bgMode === 'menu') {
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
fit();
input.onAnyInput = () => { audio.unlock(); if (screen === 'title') { /* handled by nav */ } };
window.addEventListener('pointerdown', () => audio.unlock());
async function boot() {
  const bar = $('#s-loading .bar i');
  const fonts = (document as any).fonts;
  const fontP = fonts ? Promise.race([Promise.all([fonts.load(`40px 'Bungee'`), fonts.load(`600 16px 'Chakra Petch'`)]), new Promise((r) => setTimeout(r, 2500))]) : Promise.resolve();
  await Promise.all([loadAll((f) => { bar.style.width = Math.round(f * 100) + '%'; }), fontP]);
  for (const id of Object.keys(CHARS) as CharId[]) {
    try { altPortrait[id] = (art.chars[id].portraitAlt as HTMLCanvasElement).toDataURL('image/png'); } catch { altPortrait[id] = portraitUrl(id); }
  }
  audio.setVolumes(settings.music, settings.sfx);
  buildMainMenu();
  buildTouch();
  updateTouch();
  if (STANDALONE) {
    const h = location.hash.replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(h)) { pendingJoin = h; history.replaceState(null, '', location.pathname + location.search); }
    $('#s-title .press').textContent = pendingJoin ? 'TAP TO JOIN THE FIGHT' : 'PRESS ANY BUTTON';
  }
  goTitle();
  // hidden test hooks for automated play-testing and secret character unlocking
  (window as any).__bc = { get battle() { return battle; }, get screen() { return screen; }, unlockSecretChar, openTouchCustomizer, autoPlay: (d: Difficulty = 'normal') => { const s = battle && battle.sides[0]; if (s) { s.cfg.kind = 'cpu'; s.cpu = new CpuController(d); (battle as any).autoDiff = d; } }, startCpuDemo: (d: Difficulty = 'hard', d2: Difficulty = d) => { mode = 'cpu'; const a: SideCfg = { kind: 'cpu', diff: d2, char: 'nong', alt: false, label: 'CPU A' }; const b: SideCfg = { kind: 'cpu', diff: d, char: 'nang', alt: false, label: 'CPU B' }; startBattle(a, b); }, net };
}
requestAnimationFrame(frame);
boot();
