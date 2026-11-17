export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return `#${s.toLowerCase()}`;
  }
  return null;
}

export function parseHex(hex: string): [number, number, number] {
  const norm = normalizeHex(hex) ?? '#000000';
  const n = parseInt(norm.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** WCAG 2.x relative luminance (0..1). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pilih warna teks kontras tinggi (#111111 atau #ffffff) terhadap latar `bgHex`. */
export function autoTextColor(bgHex: string): '#111111' | '#ffffff' {
  return contrastRatio(bgHex, '#111111') >= contrastRatio(bgHex, '#ffffff') ? '#111111' : '#ffffff';
}

/** Campur dua warna hex: `t=0` -> `a`, `t=1` -> `b`. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

export interface TinyCanvas {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

/** Hitung warna rata-rata dari gambar (atau sub-area tertentu) memakai kanvas 16x16. */
export function averageColor(
  src: CanvasImageSource,
  makeCanvas: (w: number, h: number) => TinyCanvas,
  sx?: number,
  sy?: number,
  sw?: number,
  sh?: number,
): string {
  const c = makeCanvas(16, 16);
  const ctx = c.getContext('2d');
  if (!ctx) return '#808080';
  if (sx !== undefined && sy !== undefined && sw !== undefined && sh !== undefined && sw > 0 && sh > 0) {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, 16, 16);
  } else {
    ctx.drawImage(src, 0, 0, 16, 16);
  }
  const data = ctx.getImageData(0, 0, 16, 16).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return toHex(r / count, g / count, b / count);
}
