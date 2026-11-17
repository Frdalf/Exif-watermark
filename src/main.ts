import './style.css';
import { zipSync } from 'fflate';
import { readMeta, type Meta } from './meta';
import { averageColor, contrastRatio, mix, normalizeHex } from './color';
import { ensureFont, FONTS, registerCustomFont, unregisterCustomFont } from './fonts';
import { getCustomLogoImage, getLogoImage, LOGOS, type LogoColor, type LogoData } from './logos';
import { defaultFrameColor, render, type AspectOpts, type Opts, type TemplateId, type Theme } from './render';

interface CustomLogo {
  id: string;
  name: string;
  dataUrl: string;
}

interface CustomFont {
  id: string;
  name: string;
  family: string;
  dataUrl: string;
}

interface Item {
  id: number;
  file: File;
  preview: ImageBitmap;
  pw: number;
  ph: number;
  meta: Meta;
  brandOverride: string; // '' = otomatis, 'none' = tanpa logo, 'custom:<id>' atau key LOGOS
  thumb: string;
}

const PREVIEW_EDGE = 1600;
const STORE_KEY = 'exif-frame:settings:v2';
const MAX_LOGO_BYTES = 500 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const DB_NAME = 'exif-frame-db';
const DB_LOGOS = 'logos';
const DB_FONTS = 'fonts';

const VALID_TEMPLATES: TemplateId[] = ['classic', 'center', 'oneline', 'overlay', 'polaroid', 'film', 'blur', 'border'];
const VALID_RATIOS = ['original', '1:1', '4:5', '3:4', '2:3', '3:2', '4:3', '16:9', '9:16', 'custom'];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  drop: $<HTMLLabelElement>('drop'),
  file: $<HTMLInputElement>('file'),
  thumbs: $('thumbs'),
  scale: $<HTMLInputElement>('scale'),
  showLens: $<HTMLInputElement>('showLens'),
  showDate: $<HTMLInputElement>('showDate'),
  showLogo: $<HTMLInputElement>('showLogo'),
  signature: $<HTMLInputElement>('signature'),
  ratioCustom: $('ratioCustom'),
  ratioW: $<HTMLInputElement>('ratioW'),
  ratioH: $<HTMLInputElement>('ratioH'),
  fitGroup: $('fitGroup'),
  cropSliders: $('cropSliders'),
  cropX: $<HTMLInputElement>('cropX'),
  cropY: $<HTMLInputElement>('cropY'),
  framePicker: $<HTMLInputElement>('framePicker'),
  frameHex: $<HTMLInputElement>('frameHex'),
  frameReset: $<HTMLButtonElement>('frameReset'),
  frameAutoPhoto: $<HTMLButtonElement>('frameAutoPhoto'),
  frameAutoLight: $<HTMLButtonElement>('frameAutoLight'),
  frameAutoDark: $<HTMLButtonElement>('frameAutoDark'),
  textAuto: $<HTMLInputElement>('textAuto'),
  textColorRow: $('textColorRow'),
  textPicker: $<HTMLInputElement>('textPicker'),
  textHex: $<HTMLInputElement>('textHex'),
  contrastWarn: $('contrastWarn'),
  fontSelect: $<HTMLSelectElement>('fontSelect'),
  fontLoading: $('fontLoading'),
  fontFile: $<HTMLInputElement>('fontFile'),
  uploadFont: $<HTMLButtonElement>('uploadFont'),
  delFont: $<HTMLButtonElement>('delFont'),
  mBrand: $<HTMLSelectElement>('m-brand'),
  logoFile: $<HTMLInputElement>('logoFile'),
  uploadLogo: $<HTMLButtonElement>('uploadLogo'),
  delLogo: $<HTMLButtonElement>('delLogo'),
  logoPreviewBox: $('logoPreviewBox'),
  logoPreview: $<HTMLCanvasElement>('logoPreview'),
  quality: $<HTMLInputElement>('quality'),
  qualityRow: $('qualityRow'),
  maxEdge: $<HTMLSelectElement>('maxEdge'),
  dlOne: $<HTMLButtonElement>('dlOne'),
  dlAll: $<HTMLButtonElement>('dlAll'),
  status: $('status'),
  empty: $('empty'),
  canvas: $<HTMLCanvasElement>('preview'),
  mCamera: $<HTMLInputElement>('m-camera'),
  mLens: $<HTMLInputElement>('m-lens'),
  mParams: $<HTMLInputElement>('m-params'),
  mDate: $<HTMLInputElement>('m-date'),
};

