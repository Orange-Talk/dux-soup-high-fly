import nongAtlas from '../assets/nong_atlas.webp';
import nangAtlas from '../assets/nang_atlas.webp';
import nongPortrait from '../assets/nong_portrait.webp';
import nangPortrait from '../assets/nang_portrait.webp';
import bgUrl from '../assets/bg.webp';
import strikeUrl from '../assets/fx_energy_strike.webp';
import burstUrl from '../assets/fx_flame_burst.webp';
import warnUrl from '../assets/icon_garbage_warning.webp';
import atlasMeta from '../assets/atlas.json';

export type CharId = 'nong' | 'nang' | 'stucchi';
export type Img = HTMLImageElement | HTMLCanvasElement;

export interface CharArt {
  atlas: Img; atlasAlt: Img; portrait: Img; portraitAlt: Img;
  frames: Record<string, number[]>;
}

export const META = atlasMeta as { cell: number; cols: number; frames: Record<string, Record<string, number[]>> };
export const URLS = { nongPortrait, nangPortrait, bgUrl };
export const PORTRAIT_URLS: Record<CharId, string> = { nong: nongPortrait, nang: nangPortrait, stucchi: nongPortrait };
export const portraitUrl = (id: CharId): string => PORTRAIT_URLS[id] || nongPortrait;

