import type { Meta } from './meta';
import { autoTextColor, averageColor, contrastRatio, mix, normalizeHex } from './color';
import { getFontStack, resolveFontWeight } from './fonts';
import type { LogoColor } from './logos';

export type TemplateId =
  | 'classic'
  | 'center'
  | 'oneline'
  | 'overlay'
  | 'polaroid'
  | 'film'
  | 'blur'
  | 'border';

export type Theme = 'light' | 'dark';

export interface LogoImage {
  img: CanvasImageSource;
  ratio: number;
}

export interface AspectOpts {
  mode: 'original' | 'ratio';
  w: number;
  h: number;
  fit: 'contain' | 'cover';
  cropX: number; // 0 - 100
  cropY: number; // 0 - 100
}

export interface Opts {
  template: TemplateId;
  theme: Theme;
  scale: number; // 0.6 - 1.8
  signature: string;
  showLens: boolean;
  showDate: boolean;
  aspect: AspectOpts;
  frameColor: string | null; // null = ikut tema
  textColor: string | null;  // null = otomatis (kontras)
  fontFamily: string | null; // null = default template
  maxEdge: number | null;
  showLogo: boolean;
  logoColor: LogoColor;
  logo?: LogoImage;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutResult {
  canvasW: number;
  canvasH: number;
  srcRect: Rect;
  photoRect: Rect;
  contentRect: Rect;
  sidePad: number;
  topPad: number;
  bottomPad: number;
  u: number;
  clamped: boolean;
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d'): CanvasRenderingContext2D | null;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike;

let canvasFactory: CanvasFactory = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Daftarkan factory kanvas kustom (mis. `@napi-rs/canvas` untuk pengujian di Node). */
export function setCanvasFactory(fn: CanvasFactory): void {
  canvasFactory = fn;
}

const SYS_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_PIXELS = 100_000_000;

export function defaultFrameColor(template: TemplateId, theme: Theme): string {
  if (template === 'polaroid') return theme === 'light' ? '#fbfaf6' : '#161618';
  if (template === 'film') return theme === 'dark' ? '#0c0c0d' : '#f4efe4';
  if (template === 'overlay') return '#000000';
  return theme === 'light' ? '#ffffff' : '#101010';
}

/**
 * Fungsi murni untuk menghitung tata letak kanvas, area foto, padding, dan skala `u`.
 * Dapat diuji di Node tanpa instance canvas.
 */
export function computeLayout(W: number, H: number, o: Opts): LayoutResult {
  const safeW = Math.max(1, Math.round(W));
  const safeH = Math.max(1, Math.round(H));
  let u = Math.min(safeW, safeH) * 0.03 * o.scale;
  const hasLogo = Boolean(o.showLogo && o.logo);

  let sidePad = 0;
  let topPad = 0;
  let bottomPad = 0;

  if (o.template === 'classic') {
    bottomPad = Math.round(u * 4.6);
  } else if (o.template === 'oneline') {
    bottomPad = Math.round(u * 3.4);
  } else if (o.template === 'center') {
    bottomPad = Math.round(u * (hasLogo ? 8.2 : 6.4));
  } else if (o.template === 'polaroid') {
    sidePad = Math.round(u * 1.6);
    topPad = Math.round(u * 1.6);
    bottomPad = Math.round(u * (hasLogo ? 7.6 : 6.0));
  } else if (o.template === 'film') {
    sidePad = Math.round(u * 1.5);
    topPad = Math.round(u * 2.4);
    bottomPad = Math.round(u * 3.8);
  } else if (o.template === 'blur') {
    sidePad = Math.round(u * 2.4);
    topPad = Math.round(u * 2.4);
    bottomPad = Math.round(u * (hasLogo ? 7.2 : 5.2));
  } else if (o.template === 'border') {
    sidePad = Math.round(u * 1.2);
    topPad = Math.round(u * 1.2);
    bottomPad = Math.round(u * 2.8);
  }

  let canvasW = safeW + sidePad * 2;
  let canvasH = safeH + topPad + bottomPad;
  let srcRect: Rect = { x: 0, y: 0, w: safeW, h: safeH };
  let photoRect: Rect = { x: sidePad, y: topPad, w: safeW, h: safeH };
  let contentRect: Rect = { x: 0, y: 0, w: canvasW, h: canvasH };

  if (o.aspect.mode === 'ratio') {
    const rawR = o.aspect.w > 0 && o.aspect.h > 0 ? o.aspect.w / o.aspect.h : safeW / safeH;
    const R = Math.max(0.25, Math.min(4, rawR));

    if (o.aspect.fit === 'contain') {
      const baseW = canvasW;
      const baseH = canvasH;
      if (baseW / baseH < R) {
        canvasH = baseH;
        canvasW = Math.max(baseW, Math.round(baseH * R));
      } else {
        canvasW = baseW;
        canvasH = Math.max(baseH, Math.round(baseW / R));
      }
      const ox = Math.round((canvasW - baseW) / 2);
      const oy = Math.round((canvasH - baseH) / 2);
      photoRect = { x: ox + sidePad, y: oy + topPad, w: safeW, h: safeH };
      contentRect = { x: ox, y: oy, w: baseW, h: baseH };
    } else {
      // Crop (cover): hasil akhir ber-rasio R, foto di-crop mengisi area foto
      const padW = sidePad * 2;
      const padH = topPad + bottomPad;
      const tryW = safeW + padW;
      const tryH = Math.round(tryW / R);
      if (tryH - padH <= safeH && tryH - padH > 0) {
        canvasW = tryW;
        canvasH = tryH;
      } else {
        const altH = safeH + padH;
        const altW = Math.round(altH * R);
        if (altW - padW <= safeW && altW - padW > 0) {
          canvasW = altW;
          canvasH = altH;
        } else {
          canvasW = Math.max(padW + 1, tryW);
          canvasH = Math.max(padH + 1, Math.round(canvasW / R));
        }
      }
      const pw = Math.max(1, canvasW - padW);
      const ph = Math.max(1, canvasH - padH);
      const pr = pw / ph;
      let sw = safeW;
      let sh = safeH;
      if (safeW / safeH > pr) {
        sh = safeH;
        sw = Math.min(safeW, Math.max(1, Math.round(safeH * pr)));
      } else {
        sw = safeW;
        sh = Math.min(safeH, Math.max(1, Math.round(safeW / pr)));
      }
      const cx = Math.max(0, Math.min(100, o.aspect.cropX)) / 100;
      const cy = Math.max(0, Math.min(100, o.aspect.cropY)) / 100;
      const sx = Math.round((safeW - sw) * cx);
      const sy = Math.round((safeH - sh) * cy);

      srcRect = { x: sx, y: sy, w: sw, h: sh };
      photoRect = { x: sidePad, y: topPad, w: pw, h: ph };
      contentRect = { x: 0, y: 0, w: canvasW, h: canvasH };
    }
  }

  // Skala turun jika melebihi maxEdge atau batas aman kanvas (16384px / 100 MP)
  let scaleFactor = 1;
  let clamped = false;
  if (o.maxEdge && o.maxEdge > 0 && Math.max(canvasW, canvasH) > o.maxEdge) {
    scaleFactor = Math.min(scaleFactor, o.maxEdge / Math.max(canvasW, canvasH));
  }
  if (Math.max(canvasW, canvasH) * scaleFactor > MAX_CANVAS_SIDE) {
    scaleFactor = Math.min(scaleFactor, MAX_CANVAS_SIDE / Math.max(canvasW, canvasH));
    clamped = true;
  }
  if (canvasW * canvasH * scaleFactor * scaleFactor > MAX_CANVAS_PIXELS) {
    scaleFactor = Math.min(scaleFactor, Math.sqrt(MAX_CANVAS_PIXELS / (canvasW * canvasH)));
    clamped = true;
  }

  if (scaleFactor < 1) {
    const scaleRect = (r: Rect): Rect => ({
      x: Math.round(r.x * scaleFactor),
      y: Math.round(r.y * scaleFactor),
      w: Math.max(1, Math.round(r.w * scaleFactor)),
      h: Math.max(1, Math.round(r.h * scaleFactor)),
    });
    canvasW = Math.max(1, Math.round(canvasW * scaleFactor));
    canvasH = Math.max(1, Math.round(canvasH * scaleFactor));
    photoRect = scaleRect(photoRect);
    contentRect = scaleRect(contentRect);
    sidePad = Math.round(sidePad * scaleFactor);
    topPad = Math.round(topPad * scaleFactor);
    bottomPad = Math.round(bottomPad * scaleFactor);
    u *= scaleFactor;
  }

  return {
    canvasW,
    canvasH,
    srcRect,
    photoRect,
    contentRect,
    sidePad,
    topPad,
    bottomPad,
    u,
    clamped,
  };
}

type Ctx = CanvasRenderingContext2D;

const fontStr = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

/** Kecilkan font sampai teks muat di maxW (batas bawah 55% dari ukuran awal). */
function fit(ctx: Ctx, text: string, weight: number, size: number, maxW: number, family: string): number {
  let s = size;
  ctx.font = fontStr(weight, s, family);
  while (ctx.measureText(text).width > maxW && s > size * 0.55) {
    s *= 0.94;
    ctx.font = fontStr(weight, s, family);
  }
  return s;
}

function fitLogo(ratio: number, targetH: number, maxW: number): { w: number; h: number } {
  const r = ratio > 0 && isFinite(ratio) ? ratio : 1;
  let h = targetH;
  let w = h * r;
  if (w > maxW) {
    w = maxW;
    h = w / r;
  }
  return { w, h };
}

function drawRoundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * Gambar logo monokrom secara terpusat dengan aturan kontras WCAG:
 * jika rasio kontras terhadap `effectiveBgHex` < 3:1, gambar kapsul tipis di belakangnya.
 */
function drawLogo(
  ctx: Ctx,
  img: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  u: number,
  effectiveBgHex: string,
  logoColor: LogoColor,
) {
  const logoHex = logoColor === 'white' ? '#ffffff' : '#000000';
  if (contrastRatio(logoHex, effectiveBgHex) < 3) {
    const p = u * 0.35;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = logoColor === 'white' ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.95)';
    drawRoundedRect(ctx, x - p, y - p, w + p * 2, h + p * 2, Math.min(u * 0.35, (h + p * 2) / 2));
    ctx.fill();
    ctx.restore();
  }
  ctx.drawImage(img, x, y, w, h);
}

function extraText(meta: Meta, o: Opts): string {
  return [o.showDate ? meta.date : '', o.signature.trim()].filter(Boolean).join('   ·   ');
}

interface TextLine {
  text: string;
  weight: number;
  size: number;
  color: string;
}

function drawCenteredBlock(
  ctx: Ctx,
  lines: TextLine[],
  cx: number,
  y0: number,
  areaH: number,
  maxW: number,
  family: string,
  fontId: string | null,
  logo?: { img: CanvasImageSource; w: number; h: number; gap: number; u: number; bg: string; color: LogoColor },
) {
  const linesH = lines.reduce((a, l) => a + l.size * 1.5, 0);
  const logoTotal = logo ? logo.h + (lines.length ? logo.gap : 0) : 0;
  const totalH = logoTotal + linesH;
  if (totalH <= 0) return;

  let y = y0 + (areaH - totalH) / 2;
  if (logo) {
    drawLogo(ctx, logo.img, cx - logo.w / 2, y, logo.w, logo.h, logo.u, logo.bg, logo.color);
    y += logo.h + logo.gap;
  }

  ctx.textAlign = 'center';
  for (const l of lines) {
    const w = resolveFontWeight(fontId, l.weight);
    const s = fit(ctx, l.text, w, l.size, maxW, family);
    ctx.font = fontStr(w, s, family);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, cx, y + l.size * 0.75);
    y += l.size * 1.5;
  }
}

