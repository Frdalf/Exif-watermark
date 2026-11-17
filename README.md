# EXIF Frame

Web app statis, 100% client-side, untuk menambahkan bingkai dan watermark data EXIF ke foto. Semua diproses di browser menggunakan Canvas 2D API — foto tidak pernah diunggah ke server mana pun.

## Fitur

- **Baca EXIF otomatis**: kamera, lensa, focal length (utamakan 35mm eq.), aperture, shutter speed, ISO, tanggal
- **8 template**:
  - Strip: Klasik, Tengah, Satu baris, Overlay
  - Berbingkai: Polaroid, Film, Blur, Bingkai tipis
- **Tema putih / hitam** dan ukuran teks yang dapat diatur (`0.6`–`1.8`)
- **Edit manual**: seluruh data EXIF per foto bisa diedit (berguna saat EXIF hilang, mis. foto dari WhatsApp)
- **Teks tambahan / tanda tangan** (mis. `© Farid`)
- **Batch**: unggah banyak foto sekaligus (klik atau drag & drop), pratinjau langsung, unduh satu per satu atau semua sebagai ZIP
- **Ekspor resolusi asli** (JPEG atau PNG) dengan pengaturan tersimpan di `localStorage`

## Jalankan lokal

```bash
npm install
npm run dev
```

## Deploy ke Cloudflare Pages

### Opsi A: lewat Git (disarankan, otomatis deploy tiap push)

1. Push repositori ini ke GitHub.
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Pilih repositori, lalu isi:
   - **Framework preset:** None (atau Vite)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. **Save and Deploy**. Hasilnya akan tersedia di `https://<nama-proyek>.pages.dev`.

### Opsi B: upload langsung dari terminal

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name exif-frame
```

*(Pertama kali akan diminta login: `npx wrangler login`.)*

## Catatan

- Format input: JPEG, PNG, WebP. HEIC belum didukung kecuali browser bisa membukanya sendiri (Safari).
- Foto sangat besar (di atas ~100 MP) bisa gagal di browser HP karena batas ukuran kanvas.
- Ingin menambah template? Edit `src/render.ts`, tambahkan `id` di `TemplateId`, dan tambahkan tombolnya di `index.html`.

## Lisensi

[MIT](LICENSE)
