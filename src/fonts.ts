export interface FontDef {
  id: string;
  label: string;
  family: string; // nama CSS family utama (tanpa fallback)
  stack: string;  // lengkap dengan fallback sistem untuk glif khusus (·, |, ©, ▶, ×)
  weights: number[];
  load?: () => Promise<unknown>;
}

const SYS_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYS_SERIF = 'Georgia, "Times New Roman", serif';
const SYS_MONO = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Courier New", monospace';

export const FONTS: FontDef[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: 'Inter',
    stack: `"Inter", ${SYS_SANS}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/inter/latin-400.css'),
      import('@fontsource/inter/latin-500.css'),
      import('@fontsource/inter/latin-700.css'),
    ]),
  },
  {
    id: 'poppins',
    label: 'Poppins',
    family: 'Poppins',
    stack: `"Poppins", ${SYS_SANS}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/poppins/latin-400.css'),
      import('@fontsource/poppins/latin-500.css'),
      import('@fontsource/poppins/latin-700.css'),
    ]),
  },
  {
    id: 'montserrat',
    label: 'Montserrat',
    family: 'Montserrat',
    stack: `"Montserrat", ${SYS_SANS}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/montserrat/latin-400.css'),
      import('@fontsource/montserrat/latin-500.css'),
      import('@fontsource/montserrat/latin-700.css'),
    ]),
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'Space Grotesk',
    stack: `"Space Grotesk", ${SYS_SANS}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/space-grotesk/latin-400.css'),
      import('@fontsource/space-grotesk/latin-500.css'),
      import('@fontsource/space-grotesk/latin-700.css'),
    ]),
  },
  {
    id: 'playfair-display',
    label: 'Playfair Display',
    family: 'Playfair Display',
    stack: `"Playfair Display", ${SYS_SERIF}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/playfair-display/latin-400.css'),
      import('@fontsource/playfair-display/latin-500.css'),
      import('@fontsource/playfair-display/latin-700.css'),
    ]),
  },
  {
    id: 'lora',
    label: 'Lora',
    family: 'Lora',
    stack: `"Lora", ${SYS_SERIF}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/lora/latin-400.css'),
      import('@fontsource/lora/latin-500.css'),
      import('@fontsource/lora/latin-700.css'),
    ]),
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    stack: `"JetBrains Mono", ${SYS_MONO}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/jetbrains-mono/latin-400.css'),
      import('@fontsource/jetbrains-mono/latin-500.css'),
      import('@fontsource/jetbrains-mono/latin-700.css'),
    ]),
  },
  {
    id: 'caveat',
    label: 'Caveat',
    family: 'Caveat',
    stack: `"Caveat", ${SYS_SANS}`,
    weights: [400, 500, 700],
    load: () => Promise.all([
      import('@fontsource/caveat/latin-400.css'),
      import('@fontsource/caveat/latin-500.css'),
      import('@fontsource/caveat/latin-700.css'),
    ]),
  },
  {
    id: 'bebas-neue',
    label: 'Bebas Neue',
    family: 'Bebas Neue',
    stack: `"Bebas Neue", ${SYS_SANS}`,
    weights: [400],
    load: () => import('@fontsource/bebas-neue/latin-400.css'),
  },
  { id: 'system-ui', label: 'System UI', family: 'system-ui', stack: SYS_SANS, weights: [400, 500, 700] },
  { id: 'georgia', label: 'Georgia', family: 'Georgia', stack: SYS_SERIF, weights: [400, 700] },
  { id: 'courier', label: 'Courier New', family: 'Courier New', stack: SYS_MONO, weights: [400, 700] },
];

const fontMap = new Map(FONTS.map((f) => [f.id, f]));
const customFontStacks = new Map<string, string>();
const loadedFonts = new Map<string, Promise<void>>();

export function registerCustomFont(id: string, familyName: string): void {
  customFontStacks.set(`custom:${id}`, `"${familyName}", ${SYS_SANS}`);
}

export function unregisterCustomFont(id: string): void {
  customFontStacks.delete(`custom:${id}`);
}

export function getFontStack(fontId: string | null): string | null {
  if (!fontId) return null;
  if (customFontStacks.has(fontId)) return customFontStacks.get(fontId)!;
  return fontMap.get(fontId)?.stack ?? null;
}

/** Pilih bobot terdekat yang tersedia pada font agar browser tidak membuat faux-bold. */
export function resolveFontWeight(fontId: string | null, desired: number): number {
  if (!fontId) return desired;
  if (fontId.startsWith('custom:')) return 400;
  const def = fontMap.get(fontId);
  if (!def || def.weights.length === 0) return desired;
  let best = def.weights[0];
  let bestDist = Math.abs(best - desired);
  for (const w of def.weights) {
    const d = Math.abs(w - desired);
    if (d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  return best;
}

/** Muat font secara malas (lazy) lalu tunggu `document.fonts.load` sebelum render canvas. */
export function ensureFont(fontId: string | null): Promise<void> {
  if (!fontId || fontId.startsWith('custom:')) return Promise.resolve();
  const def = fontMap.get(fontId);
  if (!def || !def.load) return Promise.resolve();

  let pending = loadedFonts.get(fontId);
  if (!pending) {
    pending = (async () => {
      await def.load!();
      if (typeof document !== 'undefined' && document.fonts) {
        await Promise.all(
          def.weights.map((w) => document.fonts.load(`${w} 16px "${def.family}"`).catch(() => [])),
        );
      }
    })();
    loadedFonts.set(fontId, pending);
  }
  return pending;
}
