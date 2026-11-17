# EXIF Frame

A static web app to add clean EXIF frames and watermarks to your photos. Everything is processed locally in your browser using HTML5 Canvas — your photos are never uploaded to any server.

## Features

- **Automatic EXIF parsing**: Reads camera, lens, focal length, aperture, shutter speed, ISO, and capture date.
- **4 frame templates**: Classic, Centered, Single-line, and Overlay, with light (white) or dark (black) themes.
- **Manual editing**: Edit any EXIF field manually (useful when metadata is stripped, e.g. photos saved from messaging apps).
- **Custom signature / text**: Add your own watermark or copyright text (e.g. `© Farid`).
- **Batch processing**: Select multiple photos at once and download all results as a ZIP archive.
- **Original resolution export**: Export as JPEG or PNG at full resolution. Preferences are saved locally in the browser.

## Run Locally

```bash
npm install
npm run dev
```

## Deploy to Cloudflare Pages

### Option A: Via Git (recommended, auto-deploys on every push)

1. Push this repository to GitHub.
2. Go to Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Select your repository and configure:
   - **Framework preset:** None (or Vite)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Click **Save and Deploy**. Your site will be live at `https://<project-name>.pages.dev`.

### Option B: Direct upload from terminal

```bash
npm install
npm run build
npx wrangler pages deploy dist --project-name exif-frame
```

*(First-time deploy will prompt you to log in via `npx wrangler login`.)*

## Notes

- **Supported input formats:** JPEG, PNG, and WebP. HEIC is not supported unless natively decoded by your browser (e.g. Safari).
- **Large images:** Very high-resolution photos (above ~100 MP) may fail on mobile browsers due to canvas size limits.
- **Adding custom templates:** Edit `src/render.ts`, add a new `id` to `TemplateId`, and add the corresponding button in `index.html`.

## License

[MIT](LICENSE)
