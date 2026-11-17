import type { Meta } from './meta';

export type TemplateId = 'classic' | 'center' | 'oneline' | 'overlay';
export type Theme = 'light' | 'dark';

export interface Opts {
  template: TemplateId;
  theme: Theme;
  scale: number; // 0.6 - 1.8
  signature: string;
  showLens: boolean;
  showDate: boolean;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

const PALETTE = {
  light: { bg: '#ffffff', fg: '#111111', sub: '#6b6b6b', line: '#e6e6e6' },
  dark: { bg: '#101010', fg: '#f3f3f3', sub: '#9b9b9b', line: '#2a2a2a' },
};

type Ctx = CanvasRenderingContext2D;

const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

/** Kecilkan font sampai teks muat di maxW (batas bawah 55% dari ukuran awal). */
function fit(ctx: Ctx, text: string, weight: number, size: number, maxW: number): number {
  let s = size;
  ctx.font = font(weight, s);
  while (ctx.measureText(text).width > maxW && s > size * 0.55) {
    s *= 0.94;
    ctx.font = font(weight, s);
  }
  return s;
}

function extraText(meta: Meta, o: Opts): string {
  return [o.showDate ? meta.date : '', o.signature.trim()].filter(Boolean).join('   ·   ');
}

/**
 * Menggambar foto + bingkai ke `canvas`.
 * W,H = ukuran foto di kanvas. Semua ukuran huruf relatif terhadap sisi terpendek,
 * jadi preview kecil dan ekspor resolusi penuh terlihat identik.
 */
export function render(
  canvas: HTMLCanvasElement,
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

  // --- tentukan tinggi strip ---
  let stripH = 0;
  let centerLines: { text: string; weight: number; size: number; color: string }[] = [];

  if (o.template === 'classic') {
    stripH = u * 4.6;
  } else if (o.template === 'oneline') {
    stripH = u * 3.4;
  } else if (o.template === 'center') {
    centerLines = [
      { text: meta.camera, weight: 700, size: u * 1.3, color: pal.fg },
      { text: [lens, meta.params].filter(Boolean).join('   |   '), weight: 400, size: u * 0.95, color: pal.sub },
      { text: extra, weight: 400, size: u * 0.82, color: pal.sub },
    ].filter((l) => l.text);
    const content = centerLines.reduce((a, l) => a + l.size * 1.5, 0);
    stripH = Math.max(u * 3.4, content + u * 2.4);
  }
  stripH = Math.round(stripH);

  canvas.width = W;
  canvas.height = H + stripH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  if (stripH > 0) {
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(src, 0, 0, W, H);

  ctx.textBaseline = 'middle';
  const pad = u * 1.7;
  const y0 = H; // awal strip

  if (o.template === 'classic') {
    // Kiri: kamera + lensa. Kanan: parameter + tanggal/tanda tangan.
    const colW = (W - pad * 3) / 2;
    const left = [
      { text: meta.camera, weight: 700, size: u * 1.2, color: pal.fg },
      { text: lens, weight: 400, size: u * 0.88, color: pal.sub },
    ].filter((l) => l.text);
    const right = [
      { text: meta.params, weight: 700, size: u * 1.2, color: pal.fg },
      { text: extra, weight: 400, size: u * 0.88, color: pal.sub },
    ].filter((l) => l.text);

    const drawBlock = (lines: typeof left, x: number, align: CanvasTextAlign) => {
      ctx.textAlign = align;
      const n = lines.length;
      lines.forEach((l, i) => {
        const frac = n === 1 ? 0.5 : i === 0 ? 0.37 : 0.68;
        const s = fit(ctx, l.text, l.weight, l.size, colW);
        ctx.font = font(l.weight, s);
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, x, y0 + stripH * frac);
      });
    };
    drawBlock(left, pad, 'left');
    drawBlock(right, W - pad, 'right');

    // garis tipis di atas strip
    ctx.fillStyle = pal.line;
    ctx.fillRect(0, y0, W, Math.max(1, Math.round(u * 0.06)));
  } else if (o.template === 'oneline') {
    const text = [meta.camera, lens, meta.params, extra].filter(Boolean).join('    |    ');
    if (text) {
      ctx.textAlign = 'center';
      const s = fit(ctx, text, 500, u * 1.05, W - pad * 2);
      ctx.font = font(500, s);
      ctx.fillStyle = pal.fg;
      ctx.fillText(text, W / 2, y0 + stripH / 2);
    }
  } else if (o.template === 'center') {
    ctx.textAlign = 'center';
    const content = centerLines.reduce((a, l) => a + l.size * 1.5, 0);
    let y = y0 + (stripH - content) / 2;
    for (const l of centerLines) {
      const s = fit(ctx, l.text, l.weight, l.size, W - pad * 2);
      ctx.font = font(l.weight, s);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, W / 2, y + l.size * 0.75);
      y += l.size * 1.5;
    }
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
    // gambar dari bawah ke atas
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      const s = fit(ctx, l.text, l.weight, l.size, W - pad * 2);
      ctx.font = font(l.weight, s);
      ctx.fillStyle = `rgba(255,255,255,${l.a})`;
      ctx.fillText(l.text, pad, y - l.size * 0.4);
      y -= l.size * 1.5;
    }
    ctx.shadowBlur = 0;
  }
}
