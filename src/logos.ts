import {
  siApple,
  siAsus,
  siDji,
  siFujifilm,
  siGoogle,
  siHonor,
  siHuawei,
  siKodak,
  siLeica,
  siLg,
  siMotorola,
  siNikon,
  siNokia,
  siOneplus,
  siOppo,
  siPanasonic,
  siSamsung,
  siSony,
  siVivo,
  siXiaomi,
} from 'simple-icons';
import type { TemplateId, Theme } from './render';

export interface LogoEntry {
  title: string;
  svg: string;
  vb?: [number, number, number, number]; // tight viewBox [x, y, w, h]
}

export interface LogoData {
  img: CanvasImageSource;
  ratio: number;
}

export const LOGOS: Record<string, LogoEntry> = {
  apple: { title: siApple.title, svg: siApple.svg, vb: [2.0, 0, 20.0, 24] },
  asus: { title: siAsus.title, svg: siAsus.svg, vb: [0, 9.3, 24, 5.4] },
  dji: { title: siDji.title, svg: siDji.svg, vb: [0, 4.7, 24, 14.6] },
  fujifilm: { title: siFujifilm.title, svg: siFujifilm.svg, vb: [0, 9.7, 24, 4.5] },
  google: { title: siGoogle.title, svg: siGoogle.svg, vb: [0.1, 0, 23.8, 24] },
  honor: { title: siHonor.title, svg: siHonor.svg, vb: [0, 9.5, 24, 5.0] },
  huawei: { title: siHuawei.title, svg: siHuawei.svg, vb: [0, 2.7, 24, 18.6] },
  kodak: { title: siKodak.title, svg: siKodak.svg, vb: [0, 1.3, 24, 21.4] },
  leica: { title: siLeica.title, svg: siLeica.svg },
  lg: { title: siLg.title, svg: siLg.svg, vb: [0, 6.5, 24, 11.0] },
  motorola: { title: siMotorola.title, svg: siMotorola.svg },
  nikon: { title: siNikon.title, svg: siNikon.svg, vb: [0, 8.4, 24, 7.2] },
  nokia: { title: siNokia.title, svg: siNokia.svg, vb: [0, 9.0, 24, 6.0] },
  oneplus: { title: siOneplus.title, svg: siOneplus.svg },
  oppo: { title: siOppo.title, svg: siOppo.svg, vb: [0, 8.9, 24, 6.2] },
  panasonic: { title: siPanasonic.title, svg: siPanasonic.svg, vb: [0, 9.9, 24, 4.2] },
  samsung: { title: siSamsung.title, svg: siSamsung.svg, vb: [0, 9.9, 24, 4.2] },
  sony: { title: siSony.title, svg: siSony.svg, vb: [0, 9.7, 24, 4.6] },
  vivo: { title: siVivo.title, svg: siVivo.svg, vb: [0, 8.6, 24, 6.8] },
  xiaomi: { title: siXiaomi.title, svg: siXiaomi.svg },
};

export type ImageLoader = (src: string) => Promise<{ img: CanvasImageSource; width: number; height: number }>;

let imageLoader: ImageLoader = async (src: string) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { img, width: img.naturalWidth || 256, height: img.naturalHeight || 256 };
};

/** Daftarkan loader gambar kustom (mis. `loadImage` dari `@napi-rs/canvas` di Node). */
export function setLogoLoader(fn: ImageLoader): void {
  imageLoader = fn;
}

const cache = new Map<string, Promise<LogoData | null>>();

function colorizeSvg(entry: LogoEntry, colorHex: string): string {
  const [, , vw, vh] = entry.vb ?? [0, 0, 24, 24];
  const maxDim = Math.max(vw, vh);
  const w = Math.round((vw / maxDim) * 256);
  const h = Math.round((vh / maxDim) * 256);
  let out = entry.svg.replace(/\sfill="[^"]*"/i, '');
  if (entry.vb) {
    out = out.replace(/viewBox="[^"]*"/i, `viewBox="${entry.vb.join(' ')}"`);
  }
  return out.replace('<svg ', `<svg width="${w}" height="${h}" fill="${colorHex}" `);
}

export function getLogoColor(template: TemplateId, theme: Theme): string {
  if (template === 'overlay') return '#ffffff';
  if (template === 'film') return theme === 'dark' ? '#f59e0b' : '#b45309';
  if (template === 'blur') return theme === 'dark' ? '#f5f5f5' : '#111111';
  if (template === 'polaroid') return theme === 'light' ? '#181818' : '#f2f2f2';
  return theme === 'light' ? '#111111' : '#f3f3f3';
}

function loadCached(key: string, dataUrl: string): Promise<LogoData | null> {
  let pending = cache.get(key);
  if (!pending) {
    pending = imageLoader(dataUrl)
      .then(({ img, width, height }) => ({
        img,
        ratio: width > 0 && height > 0 ? width / height : 1,
      }))
      .catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

/** Muat logo bawaan (`simple-icons`) dengan warna mengikuti tema, di-cache per (brand, warna). */
export function getLogoImage(brand: string, colorHex: string): Promise<LogoData | null> {
  const entry = LOGOS[brand];
  if (!entry) return Promise.resolve(null);
  const svg = colorizeSvg(entry, colorHex);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return loadCached(`${brand}:${colorHex}`, dataUrl);
}

/** Muat logo unggahan pengguna apa adanya (tanpa recolor). */
export function getCustomLogoImage(dataUrl: string): Promise<LogoData | null> {
  if (!dataUrl) return Promise.resolve(null);
  return loadCached(`custom:${dataUrl}`, dataUrl);
}
