import './style.css';
import { zipSync } from 'fflate';
import { readMeta, type Meta } from './meta';
import { render, type LogoImage, type Opts, type TemplateId, type Theme } from './render';
import { LOGOS, getCustomLogoImage, getLogoColor, getLogoImage } from './logos';

interface CustomLogo {
  id: string;
  name: string;
  dataUrl: string;
}

interface Item {
  id: number;
  file: File;
  preview: ImageBitmap; // versi kecil untuk pratinjau
  pw: number;
  ph: number;
  meta: Meta;
  brandOverride: string; // '' = otomatis, 'none' = tanpa logo, 'custom:<id>' atau key LOGOS
  thumb: string; // object URL
}

const PREVIEW_EDGE = 1600;
const STORE_KEY = 'exif-frame:settings:v1';
const MAX_LOGO_BYTES = 500 * 1024;
const DB_NAME = 'exif-frame-db';
const DB_STORE = 'logos';

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
  quality: $<HTMLInputElement>('quality'),
  qualityRow: $('qualityRow'),
  dlOne: $<HTMLButtonElement>('dlOne'),
  dlAll: $<HTMLButtonElement>('dlAll'),
  status: $('status'),
  empty: $('empty'),
  canvas: $<HTMLCanvasElement>('preview'),
  mBrand: $<HTMLSelectElement>('m-brand'),
  logoFile: $<HTMLInputElement>('logoFile'),
  uploadLogo: $<HTMLButtonElement>('uploadLogo'),
  delLogo: $<HTMLButtonElement>('delLogo'),
  mCamera: $<HTMLInputElement>('m-camera'),
  mLens: $<HTMLInputElement>('m-lens'),
  mParams: $<HTMLInputElement>('m-params'),
  mDate: $<HTMLInputElement>('m-date'),
};

const state = {
  template: 'classic' as TemplateId,
  theme: 'light' as Theme,
  format: 'jpeg' as 'jpeg' | 'png',
  items: [] as Item[],
  selected: -1,
  busy: false,
  customLogos: [] as CustomLogo[],
  previewLogo: undefined as LogoImage | undefined,
  logoReqId: 0,
};
let nextId = 1;

// ---------- IndexedDB untuk logo kustom ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbGetAllLogos(): Promise<CustomLogo[]> {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => res((req.result as CustomLogo[]) || []);
      req.onerror = () => rej(req.error);
    });
  } catch {
    return [];
  }
}

async function dbSaveLogo(logo: CustomLogo): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(logo);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function dbDeleteLogo(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---------- pengaturan tersimpan ----------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    if (s.template) state.template = s.template;
    if (s.theme) state.theme = s.theme;
    if (s.format) state.format = s.format;
    if (typeof s.scale === 'number') els.scale.value = String(s.scale);
    if (typeof s.showLens === 'boolean') els.showLens.checked = s.showLens;
    if (typeof s.showDate === 'boolean') els.showDate.checked = s.showDate;
    if (typeof s.showLogo === 'boolean') els.showLogo.checked = s.showLogo;
    if (typeof s.signature === 'string') els.signature.value = s.signature;
    if (typeof s.quality === 'number') els.quality.value = String(s.quality);
  } catch {
    /* abaikan */
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
        signature: els.signature.value,
        quality: +els.quality.value,
      }),
    );
  } catch {
    /* abaikan */
  }
}

function getOpts(logo?: LogoImage): Opts {
  return {
    template: state.template,
    theme: state.theme,
    scale: +els.scale.value,
    signature: els.signature.value,
    showLens: els.showLens.checked,
    showDate: els.showDate.checked,
    showLogo: els.showLogo.checked,
    logo,
  };
}

// ---------- resolusi logo ----------
async function resolveLogoForItem(it: Item): Promise<LogoImage | undefined> {
  if (!els.showLogo.checked) return undefined;
  const choice = it.brandOverride;
  if (choice === 'none') return undefined;
  if (choice.startsWith('custom:')) {
    const id = choice.slice(7);
    const custom = state.customLogos.find((l) => l.id === id);
    if (!custom) return undefined;
    return (await getCustomLogoImage(custom.dataUrl)) ?? undefined;
  }
  const brandKey = choice || it.meta.brand;
  if (!brandKey) return undefined;
  const color = getLogoColor(state.template, state.theme);
  return (await getLogoImage(brandKey, color)) ?? undefined;
}

function refreshPreviewLogo() {
  const it = current();
  const reqId = ++state.logoReqId;
  if (!it || !els.showLogo.checked) {
    state.previewLogo = undefined;
    schedulePreview();
    return;
  }
  resolveLogoForItem(it).then((logo) => {
    if (reqId !== state.logoReqId || current() !== it) return;
    state.previewLogo = logo;
    schedulePreview();
  });
}

// ---------- dropdown brand ----------
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

// ---------- pratinjau ----------
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
  if (!it) return;
  render(els.canvas, it.preview, it.pw, it.ph, it.meta, getOpts(state.previewLogo));
}

function onOptionChange() {
  els.qualityRow.hidden = state.format !== 'jpeg';
  saveSettings();
  refreshPreviewLogo();
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
  refreshPreviewLogo();
}

function removeItem(i: number) {
  const [it] = state.items.splice(i, 1);
  it.preview.close();
  URL.revokeObjectURL(it.thumb);
  if (state.selected >= state.items.length) state.selected = state.items.length - 1;
  renderThumbs();
  fillMetaFields();
  refreshPreviewLogo();
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
  const [full, logo] = await Promise.all([decode(it.file), resolveLogoForItem(it)]);
  const c = document.createElement('canvas');
  render(c, full, full.width, full.height, it.meta, getOpts(logo));
  full.close();
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
    // JPEG/PNG sudah terkompresi, jadi simpan tanpa kompresi ulang (level 0)
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

for (const e of [els.scale, els.showLens, els.showDate, els.showLogo, els.signature, els.quality]) {
  e.addEventListener('input', onOptionChange);
}

els.mBrand.addEventListener('change', () => {
  const it = current();
  if (!it) return;
  it.brandOverride = els.mBrand.value;
  els.delLogo.hidden = !it.brandOverride.startsWith('custom:');
  refreshPreviewLogo();
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
    await dbSaveLogo(logo);
  } catch {
    setStatus('Gagal menyimpan logo ke browser.');
    return;
  }
  state.customLogos.push(logo);
  const it = current();
  if (it) it.brandOverride = `custom:${logo.id}`;
  renderBrandOptions();
  refreshPreviewLogo();
  setStatus(`Logo "${f.name}" tersimpan.`);
});

els.delLogo.addEventListener('click', async () => {
  const val = els.mBrand.value;
  if (!val.startsWith('custom:')) return;
  const id = val.slice(7);
  await dbDeleteLogo(id);
  state.customLogos = state.customLogos.filter((l) => l.id !== id);
  for (const item of state.items) {
    if (item.brandOverride === val) item.brandOverride = '';
  }
  renderBrandOptions();
  refreshPreviewLogo();
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
fillMetaFields();
onOptionChange();
dbGetAllLogos().then((list) => {
  state.customLogos = list;
  renderBrandOptions();
});