export const art: {
  chars: Record<CharId, CharArt>;
  bg: Img; strike: Img; burst: Img; warn: Img;
  ready: boolean;
} = { chars: {} as any, bg: null as any, strike: null as any, burst: null as any, warn: null as any, ready: false };

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}
function hsv2rgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Build Stucchi + Arya pixel-art portrait (ribbed olive beanie, dark Italian beard, Radio Rental hoodie, blue/orange Nikes, and Arya sitting beside him) */
function buildStucchiPortrait(src: HTMLImageElement): HTMLCanvasElement {
  const W = src.naturalWidth, H = src.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  try {
    const imgD = ctx.getImageData(0, 0, W, H);
    const p = imgD.data;
    const setBlock = (bx: number, by: number, bw: number, bh: number, r: number, g: number, b: number, a = 255) => {
      for (let y = by; y < by + bh; y++) {
        if (y < 0 || y >= H) continue;
        for (let x = bx; x < bx + bw; x++) {
          if (x < 0 || x >= W) continue;
          const i = (y * W + x) * 4;
          p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = a;
        }
      }
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (p[i + 3] < 16) continue;
        const r = p[i], g = p[i + 1], b = p[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0;

        // 1) Ribbed olive-green knit beanie (y <= 54)
        if (y <= 54) {
          const isOuterEdge = mx < 22 && (y < 14 || x < 84 || x > 160);
          if (!isOuterEdge) {
            if (y >= 49 && x >= 92 && x <= 132) {
              p[i] = 24; p[i + 1] = 19; p[i + 2] = 17;
            } else if (y >= 34 && y <= 49) {
              const rib = Math.floor(x / 4) % 2 === 0;
              if (y <= 36) {
                p[i] = 44; p[i + 1] = 68; p[i + 2] = 50;
              } else {
                p[i] = rib ? 92 : 74;
                p[i + 1] = rib ? 134 : 110;
                p[i + 2] = rib ? 102 : 82;
              }
            } else {
              const rib = Math.floor(x / 4) % 2 === 0;
              const hi = y < 22 && x >= 104 && x <= 140 ? 10 : 0;
              p[i] = (rib ? 78 : 66) + hi;
              p[i + 1] = (rib ? 116 : 100) + hi;
              p[i + 2] = (rib ? 88 : 74) + hi;
            }
          }
          continue;
        }
        // 2) Face, dark espresso beard & hair (y = 55..148)
        if (y <= 148) {
          const isBrown = r > g + 16 && g > b + 12 && r < 210 && (r - b) > 32;
          if (isBrown) {
            p[i] = Math.round(r * 0.20 + 8);
            p[i + 1] = Math.round(g * 0.21 + 6);
            p[i + 2] = Math.round(b * 0.25 + 6);
          } else if (r > 200 && g > 140 && b > 110) {
            const cheek = y >= 84 && y <= 102 && ((x >= 88 && x <= 106) || (x >= 138 && x <= 156));
            p[i] = Math.min(255, Math.round(r * 0.98));
            p[i + 1] = Math.round(g * (cheek ? 0.89 : 0.95));
            p[i + 2] = Math.round(b * (cheek ? 0.87 : 0.93));
          }
          continue;
        }
        // 3) Hoodie (y = 149..303)
        if (y <= 303) {
          if (sat < 0.25 && mx >= 18 && mx <= 95) {
            const v2 = Math.min(44, mx);
            p[i] = Math.round(v2 * 0.82);
            p[i + 1] = Math.round(v2 * 0.88);
            p[i + 2] = Math.round(v2 * 1.12);
          }
          continue;
        }
        // 4) Black athletic pants (y = 304..472)
        if (y <= 472) {
          if (sat < 0.25 && mx >= 25) {
            p[i] = Math.round(r * 0.42);
            p[i + 1] = Math.round(g * 0.44);
            p[i + 2] = Math.round(b * 0.50);
          }
          continue;
        }
        // 5) Electric blue & orange Nike sneakers (y > 472)
        if (y > 472 && mx >= 16) {
          if (y >= 506) {
            const isOrange = y >= 510;
            p[i] = isOrange ? 255 : 238;
            p[i + 1] = isOrange ? 92 : 240;
            p[i + 2] = isOrange ? 38 : 245;
          } else if (y >= 492 && ((x >= 46 && x <= 70) || (x >= 174 && x <= 198))) {
            p[i] = 255; p[i + 1] = 96; p[i + 2] = 36;
          } else {
            const k = Math.max(0.55, Math.min(1.2, mx / 45));
            p[i] = Math.min(255, Math.round(24 * k));
            p[i + 1] = Math.min(255, Math.round(154 * k));
            p[i + 2] = Math.min(255, Math.round(236 * k));
          }
        }
      }
    }

    // Full Italian mustache & soul patch
    setBlock(104, 104, 36, 6, 26, 20, 18);
    setBlock(100, 108, 44, 6, 22, 17, 15);
    setBlock(116, 118, 12, 8, 26, 20, 18);

    // Radio Rental chest print + crisp white hoodie drawstrings
    for (let x = 90; x <= 150; x += 8) {
      setBlock(x, 178, 6, 6, 228, 62, 44);
      if (x >= 96 && x <= 144) setBlock(x, 188, 6, 6, 228, 62, 44);
    }
    setBlock(100, 198, 44, 18, 232, 178, 46);
    setBlock(114, 198, 16, 22, 214, 218, 226);
    setBlock(104, 202, 8, 10, 26, 28, 38);
    setBlock(132, 202, 8, 10, 26, 28, 38);
    setBlock(108, 158, 4, 54, 240, 238, 232);
    setBlock(132, 158, 4, 50, 240, 238, 232);

    // Paint Arya (all-white Husky with light-brown ear/forehead accents & snow nose) sitting beside Stucchi
    const S = 4;
    const ax0 = 148;
    const aryaMap = [
      "  OOO          OOO      ",
      " ObbbO        ObbbO     ",
      "ObbpbbO      ObbpbbO    ",
      "ObwwwbOOOOOOOObbwwwbO   ",
      "ObwwwwbbwwwwbbwwwwwbO   ",
      "OwwwwwwwwwwwwwwwwwwwO   ",
      "OwwwwEEwwwwwwEEwwwwwO   ",
      "OwwwwEEwwwwwwEEwwwwwO   ",
      "OwwwwwwwNNNNwwwwwwwwO   ",
      " OwwwwwwNNNNwwwwwwwO    ",
      " OwwwwwwPPPPwwwwwwwO    ",
      "  OwwwwwPPPPwwwwwwO     ",
      "   OccccccccccccOO      ",
      "  OwwwwwwTTwwwwwwwO     ",
      " OwwwwwwwwwwwwwwwwwO    ",
      " OwwwwsssssssswwwwwO OO ",
      "OwwwwwsssssssswwwwwwOwwO",
      "OwwwwwwwwwwwwwwwwwwwOwwO",
      "OwwwwwwwwwwwwwwwwwwwOwwO",
      "OwwwwwwwwwwwwwwwwwwOwwwO",
      "OwwwwwwwwwwwwwwwwwwOwwO ",
      "OwwwOwwwwwwwwwwOwwwOO   ",
      "OwwwOwwwwwwwwwwOwwwO    ",
      "OwwwOssssssssssOwwwO    ",
      "OwwwOssssssssssOwwwO    ",
      "OwwwOssssssssssOwwwO    ",
      "OwwwOssssssssssOwwwO    ",
      "OwwwOOOOOOOOOOOOwwwO    ",
      "OwwwO          OwwwO    ",
      "OOOOO          OOOOO    "
    ];
    const ayFloor = 516 - aryaMap.length * S;
    const pal: Record<string, [number, number, number]> = {
      O: [16, 15, 22],
      w: [248, 247, 243],
      s: [226, 223, 216],
      b: [210, 174, 136],
      p: [236, 188, 184],
      E: [48, 30, 18],
      N: [126, 68, 60],
      P: [244, 124, 140],
      c: [28, 30, 42],
      T: [255, 207, 74],
    };
    for (let r = 0; r < aryaMap.length; r++) {
      const line = aryaMap[r];
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        if (ch === ' ') continue;
        const rgb = pal[ch];
        setBlock(ax0 + col * S, ayFloor + r * S, S, S, rgb[0], rgb[1], rgb[2]);
      }
    }
    ctx.putImageData(imgD, 0, 0);
  } catch { /* ignore */ }
  return c;
}

