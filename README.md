# EXIF Frame

Web app statis untuk menambahkan bingkai dan watermark EXIF ke foto. Semua diproses di browser (canvas), foto tidak pernah diunggah ke server.

## Fitur

- Baca EXIF otomatis: kamera, lensa, focal length, aperture, shutter, ISO, tanggal
- 4 template: Klasik, Tengah, Satu baris, Overlay. Tema putih atau hitam
- Semua data bisa diedit manual (berguna kalau EXIF hilang, mis. foto dari WhatsApp)
- Teks tambahan / tanda tangan (mis. `© Farid`)
- Batch: pilih banyak foto, unduh sebagai ZIP
- Ekspor resolusi asli (JPEG atau PNG). Pengaturan tersimpan di browser

## Jalankan lokal

```bash
npm install
npm run dev
```

## Deploy ke Cloudflare Pages

### Opsi A: lewat Git (disarankan, otomatis deploy tiap push)

1. Push folder ini ke repo GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Pilih repo, lalu isi:
   - **Framework preset:** None (atau Vite)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Save and Deploy**. Hasilnya ada di `https://<nama-proyek>.pages.dev`.

### Opsi B: upload langsung dari terminal

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name exif-frame
```

(Pertama kali akan diminta login: `npx wrangler login`.)

## Catatan

- Format input: JPEG, PNG, WebP. HEIC belum didukung kecuali browser bisa membukanya sendiri (Safari).
- Foto sangat besar (di atas ~100 MP) bisa gagal di browser HP karena batas ukuran canvas.
- Ingin tambah template? Edit `src/render.ts`, tambahkan `id` di `TemplateId` dan tombol di `index.html`.
