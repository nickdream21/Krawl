# AGENTS.md — Krawl (Gestor de Archivos)

## Commands

```bash
npm install        # install deps (always run after clone/pull)
npm run dev        # run in dev mode (DevTools open automatically)
npm start          # run normally
npm run build      # build all platforms
npm run build-win  # build Windows NSIS installer
npm run dist       # package without publishing
npm test           # no-op — no tests exist
```

No lint, typecheck, or format commands are configured. There is no TypeScript; all code is plain CommonJS JS.

## Architecture

Single-package Electron app. No monorepo, no bundler, no transpilation.

```
main.js            # Main process — ALL IPC handlers, indexing loop, auto-updater
preload.js         # contextBridge — exposes window.electronAPI to renderer
renderer/
  index.html       # Entire UI (single page)
  script.js        # Renderer event handlers; calls window.electronAPI.*
  styles.css
src/
  db/database.js   # sql.js (SQLite WASM) — persisted to %APPDATA%\Krawl\documentos.sqlite
  ocr/ocr-service.js  # tesseract.js + mupdf WASM — the active OCR pipeline
  drive/api.js     # Local filesystem scanner (name is misleading — NOT Google Drive)
  utils/           # doc-utils.js, pdf-parser.js, word-parser.js, excel-parser.js
```

**IPC pattern:** renderer calls `window.electronAPI.<method>()` → `ipcMain.handle(...)` → returns Promise. `contextIsolation: true`, `nodeIntegration: false` — renderer has no direct Node access.

## OCR Pipeline

1. PDFs with extractable text → `pdf-parse` directly
2. Scanned PDFs / images (text < 100 chars) → `mupdf` WASM renders pages → `tesseract.js` (spa+eng)
3. Images (.jpg/.jpeg/.png) → always tesseract.js
4. Word/Excel → `mammoth` / `xlsx` natively

`ocr_engine.py`, `build_python.py`, `ocr_engine.spec` are **legacy PyInstaller artifacts** — not used at runtime.

## Database

- `sql.js` SQLite WASM running in the main process; saved to `%APPDATA%\Krawl\documentos.sqlite`
- FTS4 virtual table (`documentos_fts`, `tokenize=unicode61`) kept in sync by triggers
- On first run, auto-migrates from old LowDB JSON and old app-name path (`Gestor-Documentos-Sullana` → `Krawl`)

## Non-obvious Quirks

- **`src/drive/api.js`** scans local filesystem, not Google Drive. Contains a hardcoded Google Drive shortcut path from the original deployment environment — irrelevant for new installs. UI folder-selection dialogs bypass it entirely.
- **`mupdf`** is the only ESM package; loaded via dynamic `await import('mupdf')` in main process.
- **`*.traineddata` files are gitignored** — Tesseract.js downloads them automatically if missing.
- **`data/` is gitignored** — bundled as `extraResources` in packaged builds; must be managed manually.
- **`installer.iss`** is an Inno Setup script for an alternative Windows installer built from `portable-build\Krawl-win32-x64\`. Separate from electron-builder; requires Inno Setup installed.
- **Per-document OCR timeout:** 2 minutes (hardcoded `Promise.race` in `main.js`).
- **Auto-update** is disabled in dev mode (`!app.isPackaged` guard) — uses `electron-updater` publishing to `nickdream21/Krawl` GitHub Releases.
- **Error log:** uncaught exceptions written to `%APPDATA%\Krawl\krawl-error.log`.
- **Subject detection** (`detectarAsunto`) is tuned for Peruvian formal Spanish documents — looks for `ASUNTO:`, `SUMILLA:`, `ALCANZA:`, `REFERENCIA:` markers.

## Gitignored / Generated

`node_modules/`, `dist/`, `build/`, `portable-build/`, `*.traineddata`, `*.sqlite`, `data/`, `*.log`, `*.zip`