function drawInlineWithLogo(
  ctx: Ctx,
  text: string,
  cx: number,
  cy: number,
  weight: number,
  size: number,
  color: string,
  maxW: number,
  family: string,
  fontId: string | null,
  logo?: { img: CanvasImageSource; w: number; h: number; gap: number; u: number; bg: string; color: LogoColor },
) {
  if (!text && !logo) return;
  const w = resolveFontWeight(fontId, weight);
  if (!logo) {
    ctx.textAlign = 'center';
    const s = fit(ctx, text, w, size, maxW, family);
    ctx.font = fontStr(w, s, family);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
    return;
  }
  const gap = text ? logo.gap : 0;
  const availTextW = Math.max(10, maxW - logo.w - gap);
  const s = text ? fit(ctx, text, w, size, availTextW, family) : size;
  if (text) ctx.font = fontStr(w, s, family);
  const textW = text ? Math.min(availTextW, ctx.measureText(text).width) : 0;
  const totalW = logo.w + gap + textW;
  const startX = cx - totalW / 2;
  drawLogo(ctx, logo.img, startX, cy - logo.h / 2, logo.w, logo.h, logo.u, logo.bg, logo.color);
  if (text) {
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.fillText(text, startX + logo.w + gap, cy);
  }
}

function drawColumn(
  ctx: Ctx,
  lines: TextLine[],
  x: number,
  y0: number,
  areaH: number,
  colW: number,
  align: CanvasTextAlign,
  family: string,
  fontId: string | null,
) {
  ctx.textAlign = align;
  const n = lines.length;
  lines.forEach((l, i) => {
    const frac = n === 1 ? 0.5 : i === 0 ? 0.36 : 0.68;
    const w = resolveFontWeight(fontId, l.weight);
    const s = fit(ctx, l.text, w, l.size, colW, family);
    ctx.font = fontStr(w, s, family);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, x, y0 + areaH * frac);
  });
}