/** Build Stucchi's 74-frame sprite sheet from Nong's atlas */
function buildStucchiAtlas(src: HTMLImageElement): HTMLCanvasElement {
  const W = src.naturalWidth, H = src.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  try {
    const imgD = ctx.getImageData(0, 0, W, H);
    const p = imgD.data;
    const cell = META.cell, cols = META.cols;
    const rows = Math.floor(H / cell);

    for (let fy = 0; fy < rows; fy++) {
      for (let fx = 0; fx < cols; fx++) {
        const fIdx = fy * cols + fx;
        if (fIdx >= 74) continue;
        const ox = fx * cell, oy = fy * cell;
        // Find skin/head bounding box in this frame
        let hMinX = 320, hMaxX = 0, hMinY = 320, hMaxY = 0;
        for (let cy = 0; cy < cell; cy += 2) {
          for (let cx = 0; cx < cell; cx += 2) {
            const i = ((oy + cy) * W + (ox + cx)) * 4;
            if (p[i + 3] < 64) continue;
            const r = p[i], g = p[i + 1], b = p[i + 2];
            if (r > 200 && g > 140 && b > 105 && r > g + 20) {
              if (cx < hMinX) hMinX = cx;
              if (cx > hMaxX) hMaxX = cx;
              if (cy < hMinY) hMinY = cy;
              if (cy > hMaxY) hMaxY = cy;
            }
          }
        }
        const isDeath = fIdx >= 42 && fIdx <= 57;

        for (let cy = 0; cy < cell; cy++) {
          for (let cx = 0; cx < cell; cx++) {
            const i = ((oy + cy) * W + (ox + cx)) * 4;
            if (p[i + 3] < 16) continue;
            const r = p[i], g = p[i + 1], b = p[i + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx ? (mx - mn) / mx : 0;

            // 1) Cap -> Olive-green ribbed knit beanie
            const inCap = !isDeath
              ? (cy <= hMinY + 6 && cx >= hMinX - 28 && cx <= hMaxX + 20)
              : (cy >= hMinY - 26 && cy <= hMaxY + 12 && cx >= hMinX - 24 && cx <= hMaxX + 34 && sat < 0.25 && mx >= 18 && mx <= 55);
            if (inCap) {
              // Trim backwards cap brim sticking far out to the left on standing frames
              if (!isDeath && cx < hMinX - 16 && cy >= hMinY - 8) {
                p[i + 3] = 0;
                continue;
              }
              if (mx >= 18) {
                const rib = Math.floor(cx / 4) % 2 === 0;
                const cuff = !isDeath && cy >= hMinY - 8;
                p[i] = cuff ? (rib ? 92 : 76) : (rib ? 76 : 64);
                p[i + 1] = cuff ? (rib ? 134 : 112) : (rib ? 114 : 98);
                p[i + 2] = cuff ? (rib ? 102 : 84) : (rib ? 86 : 72);
              }
              continue;
            }

            // 2) Brown hair & beard -> rich dark espresso/black Italian beard & hair
            const isBrown = r > g + 15 && g > b + 10 && r < 210 && (r - b) > 28;
            if (isBrown && cy <= hMaxY + 18) {
              p[i] = Math.round(r * 0.20 + 8);
              p[i + 1] = Math.round(g * 0.21 + 6);
              p[i + 2] = Math.round(b * 0.25 + 6);
              continue;
            }

            // 3) Shoes -> Electric Blue & Orange Nike sneakers
            const isKickFoot = fIdx >= 22 && fIdx <= 31 && cx >= 215 && cy >= 80 && cy <= 165;
            const isShoe = (!isDeath && cy >= 282) || isKickFoot;
            if (isShoe && mx >= 16 && sat < 0.35) {
              const sole = cy >= 304 || (isKickFoot && cx >= 258);
              if (sole) {
                p[i] = 255; p[i + 1] = 92; p[i + 2] = 36;
              } else {
                const k = Math.max(0.6, Math.min(1.2, mx / 42));
                p[i] = Math.min(255, Math.round(24 * k));
                p[i + 1] = Math.min(255, Math.round(154 * k));
                p[i + 2] = Math.min(255, Math.round(236 * k));
              }
              continue;
            }

            // 4) Pants (medium grey -> sleek black athletic pants) & Hoodie (dark navy-charcoal)
            if (sat < 0.25 && mx >= 18) {
              if (mx >= 52) {
                // Pants
                p[i] = Math.round(r * 0.44);
                p[i + 1] = Math.round(g * 0.46);
                p[i + 2] = Math.round(b * 0.52);
              } else {
                // Hoodie
                p[i] = Math.round(r * 0.78);
                p[i + 1] = Math.round(g * 0.84);
                p[i + 2] = Math.min(255, Math.round(b * 1.12));
              }
            }
          }
        }
      }
    }
    ctx.putImageData(imgD, 0, 0);
  } catch { /* ignore */ }
  return c;
}

/** Alternate costume: Nong's black hoodie turns crimson, Nang's olive jacket turns plum, Stucchi's beanie/hoodie turns Azzurri royal blue. */
function recolor(img: Img, who: CharId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const w = (img as HTMLImageElement).naturalWidth || img.width;
  const h = (img as HTMLImageElement).naturalHeight || img.height;
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  try {
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      const [hue, s, v] = rgb2hsv(p[i], p[i + 1], p[i + 2]);
      if (who === 'nong') {
        if (s < 0.22 && v < 0.5) {
          const [r, g, b] = hsv2rgb(352, 0.72, Math.min(1, 0.12 + v * 1.25));
          p[i] = r; p[i + 1] = g; p[i + 2] = b;
        }
      } else if (who === 'nang') {
        if (hue > 55 && hue < 140 && s > 0.18) {
          const [r, g, b] = hsv2rgb(318, Math.min(1, s * 1.05), Math.min(1, v * 1.05));
          p[i] = r; p[i + 1] = g; p[i + 2] = b;
        }
      } else if (who === 'stucchi') {
        if (hue > 95 && hue < 165 && s > 0.18) {
          // Olive beanie -> Italian Azzurri blue
          const [r, g, b] = hsv2rgb(212, Math.min(1, s * 1.35), Math.min(1, v * 1.15));
          p[i] = r; p[i + 1] = g; p[i + 2] = b;
        }
      }
    }
    x.putImageData(d, 0, 0);
  } catch { /* tainted canvas: fall back to original */ }
  return c;
}