const state = {
  template: 'classic' as TemplateId,
  theme: 'light' as Theme,
  format: 'jpeg' as 'jpeg' | 'png',
  aspectPreset: 'original',
  aspectFit: 'contain' as 'contain' | 'cover',
  frameColor: null as string | null,
  textColor: null as string | null,
  fontFamily: null as string | null,
  logoColor: 'black' as LogoColor,
  items: [] as Item[],
  selected: -1,
  busy: false,
  customLogos: [] as CustomLogo[],
  customFonts: [] as CustomFont[],
  preparedLogo: undefined as LogoData | undefined,
  prepToken: 0,
};
let nextId = 1;

// ---------- IndexedDB ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_LOGOS)) {
        req.result.createObjectStore(DB_LOGOS, { keyPath: 'id' });
      }
      if (!req.result.objectStoreNames.contains(DB_FONTS)) {
        req.result.createObjectStore(DB_FONTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbGetAll<T>(store: string): Promise<T[]> {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res((req.result as T[]) || []);
      req.onerror = () => rej(req.error);
    });
  } catch {
    return [];
  }
}

async function dbPut<T>(store: string, val: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function dbDelete(store: string, id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- pengaturan tersimpan (validasi ketat) ----------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (VALID_TEMPLATES.includes(s.template)) state.template = s.template;
    if (s.theme === 'light' || s.theme === 'dark') state.theme = s.theme;
    if (s.format === 'jpeg' || s.format === 'png') state.format = s.format;
    if (typeof s.scale === 'number' && s.scale >= 0.6 && s.scale <= 1.8) els.scale.value = String(s.scale);
    if (typeof s.showLens === 'boolean') els.showLens.checked = s.showLens;
    if (typeof s.showDate === 'boolean') els.showDate.checked = s.showDate;
    if (typeof s.showLogo === 'boolean') els.showLogo.checked = s.showLogo;
    if (s.logoColor === 'black' || s.logoColor === 'white') state.logoColor = s.logoColor;
    if (typeof s.signature === 'string') els.signature.value = s.signature;
    if (typeof s.quality === 'number' && s.quality >= 0.7 && s.quality <= 1) els.quality.value = String(s.quality);
    if (VALID_RATIOS.includes(s.aspectPreset)) state.aspectPreset = s.aspectPreset;
    if (typeof s.ratioW === 'number' && s.ratioW > 0 && s.ratioW <= 100) els.ratioW.value = String(s.ratioW);
    if (typeof s.ratioH === 'number' && s.ratioH > 0 && s.ratioH <= 100) els.ratioH.value = String(s.ratioH);
    if (s.aspectFit === 'contain' || s.aspectFit === 'cover') state.aspectFit = s.aspectFit;
    if (typeof s.cropX === 'number' && s.cropX >= 0 && s.cropX <= 100) els.cropX.value = String(s.cropX);
    if (typeof s.cropY === 'number' && s.cropY >= 0 && s.cropY <= 100) els.cropY.value = String(s.cropY);
    if (typeof s.frameColor === 'string' && normalizeHex(s.frameColor)) state.frameColor = normalizeHex(s.frameColor);
    if (typeof s.textAuto === 'boolean') els.textAuto.checked = s.textAuto;
    if (typeof s.textColor === 'string' && normalizeHex(s.textColor)) state.textColor = normalizeHex(s.textColor);
    if (typeof s.fontFamily === 'string') state.fontFamily = s.fontFamily;
    if (['', '4096', '2048', '1080'].includes(String(s.maxEdge ?? ''))) els.maxEdge.value = String(s.maxEdge ?? '');
  } catch {
    /* abaikan nilai rusak */
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        template: state.template,
        theme: state.theme,
        format: state.format,
        scale: +els.scale.value,
        showLens: els.showLens.checked,
        showDate: els.showDate.checked,
        showLogo: els.showLogo.checked,
        logoColor: state.logoColor,
        signature: els.signature.value,
        quality: +els.quality.value,
        aspectPreset: state.aspectPreset,
        ratioW: +els.ratioW.value,
        ratioH: +els.ratioH.value,
        aspectFit: state.aspectFit,
        cropX: +els.cropX.value,
        cropY: +els.cropY.value,
        frameColor: state.frameColor,
        textAuto: els.textAuto.checked,
        textColor: state.textColor,
        fontFamily: state.fontFamily,
        maxEdge: els.maxEdge.value,
      }),
    );
  } catch {
    /* abaikan */
  }
}

