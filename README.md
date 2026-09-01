# FileMint

**Read, convert, scan, edit, organize and secure documents** — a cross-platform
document studio built from a single Expo (React Native + Web) codebase.

One codebase ships:

- a **responsive web app** (installable PWA), and
- **native iOS / Android** apps,

backed by an optional **conversion server** for the heavy Office ⇆ PDF jobs.

---

## Quick start

Prerequisites: Node.js 22.13 or newer, npm 10 or newer, and Python 3.11 for the
optional conversion helpers. A fresh clone needs no provider credentials to run
the app, quality checks, or automated tests.

```bash
npm ci               # reproducible install from package-lock.json
python -m pip install -r server/requirements.lock.txt
python -m pip install -r server/requirements-dev.lock.txt
cp .env.example .env # optional local configuration (PowerShell: Copy-Item .env.example .env)
npm run web          # open the web app  (http://localhost:8081)
npm run ios          # iOS simulator (macOS)
npm run android      # Android emulator/device
npm run typecheck    # strict TypeScript check (app and server)
```

After one successful online load, the installable web app keeps its local shell
and locked PDF worker available offline. Client-side PDF tools continue to work;
Office conversions, OCR-to-searchable-PDF and PDF password tools require the
conversion server below and fail with an actionable message when it is absent.

### Conversion server (optional, for Office/OCR/security)

```bash
npm run server       # starts http://localhost:8787  (server:dev for watch)
```

For a self-contained server plus PostgreSQL, with no external account needed:

```bash
docker compose up --build
```

The database is not published outside the private Compose network and uses the
password from `FILEMINT_DB_PASSWORD` (with a local-only default); provider keys
remain unset.
Wait for both services to become healthy, then run the Expo app with `npm run
web`. Stop the stack with `docker compose down` (add `-v` only when you
intentionally want to delete the local database volume).

On startup it prints which engines it found. Install the ones you want:

| Engine                               | Enables                                            | Install (Windows)                                  | Install (macOS)                               | Install (Linux)                               |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| **LibreOffice**                      | DOCX/PPTX/XLSX -> PDF                              | `winget install TheDocumentFoundation.LibreOffice` | `brew install --cask libreoffice`             | `apt install libreoffice`                     |
| **qpdf**                             | Lock / unlock / permissions                        | `winget install qpdf.qpdf`                         | `brew install qpdf`                           | `apt install qpdf`                            |
| **Ghostscript**                      | Repair PDF                                         | `winget install ArtifexSoftware.GhostScript`       | `brew install ghostscript`                    | `apt install ghostscript`                     |
| **ocrmypdf**                         | Searchable PDF (OCR text layer)                    | `pip install ocrmypdf`                             | `brew install ocrmypdf`                       | `apt install ocrmypdf`                        |
| **pdf2docx**                         | PDF -> Word (LibreOffice can't export PDF->Office) | `pip install pdf2docx`                             | `pip install pdf2docx`                        | `pip install pdf2docx`                        |
| **PyMuPDF + openpyxl + python-pptx** | PDF -> Excel / PowerPoint / HTML                   | `pip install -r server/requirements.lock.txt`      | `pip install -r server/requirements.lock.txt` | `pip install -r server/requirements.lock.txt` |

For the high-fidelity PDF -> Word pipeline, install the Python helper packages:

```bash
pip install -r server/requirements.lock.txt
```

> Windows note: the server invokes LibreOffice via **`soffice.com`** (the blocking console launcher) and auto-discovers `pdf2docx.exe` in the Python `Scripts` folder even when it isn't on PATH.

Then point the app at the server in **Settings → Conversion server**:

- **Web / simulator:** `http://localhost:8787` (default).
- **Physical device:** use your computer's LAN IP, e.g. `http://192.168.1.20:8787`
  (the server listens on `0.0.0.0`).

Uploaded files are processed in a temp directory and **deleted immediately**
after the response is produced.

### Quality checks and tests

The test suite is isolated: it does not require Stripe, Resend, PostgreSQL,
Collabora, or external network calls. Run the same checks used by GitHub Actions:

```bash
npm run format:check   # Prettier across app, server, config, and docs
npm run check:file-size # reject code files above 500 physical lines
npm run lint           # ESLint; warnings fail the command
npm run lint:python    # Black formatting and Pyflakes correctness checks
npm run expo:check     # Expo SDK package compatibility
npm run typecheck      # app and complete Hono server
npm test               # unit and server middleware tests
npm run test:python    # Python conversion and export tests
npm run test:python:coverage # Python branch coverage with a 92% total gate
npm run test:all       # TypeScript and Python coverage gates
npm run test:coverage  # explicit 95/86/98/97 statement/branch/function/line gates
npm run server:smoke   # /health and /metrics in-process smoke check
npm run build:web      # production Expo web export
npm run audit          # fail if high/critical production risk increases
npm run audit --prefix server # zero-high production API dependency audit
```

`npm run verify` combines format, lint, typecheck, tests, and the production web
build. CI runs those gates on every push and pull request, installs the pinned
Python dependencies, tests and compile-checks the conversion helpers, and uses
`npm ci` so the committed lockfile is authoritative. A separate CodeQL workflow
analyzes both TypeScript and Python on pushes, pull requests, and a weekly
schedule with GitHub's extended security queries.

Coverage thresholds are enforced in `vitest.config.mts`; the current suite has
87 TypeScript spec files (557 tests) plus 233 Python conversion/export tests.
The TypeScript gate covers every server module, client business library,
constant registry, persisted store, and pure editor state module at 96.85%
statements, 89.99% branches, 98.48% functions, and 98.44% lines. Executable
launchers are checked by build/smoke jobs, while three browser-specific storage
and rendering adapters remain outside the Node coverage runner. Python branch
coverage measures the complete `server` Python source and must remain at or
above 92% under `.coveragerc` (currently 94.26%). Dependency update and audit
policy is documented in [DEPENDENCIES.md](DEPENDENCIES.md), and security reports are handled
according to [SECURITY.md](SECURITY.md).

### Production auth, email verification, and card payments

FileMint can be deployed as a public web app, but real email delivery and real
Visa/Mastercard payments must run through provider accounts on the server. Users
only see FileMint; the server talks to the providers with private environment
variables.

Set these before deploying the server:

```bash
NODE_ENV=production
FILEMINT_PUBLIC_URL=https://your-filemint-domain.com
DATABASE_URL=postgresql://...sslmode=require
DATABASE_TLS_REJECT_UNAUTHORIZED=true
FILEMINT_AUTH_CODE_PEPPER=<unique-random-secret-at-least-32-characters>
# Set true only behind a trusted proxy that overwrites forwarding headers.
FILEMINT_TRUST_PROXY=false

# Email verification / password reset via Resend
RESEND_API_KEY=<resend-api-key>
FILEMINT_EMAIL_FROM="FileMint <verify@your-domain.com>"

# Stripe Checkout for cards
STRIPE_SECRET_KEY=<stripe-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-secret>
STRIPE_PRICE_WEEK=<stripe-week-price-id>
STRIPE_PRICE_MONTH=<stripe-month-price-id>
STRIPE_PRICE_YEAR=<stripe-year-price-id>
STRIPE_PRICE_FOREVER=<stripe-lifetime-price-id>
```

Stripe webhook endpoint:

```text
https://your-server-domain.com/auth/stripe/webhook
```

For local development only, if you want to test the UI without Stripe, set
`FILEMINT_ALLOW_DEV_PAYMENTS=true`. Do not set that in production.

All supported variables, safe development defaults, observability settings,
upload limits, and CORS origins are listed in [`.env.example`](.env.example).
Never commit a populated `.env` file.

For hosted conversion features, deploy the server with the repository
`Dockerfile` instead of Render's plain Node runtime. The Docker image installs
LibreOffice, qpdf, Ghostscript, OCRmyPDF, Tesseract and the Python conversion
packages required by premium PDF/Office tools.

### Deployment

`npm run build:web` creates a verified static export in `dist/`, including the
manifest, service worker, icons, and same-origin PDF worker. Deploy that folder
to any static host and set `EXPO_PUBLIC_FILEMINT_SERVER_URL` at build time when
the conversion API is hosted separately.

Deploy the API from the repository `Dockerfile`, or use `docker-compose.yml` for
a health-checked API and PostgreSQL pair. Production startup rejects missing or
weak auth-code peppers, verifies PostgreSQL TLS certificates by default, limits
uploads and child-process output, and exposes `/health` for an orchestrator
readiness probe. Provider credentials are required only for the corresponding
email and payment features.

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
you tap _Edit_, the file is uploaded to a temporary edit session, Collabora loads
and saves it over WOPI, and the edited bytes are pulled back into your library.

1. Install **Docker Desktop** (Windows/macOS) — `winget install Docker.DockerDesktop` — and start it.
2. Run Collabora, allowing it to call back to the FileMint server:
   ```bash
   docker run -t -d -p 9980:9980 \
     -e "aliasgroup1=http://host.docker.internal:8787" \
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

For hosted Collabora (Render/Docker image), the editor can only be embedded if
Collabora is healthy, its frame policy allows the public FileMint frontend, and
its WebSocket route works through the host proxy. Render does not expose Apache's
`AllowEncodedSlashes NoDecode` / `nocanon` proxy controls, so avoid older CODE
24.x images that generate legacy `/cool/<encoded-document-url>/ws` WebSocket
paths. Use a pinned 26.x image, which generates the compact `/cool/ws` route:

```bash
collabora/code:26.04.1.4.1
```

Start with the smallest Render config first so `/hosting/discovery` returns XML:

```bash
aliasgroup1=https://filemint-docker.onrender.com:443,https://file-mint.vercel.app:443
server_name=filemint-office.onrender.com
DONT_GEN_SSL_CERT=1
extra_params=--o:ssl.enable=false --o:ssl.termination=true
```

On container hosts that do not allow Linux capabilities/chroot jails (Render free
image services can behave this way), add the compatibility flags below. Without
them Collabora may fail with `Capabilities are not set for the coolforkit program`
and Render will show `502` because no HTTP port becomes healthy:

```bash
extra_params=--o:ssl.enable=false --o:ssl.termination=true --o:security.capabilities=false --o:mount_jail_tree=false
```

If discovery is healthy but the iframe is blocked by the browser, add a frame
policy after that:

```bash
extra_params=--o:ssl.enable=false --o:ssl.termination=true --o:security.capabilities=false --o:mount_jail_tree=false --o:net.frame_ancestors=https://file-mint.vercel.app
```

If the editor loads but shows `Failed to establish socket connection`, confirm
the hosted office service is using the 26.x image above. That error means the
browser reached Collabora, but the reverse proxy rejected the editor WebSocket.

Render free services only provide 512 MB of RAM. Collabora can exceed that when
it starts or when multiple documents are opened, so use a low-memory profile if
you are testing on the free instance:

```bash
extra_params=--o:ssl.enable=false --o:ssl.termination=true --o:security.capabilities=false --o:mount_jail_tree=false --o:net.frame_ancestors=https://file-mint.vercel.app --o:num_prespawn_children=1 --o:per_document.max_concurrency=1 --o:serverside_config.max_idle_subforkits=1 --o:serverside_config.idle_timeout_secs=60 --o:per_document.idle_timeout_secs=300 --o:memproportion=65 --o:logging.level=warning --o:logging.level_startup=warning
```

This is still a test profile: for reliable public editing, run `filemint-office`
on an instance with at least 2 GB RAM. Otherwise Render may still restart it when
large DOCX/PPTX/XLSX files are opened.

FileMint will still offer an **Open Office editor** fallback in a new tab
whenever embedded editing is blocked.

---

## What works where

Every tool advertises an honest status in the UI:

- **Ready** – runs fully in the client, offline (pdf-lib).
- **Beta** – works with known limits.
- **Server** – needs the conversion server engine above.
- **Soon** – screen exists, processing not wired yet.

| Area        | Tools                                                                                                                                                     | Status         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Create      | Image → PDF, Text → PDF, CSV → PDF, Smart Scan → PDF                                                                                                      | Ready / Beta   |
| Organize    | Merge, Split, Compress, Manage pages (reorder / rotate / delete / duplicate / blank / extract)                                                            | Ready          |
| Edit        | Watermark, Page numbers, Flatten, Crop, Add text & stamp, fill forms                                                                                      | Ready / Beta   |
| View        | PDF (night mode, zoom), images, text, CSV table                                                                                                           | Ready          |
| View Office | Word/Excel rendered locally on web; PowerPoint prefers server-to-PDF rendering and falls back to a sanitized text-only outline; native uses server-to-PDF | Ready / Server |
| OCR         | Extract text from images & PDFs (web)                                                                                                                     | Beta (web)     |
| Convert     | DOCX/PPTX/XLSX → PDF, PDF → DOCX/XLSX/PPTX/HTML, Batch Convert, Searchable PDF                                                                            | Server         |
| Security    | Lock, Unlock, Permissions, Repair                                                                                                                         | Server         |
| Files       | Library, folders, favorites, trash, sort, grid/list, rename, duplicate, share                                                                             | Ready          |

Fill Forms supports text, checkbox, date, initials, and signature overlays and
exports the completed PDF. Drawing, highlighting, and freehand redaction remain
beta workflows and are labeled accordingly.

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
  config.ts            Validated runtime configuration and CORS origin policy
  middleware.ts        Request IDs, upload limits, secure headers, logs, errors, metrics
  observability.ts     Structured Pino logs and optional Sentry reporting
  start.ts             Node listener kept separate from the testable Hono app
```

Platform differences are handled with Metro's `.web.ts` / `.ts` resolution:
storage uses **IndexedDB** on web and **expo-file-system** on native; PDF
rasterization and OCR use **pdf.js / tesseract.js** on web and the server on
device.

### Tech

Expo SDK 56 · React 19 · React Native 0.85 · Expo Router · TypeScript ·
pdf-lib · pdf.js · tesseract.js · zustand · Hono.

### Operations and observability

The server exposes `GET /health` for capability/readiness checks and `GET
/metrics` in Prometheus text format for request counts, failures, and duration.
Every response receives an `X-Request-Id`. Production logs are structured JSON
from Pino, redact credentials, and omit URL query strings; setting `SENTRY_DSN`
enables unhandled-error reporting. CORS is restricted through `CORS_ORIGINS`,
uploads are capped by `FILEMINT_MAX_UPLOAD_BYTES`,
and standard security headers are enabled centrally. Heavy public conversion
routes also enforce a bounded per-client request budget and a process-wide
concurrency ceiling before multipart parsing. Tune the documented
`FILEMINT_CONVERSION_*` variables for the host's CPU and memory; rejected
requests return `429` with `Retry-After`, and `/metrics` exposes rejection and
active-job counters. Forwarded client addresses are ignored unless
`FILEMINT_TRUST_PROXY=true`, which is safe only behind a proxy that overwrites
the forwarding headers.

### API reference

| Endpoint group               | Purpose                                           | Input / access                         |
| ---------------------------- | ------------------------------------------------- | -------------------------------------- |
| `GET /health`, `/metrics`    | Readiness, converter capabilities, and telemetry  | Public operational endpoints           |
| `POST /convert`              | Office/PDF conversion                             | Multipart file plus validated options  |
| `/image/*`, `/pdf/*`, `/ocr` | Normalize, render, extract text, and run OCR      | Multipart file plus validated options  |
| `/repair`, `/secure/*`       | Repair, lock, unlock, or set PDF permissions      | Multipart file plus validated options  |
| `POST /edit/redact`          | Permanently redact selected PDF regions           | Multipart file plus validated regions  |
| `/auth/*`                    | Register, verify, sign in, recovery, and profile  | Validated JSON; session where required |
| `/auth/stripe/webhook`       | Replay-resistant signed Stripe event delivery     | Verified webhook signature             |
| `/premium/*`, `/feedback`    | Checkout, entitlements, and product feedback      | Authenticated JSON                     |
| `/edit/*`, `/wopi/*`         | Temporary Collabora sessions and WOPI file access | Short-lived signed edit token          |

Request bodies are size-limited, JSON and multipart inputs are schema-validated,
and errors return a request ID without leaking secrets. The implementation and
route-level tests live under `server/`.

---

## Known limitations

- This branch intentionally targets Expo SDK 56. Expo Doctor currently notes an
  upstream Hermes memory regression in the SDK 56 line; the eventual SDK 57
  migration belongs in a dedicated, device-tested change rather than an
  unrelated dependency update.
- The Expo build-tool audit baseline currently contains four high-severity
  findings inherited through Metro's `image-size` dependency and zero critical
  findings. The isolated production server dependency graph has zero known
  vulnerabilities. `npm run audit` prevents the build-tool baseline from
  increasing while Dependabot watches for the compatible upstream fix.

- **Android in-app PDF preview** depends on the platform WebView; if a page
  doesn't render inline, use the viewer's **Share / Open** action to open it
  in an external viewer.
- **Native OCR** and **PDF → image/text** run in the web app or via the server
  (the heavy rasterizer isn't bundled for native in this build).
- The web PDF viewer renders with the browser's built-in PDF UI (zoom, search,
  print). PDF-to-image/text uses the locked same-origin PDF.js worker copied
  into the verified web build.
- Non-JPG/PNG images are converted to PNG via canvas on web; on native, use
  JPG/PNG (HEIC normalization is a planned enhancement).
