import exifr from 'exifr';

export interface Meta {
  camera: string;
  lens: string;
  params: string;
  date: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDate(d: unknown): string {
  if (d instanceof Date && !isNaN(d.getTime())) {
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return '';
}

function formatShutter(t: unknown): string {
  if (typeof t !== 'number' || !isFinite(t) || t <= 0) return '';
  if (t >= 1) return `${Number.isInteger(t) ? t : t.toFixed(1)}s`;
  return `1/${Math.round(1 / t)}s`;
}

function formatNumber(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.0+$/, '');
}

export function cameraName(make?: string, model?: string): string {
  const mk = (make ?? '').trim();
  const md = (model ?? '').trim();
  if (!md) return mk;
  if (!mk) return md;
  // Banyak model sudah memuat nama merek (mis. "Canon EOS R6"), jangan digandakan
  const firstWord = mk.split(/\s+/)[0].toLowerCase();
  if (md.toLowerCase().includes(firstWord)) return md;
  return `${mk} ${md}`;
}

export const EMPTY_META: Meta = { camera: '', lens: '', params: '', date: '' };

export async function readMeta(file: File): Promise<Meta> {
  let t: any = null;
  try {
    t = await exifr.parse(file, {
      pick: [
        'Make',
        'Model',
        'LensModel',
        'FocalLength',
        'FocalLengthIn35mmFormat',
        'FNumber',
        'ExposureTime',
        'ISO',
        'DateTimeOriginal',
        'CreateDate',
      ],
    });
  } catch {
    t = null;
  }
  if (!t) return { ...EMPTY_META };

  const parts: string[] = [];
  const focal = t.FocalLengthIn35mmFormat ?? t.FocalLength;
  if (typeof focal === 'number' && focal > 0) parts.push(`${Math.round(focal)}mm`);
  if (typeof t.FNumber === 'number' && t.FNumber > 0) parts.push(`f/${formatNumber(t.FNumber)}`);
  const shutter = formatShutter(t.ExposureTime);
  if (shutter) parts.push(shutter);
  if (typeof t.ISO === 'number' && t.ISO > 0) parts.push(`ISO ${t.ISO}`);

  return {
    camera: cameraName(t.Make, t.Model),
    lens: (t.LensModel ?? '').toString().trim(),
    params: parts.join('  '),
    date: formatDate(t.DateTimeOriginal ?? t.CreateDate),
  };
}