function parseAspect(): AspectOpts {
  if (state.aspectPreset === 'original') {
    return { mode: 'original', w: 1, h: 1, fit: state.aspectFit, cropX: +els.cropX.value, cropY: +els.cropY.value };
  }
  let w = 1;
  let h = 1;
  if (state.aspectPreset === 'custom') {
    w = Math.max(1, Number(els.ratioW.value) || 1);
    h = Math.max(1, Number(els.ratioH.value) || 1);
  } else {
    const [rw, rh] = state.aspectPreset.split(':').map(Number);
    w = rw || 1;
    h = rh || 1;
  }
  return { mode: 'ratio', w, h, fit: state.aspectFit, cropX: +els.cropX.value, cropY: +els.cropY.value };
}

function getOpts(logo?: LogoData, forExport = false): Opts {
  const maxEdgeVal = Number(els.maxEdge.value);
  return {
    template: state.template,
    theme: state.theme,
    scale: +els.scale.value,
    signature: els.signature.value,
    showLens: els.showLens.checked,
    showDate: els.showDate.checked,
    aspect: parseAspect(),
    frameColor: state.frameColor,
    textColor: els.textAuto.checked ? null : state.textColor,
    fontFamily: state.fontFamily,
    maxEdge: forExport && maxEdgeVal > 0 ? maxEdgeVal : null,
    showLogo: els.showLogo.checked,
    logoColor: state.logoColor,
    logo,
  };
}

// ---------- persiapan async (font + logo) ----------
async function resolveLogoForItem(it: Item): Promise<LogoData | undefined> {
  if (!els.showLogo.checked) return undefined;
  const choice = it.brandOverride;
  if (choice === 'none') return undefined;
  if (choice.startsWith('custom:')) {
    const id = choice.slice(7);
    const custom = state.customLogos.find((l) => l.id === id);
    if (!custom) return undefined;
    return (await getCustomLogoImage(custom.dataUrl, state.logoColor)) ?? undefined;
  }
  const brandKey = choice || it.meta.brand;
  if (!brandKey) return undefined;
  return (await getLogoImage(brandKey, state.logoColor)) ?? undefined;
}

async function prepare(it: Item | undefined, fontId: string | null): Promise<LogoData | undefined> {
  const [, logo] = await Promise.all([
    ensureFont(fontId),
    it ? resolveLogoForItem(it) : Promise.resolve(undefined),
  ]);
  return logo;
}

function syncColorUI() {
  const effectiveFrame = state.frameColor ?? defaultFrameColor(state.template, state.theme);
  els.framePicker.value = effectiveFrame;
  els.frameHex.value = state.frameColor ?? '';
  els.textColorRow.hidden = els.textAuto.checked;

  if (!els.textAuto.checked && state.textColor) {
    els.textPicker.value = state.textColor;
    els.textHex.value = state.textColor;
    els.contrastWarn.hidden = contrastRatio(state.textColor, effectiveFrame) >= 3;
  } else {
    els.contrastWarn.hidden = true;
  }

  els.ratioCustom.hidden = state.aspectPreset !== 'custom';
  els.fitGroup.hidden = state.aspectPreset === 'original';
  els.cropSliders.hidden = state.aspectPreset === 'original' || state.aspectFit !== 'cover';
}

function updateLogoPreview(logo?: LogoData) {
  if (!logo) {
    els.logoPreviewBox.hidden = true;
    return;
  }
  els.logoPreviewBox.hidden = false;
  const c = els.logoPreview;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  const pad = 4;
  const maxW = c.width - pad * 2;
  const maxH = c.height - pad * 2;
  let h = maxH;
  let w = h * logo.ratio;
  if (w > maxW) {
    w = maxW;
    h = w / logo.ratio;
  }
  ctx.drawImage(logo.img, (c.width - w) / 2, (c.height - h) / 2, w, h);
}

// ---------- pratinjau dengan token "yang terbaru menang" ----------
let raf = 0;
function schedulePreview() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(drawPreview);
}

