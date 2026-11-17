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

export type LogoColor = 'black' | 'white';

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
export type ScratchCanvasFactory = (w: number, h: number) => {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
};

let imageLoader: ImageLoader = async (src: string) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { img, width: img.naturalWidth || 256, height: img.naturalHeight || 256 };
};

let scratchFactory: ScratchCanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Daftarkan loader gambar kustom (mis. `loadImage` dari `@napi-rs/canvas` di Node). */
export function setLogoLoader(fn: ImageLoader, canvasFn?: ScratchCanvasFactory): void {
  imageLoader = fn;
  if (canvasFn) scratchFactory = canvasFn;
}

const cache = new Map<string, Promise<LogoData | null>>();

/** Terapkan warna monokrom (#000000 atau #ffffff) secara eksplisit tanpa warna lain. */
export function buildMonochromeSvg(entry: LogoEntry, color: LogoColor): string {
  const fillHex = color === 'white' ? '#ffffff' : '#000000';
  const [, , vw, vh] = entry.vb ?? [0, 0, 24, 24];
  const maxDim = Math.max(vw, vh);
  const w = Math.round((vw / maxDim) * 256);
  const h = Math.round((vh / maxDim) * 256);
  let out = entry.svg
    .replace(/\s(fill|stroke|style)="[^"]*"/gi, '');
  if (entry.vb) {
    out = out.replace(/viewBox="[^"]*"/i, `viewBox="${entry.vb.join(' ')}"`);
  }
  return out.replace('<svg ', `<svg width="${w}" height="${h}" fill="${fillHex}" `);
}

/** Muat logo bawaan (`simple-icons`) sebagai siluet hitam atau putih, di-cache per (brand, warna). */
export function getLogoImage(brand: string, color: LogoColor): Promise<LogoData | null> {
  const entry = LOGOS[brand];
  if (!entry) return Promise.resolve(null);
  const key = `${brand}:${color}`;
  let pending = cache.get(key);
  if (!pending) {
    const svg = buildMonochromeSvg(entry, color);
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

/**
 * Konversi gambar unggahan pengguna menjadi siluet monokrom murni (hitam atau putih).
 * Jika gambar tidak transparan (latar putih penuh), turunkan alpha dari luminansi.
 */
export function toMonochromeCanvas(
  img: CanvasImageSource,
  width: number,
  height: number,
  color: LogoColor,
  makeCanvas: ScratchCanvasFactory = scratchFactory,
): { canvas: CanvasImageSource; ratio: number } {
  const maxEdge = 512;
  const scale = Math.min(1, maxEdge / Math.max(1, width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Cek apakah gambar memiliki transparansi nyata
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 245) {
      hasAlpha = true;
      break;
    }
  }

  const target = color === 'white' ? 255 : 0;
  for (let i = 0; i < d.length; i += 4) {
    let a = d[i + 3];
    if (!hasAlpha) {
      // Latar putih penuh -> piksel gelap menjadi buram, piksel putih menjadi transparan
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      a = lum > 240 ? 0 : Math.min(255, Math.round((255 - lum) * 1.15));
    }
    d[i] = target;
    d[i + 1] = target;
    d[i + 2] = target;
    d[i + 3] = a;
  }
  ctx.putImageData(imgData, 0, 0);
  return { canvas: c as unknown as CanvasImageSource, ratio: w / h };
}

/** Muat logo unggahan pengguna lalu konversi ke siluet monokrom (hitam/putih). */
export function getCustomLogoImage(dataUrl: string, color: LogoColor): Promise<LogoData | null> {
  if (!dataUrl) return Promise.resolve(null);
  const key = `custom:${color}:${dataUrl}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = imageLoader(dataUrl)
      .then(({ img, width, height }) => {
        const { canvas, ratio } = toMonochromeCanvas(img, width, height, color);
        return { img: canvas, ratio };
      })
      .catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