/**
 * Menggambar foto + bingkai ke `canvas` secara sinkron.
 * Semua font dan logo harus sudah dimuat oleh pemanggil sebelum `render()`.
 */
export function render(
  canvas: CanvasLike,
  src: CanvasImageSource,
  W: number,
  H: number,
  meta: Meta,
  o: Opts,
): LayoutResult {
  const layout = computeLayout(W, H, o);
  const { canvasW, canvasH, srcRect, photoRect, contentRect, sidePad, bottomPad, u } = layout;

  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const frameHex = normalizeHex(o.frameColor ?? '') ?? defaultFrameColor(o.template, o.theme);
  const activeLogo = o.showLogo && o.logo ? o.logo : undefined;
  const extra = extraText(meta, o);
  const lens = o.showLens ? meta.lens : '';

  const customStack = getFontStack(o.fontFamily);
  const baseFamily = customStack ?? SYS_FONT;
  const filmFamily = customStack ?? MONO_FONT;

  // --- 1. Latar belakang & warna efektif untuk kontras ---
  let effectiveBg = frameHex;

  if (o.template === 'blur') {
    const scale = 48 / Math.max(canvasW, canvasH);
    const bw = Math.max(1, Math.round(canvasW * scale));
    const bh = Math.max(1, Math.round(canvasH * scale));
    const small = canvasFactory(bw, bh);
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, srcRect.x, srcRect.y, srcRect.w, srcRect.h, 0, 0, bw, bh);

    ctx.drawImage(small as unknown as CanvasImageSource, 0, 0, canvasW, canvasH);
    const tintHex = normalizeHex(o.frameColor ?? '') ?? (o.theme === 'dark' ? '#0a0a0c' : '#ffffff');
    const tintAlpha = o.frameColor ? 0.42 : o.theme === 'dark' ? 0.55 : 0.58;
    ctx.fillStyle = tintHex;
    ctx.globalAlpha = tintAlpha;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.globalAlpha = 1;

    const photoAvg = averageColor(small as unknown as CanvasImageSource, canvasFactory);
    effectiveBg = mix(photoAvg, tintHex, tintAlpha);
  } else {
    ctx.fillStyle = frameHex;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // --- 2. Gambar foto (termasuk crop bila mode cover) ---
  if (o.template === 'blur') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = u * 1.4;
    ctx.shadowOffsetY = u * 0.45;
    ctx.drawImage(src, srcRect.x, srcRect.y, srcRect.w, srcRect.h, photoRect.x, photoRect.y, photoRect.w, photoRect.h);
    ctx.restore();
  } else {
    ctx.drawImage(src, srcRect.x, srcRect.y, srcRect.w, srcRect.h, photoRect.x, photoRect.y, photoRect.w, photoRect.h);
  }

  // Untuk overlay, warna latar efektif di belakang blok teks/logo dihitung dari area bawah foto + gradient
  if (o.template === 'overlay') {
    const gradHex = normalizeHex(o.frameColor ?? '') ?? '#000000';
    const gradH = Math.min(photoRect.h, u * 9);
    const g = ctx.createLinearGradient(0, photoRect.y + photoRect.h - gradH, 0, photoRect.y + photoRect.h);
    g.addColorStop(0, `${gradHex}00`);
    g.addColorStop(1, `${gradHex}9e`); // ~0.62 alpha
    ctx.fillStyle = g;
    ctx.fillRect(photoRect.x, photoRect.y + photoRect.h - gradH, photoRect.w, gradH);

    const sampleY = srcRect.y + srcRect.h * 0.72;
    const sampleH = srcRect.h * 0.28;
    const areaAvg = averageColor(src, canvasFactory, srcRect.x, sampleY, srcRect.w * 0.5, sampleH);
    effectiveBg = mix(areaAvg, gradHex, 0.45);
  }

  // --- 3. Warna teks utama & sekunder ---
  let fg: string;
  if (o.textColor && normalizeHex(o.textColor)) {
    fg = normalizeHex(o.textColor)!;
  } else if (o.template === 'film') {
    fg = o.theme === 'dark' ? '#f59e0b' : '#b45309';
  } else if (o.template === 'overlay') {
    fg = '#ffffff';
  } else {
    fg = autoTextColor(effectiveBg);
  }
  const sub = mix(fg, effectiveBg, 0.4);
  const lineColor = mix(fg, effectiveBg, 0.85);

  ctx.textBaseline = 'middle';
  const pad = u * 1.7;
  const cx = contentRect.x + contentRect.w / 2;
  const y0 = photoRect.y + photoRect.h;

  // --- 4. Gambar teks & logo per template ---
  if (o.template === 'classic') {
    const areaLeft = contentRect.x;
    const areaW = contentRect.w;
    const colW = (areaW - pad * 3) / 2;
    let leftX = areaLeft + pad;
    let leftColW = colW;
    if (activeLogo) {
      const sz = fitLogo(activeLogo.ratio, u * 2.1, colW * 0.35);
      drawLogo(
        ctx,
        activeLogo.img,
        leftX,
        y0 + (bottomPad - sz.h) / 2,
        sz.w,
        sz.h,
        u,
        effectiveBg,
        o.logoColor,
      );
      const shift = sz.w + u * 0.85;
      leftX += shift;
      leftColW = Math.max(u * 2, colW - shift);
    }

    const left = [
      { text: meta.camera, weight: 700, size: u * 1.2, color: fg },
      { text: lens, weight: 400, size: u * 0.88, color: sub },
    ].filter((l) => l.text);
    const right = [
      { text: meta.params, weight: 700, size: u * 1.2, color: fg },
      { text: extra, weight: 400, size: u * 0.88, color: sub },
    ].filter((l) => l.text);

    drawColumn(ctx, left, leftX, y0, bottomPad, leftColW, 'left', baseFamily, o.fontFamily);
    drawColumn(ctx, right, areaLeft + areaW - pad, y0, bottomPad, colW, 'right', baseFamily, o.fontFamily);

    ctx.fillStyle = lineColor;
    ctx.fillRect(areaLeft, y0, areaW, Math.max(1, Math.round(u * 0.06)));
  } else if (o.template === 'oneline') {
    const text = [meta.camera, lens, meta.params, extra].filter(Boolean).join('    |    ');
    const logoOpt = activeLogo
      ? {
          ...fitLogo(activeLogo.ratio, u * 1.55, contentRect.w * 0.18),
          img: activeLogo.img,
          gap: u * 0.7,
          u,
          bg: effectiveBg,
          color: o.logoColor,
        }
      : undefined;
    drawInlineWithLogo(
      ctx,
      text,
      cx,
      y0 + bottomPad / 2,
      500,
      u * 1.05,
      fg,
      contentRect.w - pad * 2,
      baseFamily,
      o.fontFamily,
      logoOpt,
    );
  } else if (o.template === 'center') {
    const centerLines = [
      { text: meta.camera, weight: 700, size: u * 1.3, color: fg },
      { text: [lens, meta.params].filter(Boolean).join('   |   '), weight: 400, size: u * 0.95, color: sub },
      { text: extra, weight: 400, size: u * 0.82, color: sub },
    ].filter((l) => l.text);
    const logoOpt = activeLogo
      ? {
          ...fitLogo(activeLogo.ratio, u * 2.0, contentRect.w * 0.35),
          img: activeLogo.img,
          gap: u * 0.55,
          u,
          bg: effectiveBg,
          color: o.logoColor,
        }
      : undefined;
    drawCenteredBlock(ctx, centerLines, cx, y0, bottomPad, contentRect.w - pad * 2, baseFamily, o.fontFamily, logoOpt);
  } else if (o.template === 'overlay') {
    const lines = [
      { text: [meta.camera, lens].filter(Boolean).join('  ·  '), weight: 400, size: u * 0.95, color: sub },
      { text: meta.params, weight: 700, size: u * 1.25, color: fg },
      { text: extra, weight: 400, size: u * 0.85, color: sub },
    ].filter((l) => l.text);

    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = u * 0.45;
    const textX = photoRect.x + pad;
    const maxW = Math.max(u * 4, photoRect.w - pad * 2);
    let y = photoRect.y + photoRect.h - pad;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const w = resolveFontWeight(o.fontFamily, l.weight);
      const s = fit(ctx, l.text, w, l.size, maxW, baseFamily);
      ctx.font = fontStr(w, s, baseFamily);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, textX, y - l.size * 0.4);
      y -= l.size * 1.5;
    }
    if (activeLogo) {
      const sz = fitLogo(activeLogo.ratio, u * 1.8, photoRect.w * 0.25);
      const logoY = lines.length ? y - sz.h + u * 0.15 : photoRect.y + photoRect.h - pad - sz.h;
      drawLogo(ctx, activeLogo.img, textX, logoY, sz.w, sz.h, u, effectiveBg, o.logoColor);
    }
    ctx.shadowBlur = 0;
  } else if (o.template === 'polaroid') {
    const lines = [
      { text: meta.params, weight: 700, size: u * 1.15, color: fg },
      { text: [meta.camera, lens].filter(Boolean).join('   ·   '), weight: 500, size: u * 0.92, color: sub },
      { text: extra, weight: 400, size: u * 0.8, color: sub },
    ].filter((l) => l.text);
    const logoOpt = activeLogo
      ? {
          ...fitLogo(activeLogo.ratio, u * 1.65, photoRect.w * 0.32),
          img: activeLogo.img,
          gap: u * 0.5,
          u,
          bg: effectiveBg,
          color: o.logoColor,
        }
      : undefined;
    drawCenteredBlock(ctx, lines, cx, y0, bottomPad, photoRect.w, baseFamily, o.fontFamily, logoOpt);
  } else if (o.template === 'film') {
    const leftEdge = contentRect.x + sidePad;
    const rightEdge = contentRect.x + contentRect.w - sidePad;
    const topMidY = contentRect.y + layout.topPad / 2;

    const markW = resolveFontWeight(o.fontFamily, 700);
    const markSize = fit(ctx, '▶ 12', markW, u * 0.85, photoRect.w * 0.2, filmFamily);
    ctx.font = fontStr(markW, markSize, filmFamily);
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.fillText('▶ 12', leftEdge, topMidY);
    ctx.textAlign = 'right';
    ctx.fillText('12A', rightEdge, topMidY);

    const colW = (photoRect.w - u * 1.6) / 2;
    const left = [
      { text: meta.params.toUpperCase(), weight: 700, size: u * 0.95, color: fg },
      { text: lens.toUpperCase(), weight: 400, size: u * 0.76, color: sub },
    ].filter((l) => l.text);
    drawColumn(ctx, left, leftEdge, y0, bottomPad, colW, 'left', filmFamily, o.fontFamily);

    if (activeLogo) {
      const sz = fitLogo(activeLogo.ratio, u * 1.4, colW * 0.65);
      const extraUp = extra.toUpperCase();
      if (extraUp) {
        drawLogo(
          ctx,
          activeLogo.img,
          rightEdge - sz.w,
          y0 + bottomPad * 0.34 - sz.h / 2,
          sz.w,
          sz.h,
          u,
          effectiveBg,
          o.logoColor,
        );
        ctx.textAlign = 'right';
        const ew = resolveFontWeight(o.fontFamily, 400);
        const s = fit(ctx, extraUp, ew, u * 0.76, colW, filmFamily);
        ctx.font = fontStr(ew, s, filmFamily);
        ctx.fillStyle = sub;
        ctx.fillText(extraUp, rightEdge, y0 + bottomPad * 0.72);
      } else {
        drawLogo(
          ctx,
          activeLogo.img,
          rightEdge - sz.w,
          y0 + (bottomPad - sz.h) / 2,
          sz.w,
          sz.h,
          u,
          effectiveBg,
          o.logoColor,
        );
      }
    } else {
      const right = [
        { text: meta.camera.toUpperCase(), weight: 700, size: u * 0.95, color: fg },
        { text: extra.toUpperCase(), weight: 400, size: u * 0.76, color: sub },
      ].filter((l) => l.text);
      drawColumn(ctx, right, rightEdge, y0, bottomPad, colW, 'right', filmFamily, o.fontFamily);
    }
  } else if (o.template === 'blur') {
    const lines = [
      { text: meta.camera, weight: 700, size: u * 1.18, color: fg },
      { text: [lens, meta.params].filter(Boolean).join('   |   '), weight: 500, size: u * 0.9, color: sub },
      { text: extra, weight: 400, size: u * 0.78, color: sub },
    ].filter((l) => l.text);
    const logoOpt = activeLogo
      ? {
          ...fitLogo(activeLogo.ratio, u * 1.75, photoRect.w * 0.35),
          img: activeLogo.img,
          gap: u * 0.5,
          u,
          bg: effectiveBg,
          color: o.logoColor,
        }
      : undefined;
    drawCenteredBlock(ctx, lines, cx, y0, bottomPad, photoRect.w, baseFamily, o.fontFamily, logoOpt);
  } else if (o.template === 'border') {
    const text = [meta.camera, lens, meta.params, extra].filter(Boolean).join('   ·   ');
    const logoOpt = activeLogo
      ? {
          ...fitLogo(activeLogo.ratio, u * 1.3, photoRect.w * 0.18),
          img: activeLogo.img,
          gap: u * 0.6,
          u,
          bg: effectiveBg,
          color: o.logoColor,
        }
      : undefined;
    drawInlineWithLogo(ctx, text, cx, y0 + bottomPad / 2, 500, u * 0.82, sub, photoRect.w, baseFamily, o.fontFamily, logoOpt);
  }

  return layout;
}