function current(): Item | undefined {
  return state.items[state.selected];
}

function drawPreview() {
  const it = current();
  els.empty.hidden = !!it;
  els.canvas.hidden = !it;
  els.dlOne.disabled = !it || state.busy;
  els.dlAll.disabled = state.items.length === 0 || state.busy;
  els.frameAutoPhoto.disabled = !it;
  els.frameAutoLight.disabled = !it;
  els.frameAutoDark.disabled = !it;
  if (!it) return;
  const layout = render(els.canvas, it.preview, it.pw, it.ph, it.meta, getOpts(state.preparedLogo, false));
  if (layout.clamped) {
    setStatus('Ukuran kanvas disesuaikan ke batas aman browser.');
  }
}

function refreshAndPreview() {
  syncColorUI();
  const it = current();
  const token = ++state.prepToken;
  const fontId = state.fontFamily;
  if (fontId && !fontId.startsWith('system') && fontId !== 'georgia' && fontId !== 'courier') {
    els.fontLoading.hidden = false;
  }
  prepare(it, fontId).then((logo) => {
    if (token !== state.prepToken) return; // hasil basi dibuang
    els.fontLoading.hidden = true;
    state.preparedLogo = logo;
    updateLogoPreview(it?.brandOverride.startsWith('custom:') ? logo : undefined);
    schedulePreview();
  });
}

function onOptionChange() {
  els.qualityRow.hidden = state.format !== 'jpeg';
  saveSettings();
  refreshAndPreview();
}

// ---------- dropdown font & brand ----------
function renderFontOptions() {
  const prev = state.fontFamily ?? '';
  els.fontSelect.innerHTML = '';

  const def = document.createElement('option');
  def.value = '';
  def.textContent = 'Default template';
  els.fontSelect.append(def);

  if (state.customFonts.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = 'Font unggahan';
    for (const cf of state.customFonts) {
      const o = document.createElement('option');
      o.value = `custom:${cf.id}`;
      o.textContent = `Font saya: ${cf.name}`;
      o.style.fontFamily = cf.family;
      grp.append(o);
    }
    els.fontSelect.append(grp);
  }

  for (const f of FONTS) {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.label;
    o.style.fontFamily = f.stack;
    els.fontSelect.append(o);
  }

  els.fontSelect.value = prev;
  if (els.fontSelect.value !== prev) {
    els.fontSelect.value = '';
    state.fontFamily = null;
  }
  els.delFont.hidden = !(state.fontFamily ?? '').startsWith('custom:');
}

const BUILTIN_BRANDS = Object.entries(LOGOS).sort((a, b) => a[1].title.localeCompare(b[1].title));

function renderBrandOptions() {
  const it = current();
  const prev = it?.brandOverride ?? '';
  els.mBrand.innerHTML = '';

  const autoOpt = document.createElement('option');
  autoOpt.value = '';
  const detected = it?.meta.brand && LOGOS[it.meta.brand] ? LOGOS[it.meta.brand].title : '';
  autoOpt.textContent = detected ? `Otomatis (${detected})` : 'Otomatis (dari EXIF)';
  els.mBrand.append(autoOpt);

  if (state.customLogos.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = 'Logo unggahan';
    for (const c of state.customLogos) {
      const o = document.createElement('option');
      o.value = `custom:${c.id}`;
      o.textContent = `Logo saya: ${c.name}`;
      grp.append(o);
    }
    els.mBrand.append(grp);
  }

  const grpBuiltin = document.createElement('optgroup');
  grpBuiltin.label = 'Brand bawaan';
  for (const [key, entry] of BUILTIN_BRANDS) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = entry.title;
    grpBuiltin.append(o);
  }
  els.mBrand.append(grpBuiltin);

  const noneOpt = document.createElement('option');
  noneOpt.value = 'none';
  noneOpt.textContent = 'Tanpa logo';
  els.mBrand.append(noneOpt);

  els.mBrand.value = prev;
  if (els.mBrand.value !== prev) {
    els.mBrand.value = '';
    if (it) it.brandOverride = '';
  }
  els.delLogo.hidden = !els.mBrand.value.startsWith('custom:');
}

// ---------- segmented buttons ----------
function bindSeg(id: string, get: () => string, set: (v: string) => void) {
  const root = $(id);
  const sync = () => root.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === get()));
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    set(b.dataset.v!);
    sync();
    onOptionChange();
  });
  sync();
}

