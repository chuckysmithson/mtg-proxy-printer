/**
 * electron.cjs — MTG Proxy Printer
 * =============================================================================
 * Main Electron process. This file runs in Node.js (NOT in the browser).
 * It is responsible for:
 *
 *   1. Creating and managing the main application BrowserWindow
 *   2. Handling IPC (Inter-Process Communication) messages from the renderer
 *      - 'scrape-manabox' : loads a Manabox deck URL in a hidden browser and
 *                           extracts card data from the rendered DOM
 *      - 'print-to-pdf'   : receives image URLs and layout data, fetches images
 *                           via Axios, and generates a print-ready PDF using
 *                           PDFKit at exact physical card dimensions
 *   3. Opening the saved PDF automatically via the OS shell
 *
 * Architecture note:
 *   Electron enforces a security boundary between this main process and the
 *   browser-based renderer process (React/Vite). Communication happens via
 *   ipcMain.handle() here and ipcRenderer.invoke() in preload.cjs.
 *   The renderer never has direct access to Node.js APIs.
 *
 * Created by Charles Smithson, with AI assistance from Claude (Anthropic).
 * =============================================================================
 */

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─── Logging prefix helper ────────────────────────────────────────────────────
// All console output is prefixed with a tag so log lines are easy to grep.
const log  = (...args) => console.log ('[MTG-MAIN]', ...args);
const warn = (...args) => console.warn ('[MTG-WARN]', ...args);
const err  = (...args) => console.error('[MTG-ERR] ', ...args);

log('Process starting. Node version:', process.version, '| Electron:', process.versions.electron);
log('App data path:', app.getPath('userData'));
log('Platform:', process.platform, '| Arch:', process.arch);

// ─── Preload script path ──────────────────────────────────────────────────────
// The preload script runs in the renderer context but has access to Node APIs.
// It acts as the secure bridge between the renderer and this main process.
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs');
log('Preload script path:', PRELOAD_PATH);

if (!fs.existsSync(PRELOAD_PATH)) {
  err('CRITICAL: preload.cjs not found at', PRELOAD_PATH);
  err('The app will not be able to communicate with the renderer process.');
}

// ─── Manabox page parsing constants ──────────────────────────────────────────
/**
 * SECTION_HEADERS
 * These strings appear in Manabox's rendered page text as section dividers
 * (e.g. "Commander", "Creatures", "Lands"). When the scraper encounters one,
 * it knows a new card group is starting and skips the line and the total count
 * that follows it.
 */
const SECTION_HEADERS = new Set([
  'commander', 'creatures', 'creature', 'instants', 'instant',
  'sorceries', 'sorcery', 'enchantments', 'enchantment',
  'artifacts', 'artifact', 'planeswalkers', 'planeswalker',
  'lands', 'land', 'battles', 'battle',
  'sideboard', 'maybeboard', 'companion',
  'other spells', 'spells', 'tokens',
  'modal double faced cards',
]);

/**
 * UI_NOISE
 * Non-card strings that appear in Manabox's innerText due to navigation,
 * pricing, buttons, format labels, etc. These must be filtered out to avoid
 * false positives during card name parsing.
 */
const UI_NOISE = new Set([
  'manabox', 'get the app', 'buy', 'download', 'sort by', 'group by',
  'view mode', 'list', 'name', 'type', 'account', 'login', 'sign in',
  'sign up', 'profile', 'settings', 'logout', 'back', 'share',
  'export', 'import', 'edit', 'delete', '100 cards', 'cards', 'tix',
  'price', 'cost', 'format', 'standard', 'modern', 'legacy', 'vintage',
  'pioneer', 'historic', 'explorer', 'alchemy', 'brawl', 'pauper',
  'penny', 'duel', 'oldschool', 'premodern',
]);

