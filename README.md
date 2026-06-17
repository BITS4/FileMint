# FileMint

**Read, convert, scan, edit, organize and secure documents** — a cross-platform
document studio built from a single Expo (React Native + Web) codebase.

One codebase ships:

- a **responsive web app** (installable PWA), and
- **native iOS / Android** apps,

backed by an optional **conversion server** for the heavy Office ⇆ PDF jobs.

---

## Quick start

```bash
npm install          # already done if you cloned a set-up repo
npm run web          # open the web app  (http://localhost:8081)
npm run ios          # iOS simulator (macOS)
npm run android      # Android emulator/device
npm run typecheck    # strict TypeScript check (app only)
```

The app is fully usable **offline** for the client-side tools. Office
conversions, OCR-to-searchable-PDF and PDF password tools talk to the
conversion server (below) and degrade gracefully when it isn't running.

### Conversion server (optional, for Office/OCR/security)

```bash
npm run server       # starts http://localhost:8787  (server:dev for watch)
```

On startup it prints which engines it found. Install the ones you want:

| Engine | Enables | Install (Windows) | Install (macOS) | Install (Linux) |
| --- | --- | --- | --- | --- |
| **LibreOffice** | DOCX/PPTX/XLSX -> PDF | `winget install TheDocumentFoundation.LibreOffice` | `brew install --cask libreoffice` | `apt install libreoffice` |
| **qpdf** | Lock / unlock / permissions | `winget install qpdf.qpdf` | `brew install qpdf` | `apt install qpdf` |
| **Ghostscript** | Repair PDF | `winget install ArtifexSoftware.GhostScript` | `brew install ghostscript` | `apt install ghostscript` |
| **ocrmypdf** | Searchable PDF (OCR text layer) | `pip install ocrmypdf` | `brew install ocrmypdf` | `apt install ocrmypdf` |
| **pdf2docx** | PDF -> Word (LibreOffice can't export PDF->Office) | `pip install pdf2docx` | `pip install pdf2docx` | `pip install pdf2docx` |
| **PyMuPDF + openpyxl + python-pptx** | PDF -> Excel / PowerPoint / HTML | `pip install -r server/requirements.txt` | `pip install -r server/requirements.txt` | `pip install -r server/requirements.txt` |

For the high-fidelity PDF -> Word pipeline, install the Python helper packages:

```bash
pip install -r server/requirements.txt
```

> Windows note: the server invokes LibreOffice via **`soffice.com`** (the blocking console launcher) and auto-discovers `pdf2docx.exe` in the Python `Scripts` folder even when it isn't on PATH.

Then point the app at the server in **Settings → Conversion server**:

- **Web / simulator:** `http://localhost:8787` (default).
- **Physical device:** use your computer's LAN IP, e.g. `http://192.168.1.20:8787`
  (the server listens on `0.0.0.0`).

Uploaded files are processed in a temp directory and **deleted immediately**
after the response is produced.

### Production auth, email verification, and card payments

FileMint can be deployed as a public web app, but real email delivery and real
Visa/Mastercard payments must run through provider accounts on the server. Users
only see FileMint; the server talks to the providers with private environment
variables.

Set these before deploying the server:

```bash
NODE_ENV=production
FILEMINT_PUBLIC_URL=https://your-filemint-domain.com

# Email verification / password reset via Resend
RESEND_API_KEY=re_...
FILEMINT_EMAIL_FROM="FileMint <verify@your-domain.com>"

# Stripe Checkout for cards
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_WEEK=price_...
STRIPE_PRICE_MONTH=price_...
STRIPE_PRICE_YEAR=price_...
STRIPE_PRICE_FOREVER=price_...
```

Stripe webhook endpoint:

```text
https://your-server-domain.com/auth/stripe/webhook
```

For local development only, if you want to test the UI without Stripe, set
`FILEMINT_ALLOW_DEV_PAYMENTS=true`. Do not set that in production.

### PDF → editable Word (digital & scanned)

PDF→Word is layout-aware ([server/pdf_to_docx.py](server/pdf_to_docx.py)), with modes in the tool UI:

- **Premium editable** — default PDF to Word path. Digital PDFs use the native
  PDF text layer/object model. Text-heavy digital PDFs are rebuilt with a
  spacing-safe text-flow path to avoid merged words; scanned PDFs run multiple
  OCR layout passes, preserve non-text visuals, and rebuild recognized text as
  positioned editable Word text boxes. Dense scanned tables/transcripts are
  rebuilt as real editable Word tables, while stamps and signatures are kept as
  image content.
- **Editable (auto)** — detects a text layer. Digital PDFs are reconstructed with
  `pdf2docx` into real, editable Word text + tables (verified: output contains
  `<w:t>` runs, not a page image). Scanned PDFs auto-route to OCR if available.
- **OCR — scanned** — OCRs each page with **Tesseract**. With layout
  preservation enabled, scanned pages keep the original visual layer for stamps,
  signatures, seals and exact spacing, while reliable OCR lines are added back as
  editable Word text at their page positions:
  ```powershell
  winget install -e --id UB-Mannheim.TesseractOCR
  ```
  For non-English scans, install that language's Tesseract data (e.g. drop
  `rus.traineddata` into `C:\Program Files\Tesseract-OCR\tessdata\`) and set the
  OCR language in **Settings**. FileMint also auto-uses local OCR data placed in
  `server/tessdata` so the conversion server can ship project-level language
  packs without modifying your system Tesseract folder.
- **Image only** — each page as a picture (explicit fallback).

Free-tool reality: digital PDFs reconstruct text **and tables**. Premium scanned
conversion maximizes editable OCR text and can rebuild detected transcript-style
tables as Word tables while keeping stamps, signatures, seals, photos and
unclear marks as visual content. Mixed-script OCR still depends heavily on
language data and scan quality.

### PDF -> Excel / PowerPoint / HTML

PDF export is handled by [server/pdf_export.py](server/pdf_export.py):

- **PDF -> Excel** extracts native PDF tables into real workbook sheets. If no
  table structure is exposed by the PDF, FileMint groups text into editable rows
  and columns so the workbook is still useful instead of blank.
- **PDF -> PowerPoint** preserves each page as an exact slide background and
  overlays editable transparent text boxes where native text or OCR is
  available.
- **PDF -> HTML** creates a self-contained visual preview with selectable text
  spans over the original page rendering.

For scanned PDFs, these exports use the same project/system Tesseract language
packs when a text layer is requested. The conversion report notes OCR language,
low-confidence areas and visual fallback.

### Editing Office files (Collabora Online)

Editing Word/Excel/PowerPoint in-app uses **Collabora Online** (a LibreOffice-based
editor) embedded in an iframe. The FileMint server acts as a **WOPI host**: when
you tap *Edit*, the file is uploaded to a temporary edit session, Collabora loads
and saves it over WOPI, and the edited bytes are pulled back into your library.

1. Install **Docker Desktop** (Windows/macOS) — `winget install Docker.DockerDesktop` — and start it.
2. Run Collabora, allowing it to call back to the FileMint server:
   ```bash
   docker run -t -d -p 9980:9980 \
     -e "aliasgroup1=http://host.docker.internal:8787,http://host.docker.internal:8788" \
     -e "extra_params=--o:ssl.enable=false --o:ssl.termination=false" \
     --name filemint-collabora collabora/code
   ```
   (On Linux add `--add-host=host.docker.internal:host-gateway`.)
3. Start the FileMint server (`npm run server`) — `/health` will report `collabora: true`
   once Collabora is reachable.
4. In the web app, open a `.docx`/`.xlsx`/`.pptx` and tap **Edit** → it opens in the
   embedded editor; **Save & Close** writes the changes back to your file.

Networking: the **browser** reaches Collabora at `COLLABORA_URL` (default
`http://localhost:9980`); **Collabora** reaches the FileMint server at `WOPI_HOST`
(default `http://host.docker.internal:<server port>`). Override either with env vars when
starting the server. Office editing is **web-only** (the iframe editor); on native,
text/CSV/Markdown editing works in-app and Office files open read-only.

---

## What works where

Every tool advertises an honest status in the UI:

- **Ready** – runs fully in the client, offline (pdf-lib).
- **Beta** – works with known limits.
- **Server** – needs the conversion server engine above.
- **Soon** – screen exists, processing not wired yet.

| Area | Tools | Status |
| --- | --- | --- |
| Create | Image → PDF, Text → PDF, CSV → PDF, Smart Scan → PDF | Ready / Beta |
| Organize | Merge, Split, Compress, Manage pages (reorder / rotate / delete / duplicate / blank / extract) | Ready |
| Edit | Watermark, Page numbers, Flatten, Crop, Add text & stamp | Ready / Beta |
| View | PDF (night mode, zoom), images, text, CSV table | Ready |
| View Office | Word/Excel/PowerPoint rendered natively on web (docx-preview / SheetJS / pptx-preview); on native, converted to PDF via the server | Ready (web) |
| OCR | Extract text from images & PDFs (web) | Beta (web) |
| Convert | DOCX/PPTX/XLSX → PDF, PDF → DOCX/XLSX/PPTX/HTML, Batch Convert, Searchable PDF | Server |
| Security | Lock, Unlock, Permissions, Repair | Server |
| Files | Library, folders, favorites, trash, sort, grid/list, rename, duplicate, share | Ready |

Drawing / signature / highlight / redaction and fillable-form editing are
scaffolded and marked accordingly.

---

## Architecture

```
src/
  app/                 Expo Router screens (file-based routing, shared web+native)
    (tabs)/            Home · Files · Convert · Edit · Tools (custom tab bar + FAB)
    tool/[id].tsx      Generic tool engine driven by lib/operations.ts
    viewer/[id].tsx    Document viewer
    image-to-pdf, merge, split, compress, manage-pages, scan, ocr, annotate, …
  components/
    ui/                Design-system primitives (Txt, Card, Button, Sheet, FileRow…)
    tools/ files/ navigation/ viewer/
  constants/           theme.ts (dark-first tokens) · tools.ts (tool catalogue)
  lib/                 pdf.ts (pdf-lib ops) · storage(.web).ts · api.ts · operations.ts
                       pdf-render(.web).ts (pdf.js) · ocr(.web).ts (tesseract) · image(.web).ts
  store/               zustand: useLibrary (files) · useSettings
server/                Hono conversion API (LibreOffice / qpdf / Ghostscript / ocrmypdf)
```

Platform differences are handled with Metro's `.web.ts` / `.ts` resolution:
storage uses **IndexedDB** on web and **expo-file-system** on native; PDF
rasterization and OCR use **pdf.js / tesseract.js** on web and the server on
device.

### Tech

Expo SDK 56 · React 19 · React Native 0.85 · Expo Router · TypeScript ·
pdf-lib · pdf.js · tesseract.js · zustand · Hono.

---

## Known limitations

- **Android in-app PDF preview** depends on the platform WebView; if a page
  doesn't render inline, use the viewer's **Share / Open** action to open it
  in an external viewer.
- **Native OCR** and **PDF → image/text** run in the web app or via the server
  (the heavy rasterizer isn't bundled for native in this build).
- The web PDF viewer renders with the browser's built-in PDF UI (zoom, search,
  print). pdf.js loads its worker from a CDN for PDF→image/text; bundle it for
  a fully offline deployment.
- Non-JPG/PNG images are converted to PNG via canvas on web; on native, use
  JPG/PNG (HEIC normalization is a planned enhancement).