// ---------- daftar foto ----------
function renderThumbs() {
  els.thumbs.innerHTML = '';
  state.items.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'thumb' + (i === state.selected ? ' on' : '');
    b.title = it.file.name;
    const img = document.createElement('img');
    img.src = it.thumb;
    img.alt = it.file.name;
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = '×';
    x.title = 'Hapus';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      removeItem(i);
    });
    b.append(img, x);
    b.addEventListener('click', () => select(i));
    els.thumbs.append(b);
  });
}

function fillMetaFields() {
  const it = current();
  const m = it?.meta;
  els.mCamera.value = m?.camera ?? '';
  els.mLens.value = m?.lens ?? '';
  els.mParams.value = m?.params ?? '';
  els.mDate.value = m?.date ?? '';
  for (const e of [els.mBrand, els.mCamera, els.mLens, els.mParams, els.mDate]) e.disabled = !it;
  renderBrandOptions();
}

function select(i: number) {
  state.selected = i;
  renderThumbs();
  fillMetaFields();
  refreshAndPreview();
}

function removeItem(i: number) {
  const [it] = state.items.splice(i, 1);
  it.preview.close();
  URL.revokeObjectURL(it.thumb);
  if (state.selected >= state.items.length) state.selected = state.items.length - 1;
  renderThumbs();
  fillMetaFields();
  refreshAndPreview();
}

async function decode(file: Blob, resize?: { w: number; h: number }): Promise<ImageBitmap> {
  const base: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (resize) Object.assign(base, { resizeWidth: resize.w, resizeHeight: resize.h, resizeQuality: 'high' });
  try {
    return await createImageBitmap(file, base);
  } catch {
    return await createImageBitmap(file);
  }
}

async function addFiles(files: FileList | File[]) {
  const list = Array.from(files).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  if (!list.length) {
    setStatus('Format belum didukung. Gunakan JPEG, PNG, atau WebP.');
    return;
  }
  setStatus(`Memuat ${list.length} foto…`);
  for (const file of list) {
    try {
      const [meta, full] = await Promise.all([readMeta(file), decode(file)]);
      const k = Math.min(1, PREVIEW_EDGE / Math.max(full.width, full.height));
      const pw = Math.round(full.width * k);
      const ph = Math.round(full.height * k);
      const preview = k < 1 ? await decode(file, { w: pw, h: ph }) : full;
      if (preview !== full) full.close();
      state.items.push({
        id: nextId++,
        file,
        preview,
        pw,
        ph,
        meta,
        brandOverride: '',
        thumb: URL.createObjectURL(file),
      });
    } catch (err) {
      console.error(err);
      setStatus(`Gagal memuat ${file.name}`);
    }
  }
  setStatus('');
  select(state.selected >= 0 ? state.selected : state.items.length - 1 >= 0 ? 0 : -1);
}

// ---------- ekspor ----------
function setStatus(s: string) {
  els.status.textContent = s;
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

async function exportOne(it: Item): Promise<{ name: string; blob: Blob }> {
  const [full, logo] = await Promise.all([decode(it.file), prepare(it, state.fontFamily)]);
  const c = document.createElement('canvas');
  const layout = render(c, full, full.width, full.height, it.meta, getOpts(logo, true));
  full.close();
  if (layout.clamped) setStatus('Kanvas foto diturunkan skalanya agar aman di browser.');
  const type = state.format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob gagal'))), type, +els.quality.value),
  );
  c.width = c.height = 0; // lepas memori
  return { name: `${baseName(it.file.name)}_frame.${state.format === 'png' ? 'png' : 'jpg'}`, blob };
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function withBusy(fn: () => Promise<void>) {
  state.busy = true;
  drawPreview();
  try {
    await fn();
  } catch (err) {
    console.error(err);
    setStatus('Gagal mengekspor. Foto mungkin terlalu besar untuk browser ini.');
  } finally {
    state.busy = false;
    drawPreview();
  }
}

els.dlOne.addEventListener('click', () =>
  withBusy(async () => {
    const it = current();
    if (!it) return;
    setStatus('Memproses…');
    const { name, blob } = await exportOne(it);
    download(blob, name);
    setStatus('Selesai.');
  }),
);

els.dlAll.addEventListener('click', () =>
  withBusy(async () => {
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (let i = 0; i < state.items.length; i++) {
      setStatus(`Memproses ${i + 1}/${state.items.length}…`);
      const { name, blob } = await exportOne(state.items[i]);
      let n = name;
      for (let k = 2; used.has(n); k++) n = name.replace(/(\.[^.]+)$/, `_${k}$1`);
      used.add(n);
      files[n] = new Uint8Array(await blob.arrayBuffer());
    }
    setStatus('Membuat ZIP…');
    const zip = zipSync(files, { level: 0 });
    download(new Blob([zip as BlobPart], { type: 'application/zip' }), 'exif-frame.zip');
    setStatus('Selesai.');
  }),
);

// ---------- event ----------
els.file.addEventListener('change', () => {
  if (els.file.files) addFiles(els.file.files);
  els.file.value = '';
});

['dragenter', 'dragover'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.remove('over');
  }),
);
els.drop.addEventListener('drop', (e) => {
  const dt = (e as DragEvent).dataTransfer;
  if (dt?.files) addFiles(dt.files);
});