// =============================================================================
// APP READY — all IPC handlers and windows are created inside this callback.
// Electron requires that BrowserWindow instances are only created after the
// app 'ready' event has fired.
// =============================================================================
app.whenReady().then(() => {
  log('app.whenReady() fired. Electron is ready.');

  // ─── Create main window ─────────────────────────────────────────────────
  /**
   * createWindow()
   * Instantiates the primary application window. In development mode
   * (NODE_ENV=development), the window loads the Vite dev server URL so that
   * Hot Module Replacement (HMR) is available. In production it loads the
   * built index.html from the dist/ folder.
   */
  function createWindow() {
    log('Creating main BrowserWindow (1100×820)...');

    const win = new BrowserWindow({
      width:  1100,
      height: 820,
      webPreferences: {
        contextIsolation: true,   // Enforces security boundary between renderer and Node
        webSecurity:      false,  // Allows loading Scryfall images cross-origin in renderer
        preload:          PRELOAD_PATH,
      },
      title:           'MTG Proxy Printer',
      autoHideMenuBar: true,      // Hides the default Electron menu bar for cleaner UX
    });

    const isDev = process.env.NODE_ENV === 'development';
    log('Running in', isDev ? 'DEVELOPMENT' : 'PRODUCTION', 'mode.');

    if (isDev) {
      const devUrl = 'http://localhost:5173';
      log('Loading dev server URL:', devUrl);
      win.loadURL(devUrl);
    } else {
      const prodPath = path.join(__dirname, 'dist', 'index.html');
      log('Loading production build:', prodPath);
      if (!fs.existsSync(prodPath)) {
        err('Production build not found at', prodPath, '— run: npm run electron:build');
      }
      win.loadFile(prodPath);
    }

    win.on('closed', () => log('Main window closed.'));
    log('Main window created successfully.');
    return win;
  }

  createWindow();

  // ─── IPC: scrape-manabox ──────────────────────────────────────────────────
  /**
   * Handler: 'scrape-manabox'
   *
   * Called by the renderer when the user submits a Manabox deck URL.
   *
   * Why a hidden BrowserWindow?
   *   Manabox is an Astro SSR application. The card data is NOT present in the
   *   raw HTML response — it is injected into the DOM by client-side JavaScript
   *   after page load. A simple fetch() or HTTP request would return an empty
   *   shell. By loading the URL in a real Chromium BrowserWindow, we let all
   *   JavaScript execute and the DOM fully hydrate before reading it.
   *
   * Parsing strategy:
   *   After a 5-second wait (for JS hydration), we read document.body.innerText.
   *   This gives us the visible text of the page as a flat string. We split it
   *   into lines and walk through them with a state machine:
   *     - Skip blank lines and UI noise
   *     - Detect section headers (Commander, Creatures, etc.)
   *     - Skip the section total count that follows a header
   *     - Parse quantity + card name pairs (a bare integer followed by a name)
   *     - Validate each pair to filter out false positives
   *
   * @param {Electron.IpcMainInvokeEvent} event - IPC event (unused)
   * @param {string} url - The Manabox deck URL to scrape
   * @returns {string} JSON string with shape:
   *   { source: 'dom', data: Array<{name: string, quantity: number}> }
   *   or on failure:
   *   { source: 'error', message: string }
   */
  ipcMain.handle('scrape-manabox', async (event, url) => {
    log('IPC scrape-manabox received. URL:', url);

    const scraper = new BrowserWindow({
      show: false, // Hidden — user never sees this window
      webPreferences: {
        contextIsolation: true,
        webSecurity:      false,
      },
    });

    try {
      log('Loading Manabox URL in hidden scraper window...');
      await scraper.loadURL(url, {
        // Spoof a real Chrome user agent to avoid bot detection or stripped responses
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                   'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                   'Chrome/124.0.0.0 Safari/537.36',
      });

      // Wait for Manabox's client-side JavaScript to fully render the card list.
      // 5 seconds is conservative — typical hydration takes 1–3 seconds.
      log('Page loaded. Waiting 5s for JavaScript hydration...');
      await new Promise(r => setTimeout(r, 5000));

      // Extract all visible text from the page body
      log('Extracting document.body.innerText from rendered DOM...');
      const text = await scraper.webContents.executeJavaScript(
        `document.body.innerText`
      );

      if (!text || text.trim().length === 0) {
        warn('innerText was empty. Page may have failed to load or render.');
        return JSON.stringify({
          source:  'error',
          message: 'Page loaded but returned no text. The deck may be private.',
        });
      }

      log(`Extracted ${text.length} characters of page text. Beginning parse...`);

      // Split into trimmed, non-empty lines
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      log(`Split into ${lines.length} non-empty lines.`);

      const cards = {}; // { cardName: totalQuantity }

      // Find the first section header — this marks where the card list begins.
      // Everything before it is page chrome (nav, deck title, metadata).
      let startIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (SECTION_HEADERS.has(lines[i].toLowerCase())) {
          startIdx = i;
          break;
        }
      }

      if (startIdx === -1) {
        warn('Could not find any section header in page text.');
        warn('First 20 lines were:', lines.slice(0, 20));
        return JSON.stringify({
          source:  'error',
          message: 'Could not find the start of the card list. ' +
                   'The page structure may have changed, or the deck may be empty. ' +
                   'Try exporting from Manabox as text and using the Deck List tab.',
        });
      }

      log(`Card list starts at line ${startIdx}: "${lines[startIdx]}"`);

      // Walk the lines from the first section header onward
      let i = startIdx;
      let linesProcessed = 0;
      let cardsParsed    = 0;

      while (i < lines.length) {
        const line      = lines[i];
        const lineLower = line.toLowerCase();

        // Skip section headers and the total count line that follows them
        if (SECTION_HEADERS.has(lineLower)) {
          log(`  [section] "${line}"`);
          i++;
          // The next line after a section header is often the section's total card count
          if (i < lines.length && /^\d+$/.test(lines[i])) {
            log(`  [section total] "${lines[i]}" — skipping`);
            i++;
          }
          continue;
        }

        // Skip known UI noise strings
        if (UI_NOISE.has(lineLower)) {
          i++; continue;
        }

        // Skip price strings ($1.23, €0.50)
        if (/^\$/.test(line) || /^€/.test(line)) {
          i++; continue;
        }

        // Skip TIX (Magic Online currency) values
        if (/^TIX/i.test(line)) {
          i++; continue;
        }

        // Skip date strings (MM/DD/YYYY)
        if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(line)) {
          i++; continue;
        }

        // Skip "N cards" total summary lines
        if (/^\d+ cards?$/i.test(line)) {
          i++; continue;
        }

        // Attempt to parse a quantity + card name pair.
        // Pattern: a bare integer (1–99) followed immediately by the card name on the next line.
        if (/^\d+$/.test(line) && i + 1 < lines.length) {
          const qty      = parseInt(line, 10);
          const name     = lines[i + 1];
          const nameLower = name.toLowerCase();

          // Validate: qty must be sane, name must look like a card name
          const isValid =
            qty >= 1 && qty <= 99 &&
            name.length >= 2 &&
            /[a-zA-Z]/.test(name) &&           // Must contain at least one letter
            !/^\d+$/.test(name) &&             // Name can't be a pure number
            !/^\$/.test(name) &&               // Name can't be a price
            !/^€/.test(name) &&
            !/^TIX/i.test(name) &&
            !/^\d+ cards?$/i.test(name) &&
            !SECTION_HEADERS.has(nameLower) &&
            !UI_NOISE.has(nameLower);

          if (isValid) {
            cards[name] = (cards[name] || 0) + qty;
            log(`  [card] ${qty}x "${name}"`);
            cardsParsed++;
            i += 2; // Consume both the quantity line and the name line
            continue;
          } else {
            log(`  [skip] qty=${qty} name="${name}" — failed validation`);
          }
        }

        i++;
        linesProcessed++;
      }

      const result = Object.entries(cards).map(([name, quantity]) => ({ name, quantity }));
      log(`Parse complete. ${cardsParsed} card entries parsed. ${result.length} unique cards.`);

      if (result.length === 0) {
        warn('No valid cards found after parsing. Dumping first 40 lines for debugging:');
        lines.slice(0, 40).forEach((l, idx) => warn(`  [${idx}] ${l}`));
        return JSON.stringify({
          source:  'error',
          message: 'The page loaded but no cards could be parsed from it. ' +
                   'The deck may be empty, or the page structure may have changed. ' +
                   'Try the Deck List tab instead.',
        });
      }

      // Log the full parsed card list for debugging
      log('Final card list:');
      result.forEach(c => log(`  ${c.quantity}x ${c.name}`));

      return JSON.stringify({ source: 'dom', data: result });

    } catch (e) {
      err('Exception in scrape-manabox handler:', e.message);
      err(e.stack);
      return JSON.stringify({
        source:  'error',
        message: `Scraper threw an exception: ${e.message}`,
      });
    } finally {
      // Always close the hidden scraper window, even if an error occurred
      log('Closing hidden scraper window.');
      scraper.close();
    }
  });

  // ─── IPC: print-to-pdf ────────────────────────────────────────────────────
  /**
   * Handler: 'print-to-pdf'
   *
   * Generates a print-ready PDF from the card data sent by the renderer.
   *
   * Why PDFKit instead of Chromium's printToPDF?
   *   Electron's webContents.printToPDF() applies an unpredictable internal
   *   scale factor that consistently produces cards smaller than 2.5 × 3.5
   *   inches, regardless of CSS dimensions, scale parameters, or DPI hints.
   *   PDFKit writes PDF coordinate values directly in points (1in = 72pt),
   *   bypassing any rendering pipeline. The result is always exactly the
   *   physical size specified.
   *
   * Layout math:
   *   Page:   8.5in × 11in  →  612pt × 792pt
   *   Card:   2.5in × 3.5in →  180pt × 252pt
   *   3 cards × 180pt = 540pt total card width
   *   Horizontal margin: (612 - 540) / 2 = 36pt on each side
   *   3 cards × 252pt = 756pt total card height
   *   Vertical margin:   (792 - 756) / 2 = 18pt on each side
   *
   * Image pipeline:
   *   1. De-duplicate all image URLs across all pages
   *   2. Fetch all unique images concurrently via Axios (arraybuffer)
   *   3. Cache buffers in memory
   *   4. For each page, for each slot: clip to rounded rect, draw image buffer
   *
   * @param {Electron.IpcMainInvokeEvent} event - IPC event (unused)
   * @param {Object} payload
   * @param {Array<Array<string|null>>} payload.pages - Array of pages, each page
   *   is an array of 9 image URL strings (or null for empty slots).
   *   Front and back pages are already interleaved by the renderer.
   * @param {number} payload.cutPx - Gap in points between card slots (cut lines).
   *   0 = no lines, 0.5 = hair, 1 = thin, 2 = medium, 4 = thick.
   * @returns {{ success: boolean, path?: string }}
   */
  ipcMain.handle('print-to-pdf', async (event, payload) => {
    log('IPC print-to-pdf received.');
    log(`  Pages: ${payload.pages.length}`);
    log(`  Cut line thickness: ${payload.cutPx}pt`);

    // Lazy-require PDFKit and Axios — only needed when printing
    const PDFDocument = require('pdfkit');
    const axios       = require('axios');

    // ── Physical dimensions in PDF points (1in = 72pt) ──────────────────────
    const PAGE_W   = 8.5  * 72;   // 612pt
    const PAGE_H   = 11   * 72;   // 792pt
    const CARD_W   = 2.5  * 72;   // 180pt
    const CARD_H   = 3.5  * 72;   // 252pt
    const RADIUS   = Math.round(0.118 * 72); // ~8.5pt corner radius (standard MTG card)
    const GAP      = payload.cutPx || 0;

    // Center the 3×3 grid on the page
    const GRID_W   = CARD_W * 3 + GAP * 2;
    const GRID_H   = CARD_H * 3 + GAP * 2;
    const MARGIN_X = (PAGE_W - GRID_W) / 2;
    const MARGIN_Y = (PAGE_H - GRID_H) / 2;

    log(`  Page: ${PAGE_W}pt × ${PAGE_H}pt`);
    log(`  Card: ${CARD_W}pt × ${CARD_H}pt`);
    log(`  Grid: ${GRID_W}pt × ${GRID_H}pt (gap: ${GAP}pt)`);
    log(`  Margins: x=${MARGIN_X.toFixed(1)}pt, y=${MARGIN_Y.toFixed(1)}pt`);

    // ── Collect and de-duplicate all image URLs ──────────────────────────────
    const urlSet = new Set();
    for (const page of payload.pages) {
      for (const src of page) {
        if (src) urlSet.add(src);
      }
    }
    log(`  Unique image URLs to fetch: ${urlSet.size}`);

    // ── Fetch all images concurrently ────────────────────────────────────────
    log('  Fetching images concurrently via Axios...');
    const imgCache = {};
    let fetchSuccess = 0;
    let fetchFail    = 0;

    await Promise.all([...urlSet].map(async (url) => {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout:      20000, // 20 second timeout per image
          headers: {
            // Scryfall requires a reasonable user agent for CDN requests
            'User-Agent': 'MTGProxyPrinter/1.0 (+https://github.com/yourname/mtg-proxy-printer)',
          },
        });
        imgCache[url] = Buffer.from(response.data);
        fetchSuccess++;
      } catch (e) {
        warn(`  Failed to fetch image: ${url.substring(0, 80)}... — ${e.message}`);
        fetchFail++;
      }
    }));

    log(`  Image fetch complete. Success: ${fetchSuccess}, Failed: ${fetchFail}`);

    // ── Show save dialog ─────────────────────────────────────────────────────
    log('  Showing save dialog...');
    const { filePath } = await dialog.showSaveDialog({
      title:       'Save Proxy PDF',
      defaultPath: path.join(os.homedir(), 'Downloads', 'MTGPxy.pdf'),
      filters:     [{ name: 'PDF Files', extensions: ['pdf'] }],
    });

    if (!filePath) {
      log('  Save dialog cancelled by user.');
      return { success: false };
    }

    log('  Save path selected:', filePath);

    // ── Build PDF with PDFKit ─────────────────────────────────────────────────
    log('  Building PDF document...');
    const doc         = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    let pageNum = 0;
    for (const page of payload.pages) {
      pageNum++;
      doc.addPage();
      log(`  Rendering page ${pageNum}/${payload.pages.length}...`);

      let slotsDrawn = 0;
      let slotsEmpty = 0;

      for (let idx = 0; idx < 9; idx++) {
        const col = idx % 3;
        const row = Math.floor(idx / 3);

        // Calculate the top-left corner of this card slot in PDF points
        const x = MARGIN_X + col * (CARD_W + GAP);
        const y = MARGIN_Y + row * (CARD_H + GAP);

        const src = page[idx];

        if (src && imgCache[src]) {
          // Clip drawing area to a rounded rectangle matching MTG card corner radius
          doc.save();
          doc.roundedRect(x, y, CARD_W, CARD_H, RADIUS).clip();
          doc.image(imgCache[src], x, y, { width: CARD_W, height: CARD_H });
          doc.restore();
          slotsDrawn++;
        } else {
          if (src) {
            warn(`  Slot ${idx} on page ${pageNum}: image not cached (fetch failed), leaving blank.`);
          }
          slotsEmpty++;
        }
      }

      log(`  Page ${pageNum}: ${slotsDrawn} cards drawn, ${slotsEmpty} empty slots.`);
    }

    doc.end();
    log('  PDFKit doc.end() called. Waiting for write stream to finish...');

    // Wait for the file write to complete before opening it
    await new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        log('  Write stream finished.');
        resolve();
      });
      writeStream.on('error', (e) => {
        err('  Write stream error:', e.message);
        reject(e);
      });
    });

    // Verify the file was actually written
    const stats = fs.statSync(filePath);
    log(`  PDF saved successfully. File size: ${(stats.size / 1024).toFixed(1)} KB`);
    log(`  Path: ${filePath}`);

    // Open the PDF in the user's default PDF viewer
    log('  Opening PDF with OS default application...');
    const { shell } = require('electron');
    await shell.openPath(filePath);

    return { success: true, path: filePath };
  });

  log('All IPC handlers registered. App is ready.');

}); // end app.whenReady()

// ─── Window lifecycle ──────────────────────────────────────────────────────────
/**
 * Quit the app when all windows are closed.
 * On macOS this is overridden by convention (apps stay open until Cmd+Q),
 * but for a Windows-first utility app, closing the window should quit.
 */
app.on('window-all-closed', () => {
  log('All windows closed. Quitting application.');
  app.quit();
});

app.on('will-quit', () => {
  log('app will-quit event fired. Cleaning up...');
});

process.on('uncaughtException', (e) => {
  err('Uncaught exception in main process:', e.message);
  err(e.stack);
});
