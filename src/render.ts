import type { Meta } from './meta';

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

export interface Opts {
  template: TemplateId;
  theme: Theme;
  scale: number; // 0.6 - 1.8
  signature: string;
  showLens: boolean;
  showDate: boolean;
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

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

const PALETTE = {
  light: { bg: '#ffffff', fg: '#111111', sub: '#6b6b6b', line: '#e6e6e6' },
  dark: { bg: '#101010', fg: '#f3f3f3', sub: '#9b9b9b', line: '#2a2a2a' },
};

type Ctx = CanvasRenderingContext2D;

const font = (weight: number, size: number, family = FONT) => `${weight} ${size}px ${family}`;

/** Kecilkan font sampai teks muat di maxW (batas bawah 55% dari ukuran awal). */
function fit(ctx: Ctx, text: string, weight: number, size: number, maxW: number, family = FONT): number {
  let s = size;
  ctx.font = font(weight, s, family);
  while (ctx.measureText(text).width > maxW && s > size * 0.55) {
    s *= 0.94;
    ctx.font = font(weight, s, family);
  }
  return s;
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

function drawCenteredLines(ctx: Ctx, lines: TextLine[], cx: number, y0: number, areaH: number, maxW: number, family = FONT) {
  if (!lines.length) return;
  ctx.textAlign = 'center';
  const content = lines.reduce((a, l) => a + l.size * 1.5, 0);
  let y = y0 + (areaH - content) / 2;
  for (const l of lines) {
    const s = fit(ctx, l.text, l.weight, l.size, maxW, family);
    ctx.font = font(l.weight, s, family);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, cx, y + l.size * 0.75);
    y += l.size * 1.5;
  }
}

function drawTwoColumnStrip(
  ctx: Ctx,
  left: TextLine[],
  right: TextLine[],
  leftX: number,
  rightX: number,
  y0: number,
  areaH: number,
  colW: number,
  family = FONT,
) {
  const drawBlock = (lines: TextLine[], x: number, align: CanvasTextAlign) => {
    ctx.textAlign = align;
    const n = lines.length;
    lines.forEach((l, i) => {
      const frac = n === 1 ? 0.5 : i === 0 ? 0.36 : 0.68;
      const s = fit(ctx, l.text, l.weight, l.size, colW, family);
      ctx.font = font(l.weight, s, family);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x, y0 + areaH * frac);
    });
  };
  drawBlock(left, leftX, 'left');
  drawBlock(right, rightX, 'right');
}

/**
 * Menggambar foto + bingkai ke `canvas`.
 * W,H = ukuran foto di kanvas. Semua ukuran huruf relatif terhadap sisi terpendek,
 * jadi preview kecil dan ekspor resolusi penuh terlihat identik.
 */
