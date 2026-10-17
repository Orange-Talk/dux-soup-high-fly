import nongAtlas from '../assets/nong_atlas.webp';
import nangAtlas from '../assets/nang_atlas.webp';
import nongPortrait from '../assets/nong_portrait.webp';
import nangPortrait from '../assets/nang_portrait.webp';
import bgUrl from '../assets/bg.webp';
import strikeUrl from '../assets/fx_energy_strike.webp';
import burstUrl from '../assets/fx_flame_burst.webp';
import warnUrl from '../assets/icon_garbage_warning.webp';
import atlasMeta from '../assets/atlas.json';

export type CharId = 'nong' | 'nang';
export type Img = HTMLImageElement | HTMLCanvasElement;

export interface CharArt {
  atlas: Img; atlasAlt: Img; portrait: Img; portraitAlt: Img;
  frames: Record<string, number[]>;
}

export const META = atlasMeta as { cell: number; cols: number; frames: Record<CharId, Record<string, number[]>> };
export const URLS = { nongPortrait, nangPortrait, bgUrl };
export const PORTRAIT_URLS: Record<CharId, string> = { nong: nongPortrait, nang: nangPortrait };
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

/** Alternate costume: Nong's black hoodie turns crimson, Nang's olive jacket turns plum. */
function recolor(img: HTMLImageElement, who: CharId): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0);
  try {
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      const [h, s, v] = rgb2hsv(p[i], p[i + 1], p[i + 2]);
      if (who === 'nong') {
        if (s < 0.22 && v < 0.5) {
          // dark neutral cloth -> deep crimson, keep shading
          const [r, g, b] = hsv2rgb(352, 0.72, Math.min(1, 0.12 + v * 1.25));
          p[i] = r; p[i + 1] = g; p[i + 2] = b;
        }
      } else {
        if (h > 55 && h < 140 && s > 0.18) {
          const [r, g, b] = hsv2rgb(318, Math.min(1, s * 1.05), Math.min(1, v * 1.05));
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
  art.bg = out.bg; art.strike = out.strike; art.burst = out.burst; art.warn = out.warn;
  art.ready = true;
}