for (const e of [els.scale, els.showLens, els.showDate, els.showLogo, els.signature, els.quality, els.ratioW, els.ratioH, els.cropX, els.cropY, els.maxEdge]) {
  e.addEventListener('input', onOptionChange);
}

// Warna frame
els.framePicker.addEventListener('input', () => {
  state.frameColor = els.framePicker.value;
  onOptionChange();
});
els.frameHex.addEventListener('input', () => {
  const norm = normalizeHex(els.frameHex.value);
  if (norm) {
    state.frameColor = norm;
    onOptionChange();
  } else if (els.frameHex.value.trim() === '') {
    state.frameColor = null;
    onOptionChange();
  }
});
$('frameSwatches').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.c) return;
  state.frameColor = b.dataset.c;
  onOptionChange();
});
els.frameReset.addEventListener('click', () => {
  state.frameColor = null;
  els.textAuto.checked = true;
  state.textColor = null;
  onOptionChange();
});

function setAutoPhotoFrame(tint: 'raw' | 'light' | 'dark') {
  const it = current();
  if (!it) return;
  const makeC = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const avg = averageColor(it.preview, makeC);
  state.frameColor = tint === 'light' ? mix(avg, '#ffffff', 0.65) : tint === 'dark' ? mix(avg, '#000000', 0.65) : avg;
  onOptionChange();
}
els.frameAutoPhoto.addEventListener('click', () => setAutoPhotoFrame('raw'));
els.frameAutoLight.addEventListener('click', () => setAutoPhotoFrame('light'));
els.frameAutoDark.addEventListener('click', () => setAutoPhotoFrame('dark'));

// Warna teks
els.textAuto.addEventListener('change', () => {
  if (!els.textAuto.checked && !state.textColor) {
    state.textColor = els.textPicker.value;
  }
  onOptionChange();
});
els.textPicker.addEventListener('input', () => {
  els.textAuto.checked = false;
  state.textColor = els.textPicker.value;
  onOptionChange();
});
els.textHex.addEventListener('input', () => {
  const norm = normalizeHex(els.textHex.value);
  if (norm) {
    els.textAuto.checked = false;
    state.textColor = norm;
    onOptionChange();
  }
});
$('textSwatches').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b?.dataset.c) return;
  els.textAuto.checked = false;
  state.textColor = b.dataset.c;
  onOptionChange();
});

// Font
els.fontSelect.addEventListener('change', () => {
  state.fontFamily = els.fontSelect.value || null;
  els.delFont.hidden = !(state.fontFamily ?? '').startsWith('custom:');
  onOptionChange();
});
els.uploadFont.addEventListener('click', () => els.fontFile.click());
els.fontFile.addEventListener('change', async () => {
  const f = els.fontFile.files?.[0];
  els.fontFile.value = '';
  if (!f) return;
  if (f.size > MAX_FONT_BYTES) {
    setStatus('Ukuran font maksimal 2 MB.');
    return;
  }
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
  const id = `${Date.now()}`;
  const family = `CustomFont_${id}`;
  try {
    const face = new FontFace(family, `url("${dataUrl}")`);
    await face.load();
    document.fonts.add(face);
    const rec: CustomFont = { id, name: f.name.replace(/\.[^.]+$/, ''), family, dataUrl };
    await dbPut(DB_FONTS, rec);
    state.customFonts.push(rec);
    registerCustomFont(id, family);
    state.fontFamily = `custom:${id}`;
    renderFontOptions();
    onOptionChange();
    setStatus(`Font "${rec.name}" tersimpan.`);
  } catch {
    setStatus('Gagal memuat file font.');
  }
});
els.delFont.addEventListener('click', async () => {
  const val = state.fontFamily ?? '';
  if (!val.startsWith('custom:')) return;
  const id = val.slice(7);
  await dbDelete(DB_FONTS, id);
  unregisterCustomFont(id);
  state.customFonts = state.customFonts.filter((f) => f.id !== id);
  state.fontFamily = null;
  renderFontOptions();
  onOptionChange();
  setStatus('Font kustom dihapus.');
});