export function render(
  canvas: CanvasLike,
  src: CanvasImageSource,
  W: number,
  H: number,
  meta: Meta,
  o: Opts,
): void {
  const u = Math.min(W, H) * 0.03 * o.scale; // satuan dasar
  const pal = PALETTE[o.theme];
  const extra = extraText(meta, o);
  const lens = o.showLens ? meta.lens : '';

  // --- tentukan dimensi bingkai/strip ---
  let sidePad = 0;
  let topPad = 0;
  let bottomPad = 0;
  let centerLines: TextLine[] = [];

  if (o.template === 'classic') {
    bottomPad = u * 4.6;
  } else if (o.template === 'oneline') {
    bottomPad = u * 3.4;
  } else if (o.template === 'center') {
    centerLines = [
      { text: meta.camera, weight: 700, size: u * 1.3, color: pal.fg },
      { text: [lens, meta.params].filter(Boolean).join('   |   '), weight: 400, size: u * 0.95, color: pal.sub },
      { text: extra, weight: 400, size: u * 0.82, color: pal.sub },
    ].filter((l) => l.text);
    const content = centerLines.reduce((a, l) => a + l.size * 1.5, 0);
    bottomPad = Math.max(u * 3.4, content + u * 2.4);
  } else if (o.template === 'polaroid') {
    sidePad = u * 1.6;
    topPad = u * 1.6;
    bottomPad = u * 6.0;
  } else if (o.template === 'film') {
    sidePad = u * 1.5;
    topPad = u * 2.4;
    bottomPad = u * 3.8;
  } else if (o.template === 'blur') {
    sidePad = u * 2.4;
    topPad = u * 2.4;
    bottomPad = u * 5.2;
  } else if (o.template === 'border') {
    sidePad = u * 1.2;
    topPad = u * 1.2;
    bottomPad = u * 2.8;
  }

  sidePad = Math.round(sidePad);
  topPad = Math.round(topPad);
  bottomPad = Math.round(bottomPad);

  const totalW = W + sidePad * 2;
  const totalH = H + topPad + bottomPad;

  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // --- gambar latar belakang ---
  if (o.template === 'polaroid') {
    ctx.fillStyle = o.theme === 'light' ? '#fbfaf6' : '#161618';
    ctx.fillRect(0, 0, totalW, totalH);
  } else if (o.template === 'film') {
    ctx.fillStyle = o.theme === 'dark' ? '#0c0c0d' : '#f4efe4';
    ctx.fillRect(0, 0, totalW, totalH);
  } else if (o.template === 'blur') {
    // Turunkan skala ke ±48px lalu naikkan lagi agar kabur tanpa ctx.filter
    const scale = 48 / Math.max(W, H);
    const bw = Math.max(1, Math.round(W * scale));
    const bh = Math.max(1, Math.round(H * scale));
    const small = canvasFactory(bw, bh);
    const sctx = small.getContext('2d')!;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, bw, bh);

    ctx.drawImage(small as unknown as CanvasImageSource, 0, 0, totalW, totalH);
    ctx.fillStyle = o.theme === 'dark' ? 'rgba(10, 10, 12, 0.55)' : 'rgba(255, 255, 255, 0.58)';
    ctx.fillRect(0, 0, totalW, totalH);
  } else if (bottomPad > 0 || sidePad > 0 || topPad > 0) {
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, totalW, totalH);
  }

  // --- gambar foto ---
  if (o.template === 'blur') {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = u * 1.4;
    ctx.shadowOffsetY = u * 0.45;
    ctx.drawImage(src, sidePad, topPad, W, H);
    ctx.restore();
  } else {
    ctx.drawImage(src, sidePad, topPad, W, H);
  }

  ctx.textBaseline = 'middle';
  const pad = u * 1.7;
  const y0 = topPad + H;

  // --- gambar teks sesuai template ---
  if (o.template === 'classic') {
    const colW = (W - pad * 3) / 2;
    const left = [
      { text: meta.camera, weight: 700, size: u * 1.2, color: pal.fg },
      { text: lens, weight: 400, size: u * 0.88, color: pal.sub },
    ].filter((l) => l.text);
    const right = [
      { text: meta.params, weight: 700, size: u * 1.2, color: pal.fg },
      { text: extra, weight: 400, size: u * 0.88, color: pal.sub },
    ].filter((l) => l.text);

    drawTwoColumnStrip(ctx, left, right, pad, W - pad, y0, bottomPad, colW);

    ctx.fillStyle = pal.line;
    ctx.fillRect(0, y0, W, Math.max(1, Math.round(u * 0.06)));
  } else if (o.template === 'oneline') {
    const text = [meta.camera, lens, meta.params, extra].filter(Boolean).join('    |    ');
    if (text) {
      ctx.textAlign = 'center';
      const s = fit(ctx, text, 500, u * 1.05, W - pad * 2);
      ctx.font = font(500, s);
      ctx.fillStyle = pal.fg;
      ctx.fillText(text, W / 2, y0 + bottomPad / 2);
    }
  } else if (o.template === 'center') {
    drawCenteredLines(ctx, centerLines, W / 2, y0, bottomPad, W - pad * 2);
  } else if (o.template === 'overlay') {
    const g = ctx.createLinearGradient(0, H - u * 9, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - u * 9, W, u * 9);

    const lines = [
      { text: [meta.camera, lens].filter(Boolean).join('  ·  '), weight: 400, size: u * 0.95, a: 0.85 },
      { text: meta.params, weight: 700, size: u * 1.25, a: 1 },
      { text: extra, weight: 400, size: u * 0.85, a: 0.75 },
    ].filter((l) => l.text);

    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = u * 0.4;
    let y = H - pad;
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const s = fit(ctx, l.text, l.weight, l.size, W - pad * 2);
      ctx.font = font(l.weight, s);
      ctx.fillStyle = `rgba(255,255,255,${l.a})`;
      ctx.fillText(l.text, pad, y - l.size * 0.4);
      y -= l.size * 1.5;
    }
    ctx.shadowBlur = 0;
  } else if (o.template === 'polaroid') {
    const fg = o.theme === 'light' ? '#181818' : '#f2f2f2';
    const sub = o.theme === 'light' ? '#66645e' : '#9c9ca2';
    const lines = [
      { text: meta.params, weight: 700, size: u * 1.15, color: fg },
      { text: [meta.camera, lens].filter(Boolean).join('   ·   '), weight: 500, size: u * 0.92, color: sub },
      { text: extra, weight: 400, size: u * 0.8, color: sub },
    ].filter((l) => l.text);
    drawCenteredLines(ctx, lines, totalW / 2, y0, bottomPad, W);
  } else if (o.template === 'film') {
    const amber = o.theme === 'dark' ? '#f59e0b' : '#b45309';
    const amberSub = o.theme === 'dark' ? 'rgba(245, 158, 11, 0.78)' : 'rgba(180, 83, 9, 0.8)';

    // Penanda tepi atas
    const markSize = fit(ctx, '▶ 12', 700, u * 0.85, W * 0.2, MONO_FONT);
    ctx.font = font(700, markSize, MONO_FONT);
    ctx.fillStyle = amber;
    ctx.textAlign = 'left';
    ctx.fillText('▶ 12', sidePad, topPad / 2);
    ctx.textAlign = 'right';
    ctx.fillText('12A', totalW - sidePad, topPad / 2);

    // Kiri bawah: parameter + lensa, kanan bawah: kamera + tanggal
    const colW = (W - u * 1.6) / 2;
    const left = [
      { text: meta.params.toUpperCase(), weight: 700, size: u * 0.95, color: amber },
      { text: lens.toUpperCase(), weight: 400, size: u * 0.76, color: amberSub },
    ].filter((l) => l.text);
    const right = [
      { text: meta.camera.toUpperCase(), weight: 700, size: u * 0.95, color: amber },
      { text: extra.toUpperCase(), weight: 400, size: u * 0.76, color: amberSub },
    ].filter((l) => l.text);

    drawTwoColumnStrip(ctx, left, right, sidePad, totalW - sidePad, y0, bottomPad, colW, MONO_FONT);
  } else if (o.template === 'blur') {
    const fg = o.theme === 'dark' ? '#f5f5f5' : '#111111';
    const sub = o.theme === 'dark' ? 'rgba(245, 245, 245, 0.78)' : 'rgba(17, 17, 17, 0.72)';
    const lines = [
      { text: meta.camera, weight: 700, size: u * 1.18, color: fg },
      { text: [lens, meta.params].filter(Boolean).join('   |   '), weight: 500, size: u * 0.9, color: sub },
      { text: extra, weight: 400, size: u * 0.78, color: sub },
    ].filter((l) => l.text);
    drawCenteredLines(ctx, lines, totalW / 2, y0, bottomPad, W);
  } else if (o.template === 'border') {
    const text = [meta.camera, lens, meta.params, extra].filter(Boolean).join('   ·   ');
    if (text) {
      ctx.textAlign = 'center';
      const s = fit(ctx, text, 500, u * 0.82, W);
      ctx.font = font(500, s);
      ctx.fillStyle = pal.sub;
      ctx.fillText(text, totalW / 2, y0 + bottomPad / 2);
    }
  }
}
