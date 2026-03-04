# MTG Proxy Printer

**Created by Charles Smithson**, with AI assistance from [Claude](https://claude.ai) (Anthropic).

A desktop application for Magic: The Gathering players who want to print high-quality proxy cards at home. Import a deck from Manabox or paste a plain-text deck list, browse every printing of each card via the Scryfall API, choose your preferred art, and export a print-ready PDF at true card size (2.5 × 3.5 inches). Supports duplex (two-sided) printing with automatic page mirroring, and handles double-faced cards (DFC) by printing the back face on the reverse side.

---

## Table of Contents

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Running in Development](#running-in-development)
7. [Building for Production](#building-for-production)
8. [How It Works](#how-it-works)
9. [PDF Generation](#pdf-generation)
10. [Duplex Printing Guide](#duplex-printing-guide)
11. [Manabox Scraping](#manabox-scraping)
12. [Art Memory System](#art-memory-system)
13. [Card List Editor](#card-list-editor)
14. [Known Limitations](#known-limitations)
15. [Scryfall API Usage](#scryfall-api-usage)
16. [License](#license)

---

## Features

- **Manabox URL import** — paste a public Manabox deck link and the app scrapes the full card list using a hidden Electron browser window that fully renders the JavaScript-heavy page.
- **Plain-text deck list import** — supports standard MTGO/Arena export format (`4 Lightning Bolt`, `4x Lightning Bolt`, `4 Lightning Bolt (M11) 149`, etc.).
- **Full art selection** — fetches every printing of each card from Scryfall, sorted newest-first, and lets you choose the art you want per card.
- **Art memory** — when you update your card list, previously selected art choices are remembered and restored instantly without re-fetching from Scryfall.
- **Hover preview** — hovering over a card tile shows a large preview image near your cursor. Double-faced cards preview both faces side by side.
- **True-size PDF output** — cards print at exactly 2.5 × 3.5 inches using PDFKit for pixel-perfect rendering, bypassing browser scaling entirely.
- **Duplex printing** — generates interleaved front/back pages with horizontally mirrored columns for correct long-edge flip alignment.
- **Double-faced card support** — DFC back faces automatically appear on back pages. Non-DFC slots on back pages are left blank.
- **Adjustable cut lines** — choose None, Hair (0.5px), Thin (1px), Medium (2px), or Thick (4px) white gaps between cards.
- **Card list editor** — expand a collapsible editor below the print button to add, remove, or adjust quantities without starting over.
- **Export deck list** — copy the current list to clipboard or save it as a `.txt` file in standard deck list format.
- **Ominous loading phrases** — 90+ rotating flavor phrases cycle during loading to keep the experience fun and on-theme.

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Desktop shell** | [Electron](https://www.electronjs.org/) | ^28.x | Native desktop window, file system access, PDF save dialog |
| **Frontend framework** | [React](https://react.dev/) | ^18.x | UI component tree, state management |
| **Build tool** | [Vite](https://vitejs.dev/) | ^5.x | Dev server, hot module replacement, production bundling |
| **PDF generation** | [PDFKit](https://pdfkit.org/) | ^0.15.x | Programmatic PDF creation at exact physical dimensions |
| **HTTP client** | [Axios](https://axios-http.com/) | ^1.x | Fetching card images as binary buffers for PDF embedding |
| **Card data API** | [Scryfall API](https://scryfall.com/docs/api) | v2 | Card metadata, all printings, high-resolution art images |
| **Font loading** | [Google Fonts](https://fonts.google.com/) | — | Cinzel (headers), Crimson Pro (body text) |
| **Language** | JavaScript (ES2022) | — | All application logic |
| **Language** | JSX | — | React component markup |
| **Language** | CSS-in-JS | — | Scoped styles injected via `<style>` tag |
| **Runtime** | [Node.js](https://nodejs.org/) | ^20.x | Electron main process, build tooling |
| **Package manager** | [npm](https://www.npmjs.com/) | ^10.x | Dependency management |
| **Concurrency tool** | [concurrently](https://github.com/open-cli-tools/concurrently) | ^8.x | Runs Vite dev server and Electron simultaneously |
| **Wait utility** | [wait-on](https://github.com/jeffbski/wait-on) | ^7.x | Waits for Vite to be ready before launching Electron |
| **Env utility** | [cross-env](https://github.com/kentcdodds/cross-env) | ^7.x | Cross-platform environment variable setting |
| **Installer** | [electron-builder](https://www.electron.build/) | ^24.x | Packages app into a Windows NSIS installer |

---

## Project Structure

```
mtg-proxy-printer/
│
├── electron.cjs          # Electron main process (Node.js)
│                         #   - Creates the main BrowserWindow
│                         #   - IPC handler: scrape-manabox
│                         #   - IPC handler: print-to-pdf (PDFKit)
│
├── preload.cjs           # Electron preload script
│                         #   - Exposes safe IPC bridges to the renderer
│                         #   - window.electronAPI.scrapeManabox()
│                         #   - window.electronAPI.printToPDF()
│
├── vite.config.js        # Vite configuration
│                         #   - base: './' for Electron compatibility
│                         #   - port: 5173 (strictPort: true)
│
├── package.json          # Project metadata, scripts, dependencies
│
├── src/
│   ├── main.jsx          # React entry point — mounts <App /> into #root
│   └── App.jsx           # Main React component (entire frontend UI)
│
├── dist/                 # Vite production build output (generated)
├── release/              # electron-builder output — .exe installer (generated)
└── README.md             # This file
```

---

## Prerequisites

- **Node.js** v20 or higher — [nodejs.org](https://nodejs.org/)
- **npm** v10 or higher (comes with Node.js)
- **Windows** 10/11 (the app is built and tested on Windows; macOS/Linux should work in dev mode but the installer target is Windows NSIS)
- An internet connection (Scryfall API and Google Fonts are fetched at runtime)

---

## Installation

```bash
# 1. Clone or download the project
git clone https://github.com/yourname/mtg-proxy-printer.git
cd mtg-proxy-printer

# 2. Install all dependencies
npm install
```

This installs:
- Electron and electron-builder
- React and ReactDOM
- Vite and the Vite React plugin
- PDFKit and Axios
- concurrently, wait-on, cross-env

---

## Running in Development

```bash
npm run electron:dev
```

This command:
1. Starts the **Vite dev server** on `http://localhost:5173`
2. Waits for Vite to be ready (`wait-on`)
3. Launches **Electron** with `NODE_ENV=development`, which causes `electron.cjs` to load the Vite URL instead of the built `dist/` files

Hot module replacement (HMR) is active — changes to `App.jsx` reflect instantly in the Electron window without restarting.

---

## Building for Production

```bash
npm run electron:build
```

This command:
1. Runs `vite build` — bundles React into `dist/`
2. Runs `electron-builder` — packages everything into `release/MTG Proxy Printer Setup.exe`

The installer is a standard Windows NSIS installer. Users can install the app to `Program Files` and launch it from the Start Menu or desktop shortcut.

---

## How It Works

### High-Level Flow

```
User Input (URL or text)
        │
        ▼
  [fetchManabox] or [parseDeckText]
        │
        ▼
  Array of { name, quantity }
        │
        ▼
  [fetchPrintings] × N cards   ←── Scryfall API (85ms delay between calls)
        │
        ▼
  entries[] = { name, quantity, printings[], selectedIdx }
        │
        ▼
  Art Selection UI (card grid)
        │
        ▼
  User adjusts quantities / adds-removes cards (Card List Editor)
        │
        ▼
  [handlePrint] builds image URL arrays per page
        │
        ▼
  IPC → electron.cjs print-to-pdf handler
        │
        ▼
  PDFKit fetches images via Axios → draws to PDF
        │
        ▼
  dialog.showSaveDialog → writes file → shell.openPath
```

### IPC Architecture

Electron enforces a strict security boundary between the Node.js main process and the browser-based renderer process. Communication happens via Electron's `ipcMain` / `ipcRenderer` system:

```
Renderer (React)          Preload Script           Main Process (Node.js)
─────────────────         ──────────────           ──────────────────────
window.electronAPI   ──►  contextBridge       ──►  ipcMain.handle()
.scrapeManabox(url)        exposeInMainWorld        'scrape-manabox'
.printToPDF(payload)                                'print-to-pdf'
```

The preload script (`preload.cjs`) is the only script with access to both worlds. It uses `contextBridge.exposeInMainWorld` to safely expose specific functions to the renderer without granting it full Node.js access.

---

## PDF Generation

PDF generation is handled entirely in the Electron main process using **PDFKit**, a pure Node.js PDF library. This bypasses Chromium's `printToPDF` API entirely, which was found to apply unpredictable scaling factors that produced cards smaller than the target 2.5 × 3.5 inches regardless of CSS or scale settings.

### Why PDFKit?

PDF documents use **points** as their unit (`1 inch = 72 points`). PDFKit writes these values directly into the PDF binary — there is no browser, no viewport, no DPI scaling, and no CSS interpretation. The result is always exactly the requested physical size.

### Dimensions

| Measurement | Inches | Points (72/in) |
|---|---|---|
| Page width | 8.5 in | 612 pt |
| Page height | 11 in | 792 pt |
| Card width | 2.5 in | 180 pt |
| Card height | 3.5 in | 252 pt |
| Corner radius | 0.118 in | ~8.5 pt |
| Left/right margin | ~(612 − 180×3) / 2 | 126 pt |
| Top/bottom margin | ~(792 − 252×3) / 2 | 198 pt |

### Image Pipeline

1. The renderer builds a flat array of image URLs (one per page slot)
2. This is sent to the main process via IPC
3. The main process de-duplicates the URLs and fetches all unique images concurrently using `axios` (`responseType: 'arraybuffer'`)
4. Images are cached in memory by URL
5. PDFKit draws each image with `doc.image(buffer, x, y, { width, height })` inside a clipped rounded rectangle

### Cut Lines

Cut lines are implemented as a gap (`GAP` in points) between card slots. The page background is white, so gaps between cards appear as white lines. This is set by the `cutPx` value chosen in the UI (None/Hair/Thin/Medium/Thick).

---

## Duplex Printing Guide

### How Page Ordering Works

For a 9-card page, the front and back must be mirror images of each other so that when the paper is flipped on the long edge, each card's back aligns with its front.

**Front page layout** (left to right, top to bottom):
```
[0] [1] [2]
[3] [4] [5]
[6] [7] [8]
```

**Back page layout** (columns mirrored):
```
[2] [1] [0]
[5] [4] [3]
[8] [7] [6]
```

The back page index order used in code is: `[2, 1, 0, 5, 4, 3, 8, 7, 6]`

### Printer Settings

When printing the exported PDF:
- Select **Two-sided printing** (or **Duplex**)
- Flip on: **Long edge** (also called "Long-edge binding" or "Flip on long side")
- Print at: **Actual size** (100% — do not scale to fit)
- Margins: **None** (or as small as your printer allows)

### Double-Faced Cards (DFC)

- **Front pages**: always show face 0 (the front face)
- **Back pages**: DFC slots show face 1 (the back face); non-DFC slots are left **blank white**
- This means non-DFC card backs are plain white — use opaque sleeves, or add a card back image layer in your PDF editor if needed

---

## Manabox Scraping

Manabox is built with Astro (server-side rendered) and uses JavaScript to hydrate the card list on the client. Simple HTTP fetches of the page HTML do not contain card data. The scraper works around this by:

1. Opening a hidden `BrowserWindow` (no `show: true`)
2. Loading the Manabox URL with a realistic Chrome user agent string
3. Waiting 5 seconds for JavaScript hydration to complete
4. Calling `document.body.innerText` to extract all visible text
5. Parsing the text line-by-line using a state machine that:
   - Detects section headers (`Commander`, `Creatures`, `Lands`, etc.)
   - Skips section totals (bare numbers following headers)
   - Parses `quantity` + `card name` pairs
   - Filters out UI noise strings (prices, dates, button labels, format names)

If the scraper fails to find cards, it returns an error object and the UI displays a fallback message suggesting the user export from Manabox as text and use the Deck List tab instead.

---

## Art Memory System

When a user updates their card list (via the Card List Editor + "↺ UPDATE LIST"), the app avoids re-fetching Scryfall data for cards it has already loaded. Before re-running the import:

1. The current `entries[]` array is iterated to build an `artMemory` lookup object:
   ```js
   artMemory[cardName] = { printings: [...], selectedIdx: N }
   ```
2. For each card in the updated list, if `artMemory[name]` exists and has printings, those printings and the selected index are reused directly.
3. Only genuinely new cards (not in `artMemory`) trigger a Scryfall API fetch.

This means updating quantities or adding/removing a few cards is nearly instant — only the new cards require network requests.

---

## Card List Editor

The card list editor is a collapsible panel below the Save PDF button. It is collapsed by default to keep the UI clean.

### What you can do

- **Edit quantities** — change the number field on any row
- **Edit card names** — click the name field and type. Note: if you change a card name, it will not match the art memory and will trigger a fresh Scryfall lookup on the next Update
- **Remove a card** — click the ✕ button on any row
- **Add a card** — type a card name in the "Add a card…" field at the bottom and press Enter or click "+ Add"
- **Export list** — use "⎘ Copy to Clipboard" or "↓ Save as .txt" to export the current list in standard `4 Card Name` format

### Applying Changes

After editing the list, click **↺ UPDATE LIST** to re-run the import with the new list. Art selections for existing cards are preserved.

---

## Known Limitations

- **Manabox scraping** depends on Manabox's DOM structure. If Manabox significantly redesigns their page, the scraper may stop working. The Deck List tab is always available as a reliable fallback.
- **Card name accuracy** — Scryfall uses exact card names. Typos or alternate names (e.g., "Jace, the Mind Sculptor" vs "Jace the Mind Sculptor") will return no results and show as `NOT FOUND`.
- **Token cards** — tokens are not in the Scryfall default card search and will show as NOT FOUND.
- **Rate limiting** — the app enforces an 85ms delay between Scryfall API requests. Loading a 100-card deck takes approximately 8–10 seconds.
- **Image download time** — PDF generation fetches all card images. For large decks with many unique arts, this may take 30–60 seconds. A progress indicator is not currently shown during PDF generation.
- **Printer margins** — some printers have a minimum non-printable margin. If cards at the edges are cut off, try enabling "borderless" printing or adjusting the margin values in `buildDeckText` inside `electron.cjs`.

---

## Scryfall API Usage

This app uses the [Scryfall API](https://scryfall.com/docs/api) in accordance with their usage policy:

- All requests are made with a polite delay of **85ms** between calls (Scryfall requests at least 50–100ms)
- No authentication or API key is required
- The app does not cache data persistently — all data is fetched fresh each session
- Card image URLs are Scryfall CDN links and are fetched at print time only

Scryfall's card data is community-maintained. Please consider supporting them at [scryfall.com](https://scryfall.com).

---

## License

MIT License. Free to use, modify, and distribute. Not affiliated with Wizards of the Coast, Scryfall, or Manabox. Magic: The Gathering card images are property of Wizards of the Coast and are used for personal, non-commercial proxy printing purposes only.