export async function loadAll(onProgress?: (f: number) => void) {
  const list: [string, string][] = [
    ['nongA', nongAtlas], ['nangA', nangAtlas], ['nongP', nongPortrait], ['nangP', nangPortrait],
    ['bg', bgUrl], ['strike', strikeUrl], ['burst', burstUrl], ['warn', warnUrl],
  ];
  const out: Record<string, HTMLImageElement> = {};
  let done = 0;
  await Promise.all(list.map(async ([k, u]) => { out[k] = await load(u); done++; onProgress?.(done / list.length); }));
  for (const id of ['nong', 'nang'] as CharId[]) {
    const a = out[id + 'A'], p = out[id + 'P'];
    art.chars[id] = { atlas: a, atlasAlt: recolor(a, id), portrait: p, portraitAlt: recolor(p, id), frames: META.frames[id] };
  }
  const stucchiP = buildStucchiPortrait(out.nongP);
  const stucchiA = buildStucchiAtlas(out.nongA);
  try { PORTRAIT_URLS.stucchi = stucchiP.toDataURL('image/png'); } catch { /* ignore */ }
  art.chars.stucchi = {
    atlas: stucchiA,
    atlasAlt: recolor(stucchiA, 'stucchi'),
    portrait: stucchiP,
    portraitAlt: recolor(stucchiP, 'stucchi'),
    frames: META.frames.nong,
  };
  art.bg = out.bg; art.strike = out.strike; art.burst = out.burst; art.warn = out.warn;
  art.ready = true;
}