// Brand & Logo kustom
els.mBrand.addEventListener('change', () => {
  const it = current();
  if (!it) return;
  it.brandOverride = els.mBrand.value;
  els.delLogo.hidden = !it.brandOverride.startsWith('custom:');
  refreshAndPreview();
});

els.uploadLogo.addEventListener('click', () => els.logoFile.click());
els.logoFile.addEventListener('change', async () => {
  const f = els.logoFile.files?.[0];
  els.logoFile.value = '';
  if (!f) return;
  if (!/^image\/(svg\+xml|png|webp)$/.test(f.type)) {
    setStatus('Format logo harus SVG, PNG, atau WebP.');
    return;
  }
  if (f.size > MAX_LOGO_BYTES) {
    setStatus('Ukuran logo maksimal 500 KB.');
    return;
  }
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result || ''));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
  const logo: CustomLogo = { id: `${Date.now()}`, name: f.name, dataUrl };
  try {
    await dbPut(DB_LOGOS, logo);
  } catch {
    setStatus('Gagal menyimpan logo ke browser.');
    return;
  }
  state.customLogos.push(logo);
  const it = current();
  if (it) it.brandOverride = `custom:${logo.id}`;
  renderBrandOptions();
  refreshAndPreview();
  setStatus(`Logo "${f.name}" tersimpan.`);
});

els.delLogo.addEventListener('click', async () => {
  const val = els.mBrand.value;
  if (!val.startsWith('custom:')) return;
  const id = val.slice(7);
  await dbDelete(DB_LOGOS, id);
  state.customLogos = state.customLogos.filter((l) => l.id !== id);
  for (const item of state.items) {
    if (item.brandOverride === val) item.brandOverride = '';
  }
  renderBrandOptions();
  refreshAndPreview();
  setStatus('Logo kustom dihapus.');
});

const metaFields: [HTMLInputElement, keyof Meta][] = [
  [els.mCamera, 'camera'],
  [els.mLens, 'lens'],
  [els.mParams, 'params'],
  [els.mDate, 'date'],
];
for (const [el, key] of metaFields) {
  el.addEventListener('input', () => {
    const it = current();
    if (!it) return;
    it.meta[key] = el.value;
    schedulePreview();
  });
}

loadSettings();
bindSeg('template', () => state.template, (v) => (state.template = v as TemplateId));
bindSeg('theme', () => state.theme, (v) => (state.theme = v as Theme));
bindSeg('format', () => state.format, (v) => (state.format = v as 'jpeg' | 'png'));
bindSeg('aspectPreset', () => state.aspectPreset, (v) => (state.aspectPreset = v));
bindSeg('aspectFit', () => state.aspectFit, (v) => (state.aspectFit = v as 'contain' | 'cover'));
bindSeg('logoColor', () => state.logoColor, (v) => (state.logoColor = v as LogoColor));

renderFontOptions();
fillMetaFields();
onOptionChange();

Promise.all([dbGetAll<CustomLogo>(DB_LOGOS), dbGetAll<CustomFont>(DB_FONTS)]).then(async ([logos, fonts]) => {
  state.customLogos = logos;
  for (const cf of fonts) {
    try {
      const face = new FontFace(cf.family, `url("${cf.dataUrl}")`);
      await face.load();
      document.fonts.add(face);
      registerCustomFont(cf.id, cf.family);
      state.customFonts.push(cf);
    } catch {
      /* abaikan font rusak */
    }
  }
  renderFontOptions();
  renderBrandOptions();
  refreshAndPreview();
});
