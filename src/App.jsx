/**
 * App.jsx — MTG Proxy Printer (Renderer Process)
 * =============================================================================
 * The entire React frontend lives in this single file. It runs inside
 * Electron's Chromium renderer process (a sandboxed browser context with no
 * direct Node.js access). Communication with the main process happens via
 * window.electronAPI, which is injected by preload.cjs through Electron's
 * contextBridge API.
 *
 * Application flow:
 *   1. INPUT step   — user submits a Manabox URL or pastes a deck list
 *   2. LOADING step — deck is fetched/parsed; Scryfall is queried per card
 *   3. SELECT step  — card grid with art dropdowns + print settings panel
 *
 * Key external dependencies (loaded at runtime, not bundled):
 *   - Scryfall API  : https://api.scryfall.com  (card metadata + art images)
 *   - Google Fonts  : Cinzel + Crimson Pro (imported via @import in CSS string)
 *
 * Created by Charles Smithson, with AI assistance from Claude (Anthropic).
 * =============================================================================
 */

import { useState, useCallback, useEffect } from "react";

// ─── Runtime constants ────────────────────────────────────────────────────────

/** Base URL for the Scryfall REST API. No authentication required. */
const SCRYFALL = "https://api.scryfall.com";

/**
 * Fallback image shown when a card's art cannot be loaded.
 * This is the standard Magic: The Gathering card back from Wikimedia Commons.
 */
const CARD_BACK = "https://upload.wikimedia.org/wikipedia/en/a/aa/Magic_the_Gathering-card_back.jpg";

/**
 * Async sleep helper.
 * Used to enforce polite rate-limiting between Scryfall API requests.
 * Scryfall recommends at least 50–100ms between requests.
 * @param {number} ms - Milliseconds to wait
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Ominous loading phrases ──────────────────────────────────────────────────
/**
 * PHRASES
 * An array of 90+ flavor-themed phrases displayed during the loading screen.
 * They cycle randomly every 4.5 seconds using a setInterval in a useEffect.
 * The intent is to entertain the user while Scryfall is being queried
 * (which can take 8–15 seconds for a full deck).
 */
const PHRASES = [
  "Deciphering the Forbidden Tome…",
  "Unraveling Ancient Mysteries…",
  "Consulting the Elder Dragons…",
  "Rifling Through the Blind Eternities…",
  "Negotiating With a Demon…",
  "Peering Beyond the Veil…",
  "Awakening Long-Dormant Spirits…",
  "Sifting Through Ashes of the Burned Library…",
  "Bargaining With the Raven Man…",
  "Tracing Mana Lines Across the Multiverse…",
  "Invoking the Will of the Guildpact…",
  "Aligning the Three Suns of Mirrodin…",
  "Communing With the Ur-Dragon…",
  "Translating the Phyrexian Scriptures…",
  "Traversing the Æther Rifts…",
  "Divining From the Pool of Knowledge…",
  "Unsealing the Vault of the Antiquities…",
  "Bribing a Faerie Spy for Information…",
  "Slipping Through the Shadows of Duskmourn…",
  "Weaving Forbidden Mana Threads…",
  "Consulting the Oracle of Mul Daya…",
  "Untapping Leylines of the Ancient World…",
  "Binding Elemental Forces to Your Will…",
  "Interrogating a Merfolk Lorekeeper…",
  "Cataloging the Grimoire of Urza…",
  "Whispering to the Mycosynth Lattice…",
  "Tapping Into the Heart of Serra's Realm…",
  "Cross-Referencing the Thran Tombs…",
  "Channeling the Nether Void…",
  "Awakening the Eldrazi Titan's Memory…",
  "Forging a Pact With the Moonfolk…",
  "Meditating in the Eye of the Storm…",
  "Reading the Stars Over Kamigawa…",
  "Rummaging Through Tolarian Archives…",
  "Following the Breadcrumbs of a Planeswalker…",
  "Unburying Forgotten Knowledge From Innistrad's Graves…",
  "Decoding Sphinxian Riddles…",
  "Leafing Through the Pages of the Necronomicon…",
  "Reassembling the Shattered Lens…",
  "Piecing Together Shreds of the Great Helvault…",
  "Consulting the Myojin of Seeing Winds…",
  "Parsing the Runes Left by Jodah the Archmage…",
  "Summoning a Council of Demons for Deliberation…",
  "Studying the Etchings of the Theros Underworld…",
  "Observing the Patterns of the Constellation…",
  "Listening to the Song of the Sylvok…",
  "Persuading the Relic Seeker to Share Their Secrets…",
  "Unearthing Relics From the Shard of Alara…",
  "Tuning the Resonance of the Orrery…",
  "Counting the Rings of the World Tree…",
  "Stealing a Glance at Liliana's Contract…",
  "Eavesdropping on a Conclave Meeting…",
  "Calculating the Probability of Catastrophe…",
  "Navigating the Maze of Ith…",
  "Decrypting the Signal of the Vanishing…",
  "Reading Between the Lines of the Litany of the Guildless…",
  "Appeasing the Realm-Cloaked Giant…",
  "Scrying From the Pools of Yavimaya…",
  "Retracing the Steps of the Wanderer…",
  "Cataloging Every Sin of the Obzedat…",
  "Bargaining With the Prince of Thralls…",
  "Following the Merfolk Migration Routes…",
  "Mapping the Lost Caverns of Ixalan…",
  "Surveying the Ruins of Empires Long Fallen…",
  "Heeding the Whispers of the Swamp…",
  "Attuning to the Pulse of New Phyrexia…",
  "Recruiting an Army of the Restless Dead…",
  "Consulting the Tome of the Infinite…",
  "Searching the Vaults of Azor…",
  "Watching the Threads of Fate Converge…",
  "Petitioning the Court of Locthwain…",
  "Scouring the Sands of Amonkhet…",
  "Examining the Final Prophecy Scroll…",
  "Pleading With the Arbiter of Law…",
  "Tracing the Wake Left by Emrakul…",
  "Cross-Referencing the Akroan War Records…",
  "Decoding the Last Transmission from Mirrodin…",
  "Parsing the Words of the Spreading Seas…",
  "Weaving Through Layers of History and Legend…",
  "Draining the Last Swamp for Secrets…",
  "Opening the Seventh Seal of the Library…",
  "Extracting Knowledge From the Collective…",
  "Processing the Vision of the Blind Seer…",
  "Interpreting the Dreams of a Sleeping God…",
  "Unearthing the Darksteel Colossus's Memory…",
  "Counting the Fallen at the Bone Mill…",
  "Tracing the Bloodlines of the Vampire Houses…",
  "Searching the Wilderness for a Missing Planeswalker…",
  "Bowing Before the Kenrith Throne for Passage…",
  "Bartering With a Goblin Arsonist for a Map…",
  "Cracking Open the Urn of the Lost Souls…",
  "Asking the Sphinx a Question It Won't Answer…",
  "Convincing a Dragon to Part With Its Hoard…",
  "Flipping Through a Grimoire Written in Blood…",
];

/**
 * getPhrase()
 * Returns a random phrase from the PHRASES array.
 * Called on first load and then every 4.5 seconds during the loading step.
 * @returns {string}
 */
function getPhrase() {
  return PHRASES[Math.floor(Math.random() * PHRASES.length)];
}

// ─── Cut line configuration ───────────────────────────────────────────────────
/**
 * CUT_OPTIONS
 * Maps user-facing labels to pixel gap values used in PDF generation.
 * These values are sent directly to the main process as PDFKit point values.
 * 0.5pt ≈ a barely-visible hairline at standard print resolution.
 */
const CUT_OPTIONS = [
  { label: "None",   value: 0   },
  { label: "Hair",   value: 0.5 },
  { label: "Thin",   value: 1   },
  { label: "Medium", value: 2   },
  { label: "Thick",  value: 4   },
];

// ─── Pure helper functions ────────────────────────────────────────────────────

/**
 * parseDeckText(raw)
 * Parses a plain-text deck list into an array of { name, quantity } objects.
 *
 * Supported formats:
 *   "4 Lightning Bolt"
 *   "4x Lightning Bolt"
 *   "4 Lightning Bolt (M11) 149"
 *   "4 Lightning Bolt (M11) 149 *F*"   (foil marker stripped)
 *
 * Lines that are blank, start with # or /, or are section headers
 * (Deck, Sideboard, Commander, etc.) are skipped.
 * Duplicate card names across lines are summed.
 *
 * @param {string} raw - Raw text from the textarea input
 * @returns {Array<{name: string, quantity: number}>}
 */
function parseDeckText(raw) {
  const acc = {}; // accumulator: { cardName: totalQty }

  for (const line of raw.split("\n")) {
    const t = line.trim();

    // Skip blank lines and comment lines
    if (!t || /^[/#]/.test(t)) continue;

    // Skip bare section header words
    if (/^(deck|sideboard|commander|maybeboard|companion|lands?)$/i.test(t)) continue;

    // Match the quantity and name, optionally followed by set code + collector number
    const m = t.match(/^(\d+)x?\s+(.+?)(?:\s+\([A-Z0-9]{1,6}\)(?:\s+[\w*]+)?)?$/i);
    if (m) {
      // Strip foil markers like *F* or *E* from the end of the name
      const name = m[2].trim().replace(/\s+\*[A-Z]\*$/, "");
      acc[name] = (acc[name] || 0) + parseInt(m[1], 10);
    }
  }

  return Object.entries(acc).map(([name, quantity]) => ({ name, quantity }));
}

/**
 * fetchManabox(url)
 * Triggers the Electron main process to scrape a Manabox deck URL.
 * The main process loads the URL in a hidden BrowserWindow, waits for
 * JavaScript hydration, then extracts and parses the card list from the DOM.
 *
 * Falls back with a clear error message if the Electron API is not available
 * (e.g. running in a plain browser during development).
 *
 * @param {string} url - Manabox deck URL
 * @returns {Promise<Array<{name: string, quantity: number}>>}
 * @throws {Error} if URL is invalid, scraper fails, or no cards are found
 */
async function fetchManabox(url) {
  // Validate that this looks like a Manabox deck URL
  const m = url.match(/manabox\.app\/(?:decks?|d)\/([a-zA-Z0-9_-]+)/i);
  if (!m) {
    throw new Error("Invalid Manabox URL — expected: https://manabox.app/decks/XXXXXXXX");
  }

  if (window.electronAPI?.scrapeManabox) {
    console.log('[App] Invoking electronAPI.scrapeManabox for URL:', url);
    const raw = await window.electronAPI.scrapeManabox(url);

    if (!raw) {
      throw new Error("Scraper returned nothing. The page may have failed to load.");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Couldn't parse scraper response — invalid JSON returned.");
    }

    if (parsed.source === "error") {
      throw new Error(parsed.message || "Scraper returned an error.");
    }

    const raw_cards = parsed.data;
    if (!Array.isArray(raw_cards) || raw_cards.length === 0) {
      throw new Error("No cards found in scraper data.");
    }

    // Normalize the card objects — Manabox's structure may vary
    const cards = raw_cards.map(c => ({
      name:     c.name || c.cardName || c.card?.name,
      quantity: c.quantity || c.count || c.qty || 1,
    })).filter(c => c.name); // Drop any entries without a resolved name

    console.log(`[App] fetchManabox: resolved ${cards.length} cards.`);
    return cards;
  }

  // If electronAPI is not available, the app is probably running in a browser
  throw new Error(
    "Electron scraper API not available. " +
    "Use the Deck List tab to paste your deck manually."
  );
}

/**
 * fetchPrintings(name)
 * Queries the Scryfall API for all printings of a card by exact name.
 * Uses the `unique=prints` parameter to get every set printing, sorted
 * newest-first (order=released&dir=desc).
 *
 * Rate limiting: waits 85ms before each request to comply with Scryfall's
 * API usage guidelines (minimum 50–100ms between requests).
 *
 * @param {string} name - Exact card name (e.g. "Lightning Bolt")
 * @returns {Promise<Array>} Array of Scryfall card objects, or [] on failure
 */
async function fetchPrintings(name) {
  // Polite delay to respect Scryfall's rate limit guidelines
  await sleep(85);

  const query = `!"${name}"`; // Exact name match query
  const url   = `${SCRYFALL}/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=desc`;

  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`[App] Scryfall returned ${r.status} for "${name}"`);
      return [];
    }
    const d = await r.json();
    console.log(`[App] fetchPrintings: "${name}" → ${d.data?.length ?? 0} printings`);
    return d.data || [];
  } catch (e) {
    console.error(`[App] fetchPrintings network error for "${name}":`, e.message);
    return [];
  }
}

/**
 * getImg(printing, face)
 * Resolves the best available image URL from a Scryfall card object.
 *
 * Scryfall cards have three possible image structures:
 *   1. printing.image_uris        — single-faced cards
 *   2. printing.card_faces[n].image_uris — double-faced cards (each face has its own images)
 *   3. Neither                    — shouldn't happen, but falls back to CARD_BACK
 *
 * Prefers 'large' (672×936px) over 'normal' (488×680px) for print quality.
 *
 * @param {Object|null} printing - Scryfall card object
 * @param {number} [face=0] - Face index: 0 = front, 1 = back
 * @returns {string} Image URL
 */
function getImg(printing, face = 0) {
  if (!printing) return CARD_BACK;

  // Single-faced card: image_uris at the top level
  if (printing.image_uris) {
    return printing.image_uris.large || printing.image_uris.normal;
  }

  // Double-faced card: image_uris nested inside card_faces array
  const f = printing.card_faces?.[face];
  if (f?.image_uris) {
    return f.image_uris.large || f.image_uris.normal;
  }

  // Ultimate fallback
  console.warn('[App] getImg: could not resolve image URL, using card back fallback.');
  return CARD_BACK;
}

/**
 * isDFC(printing)
 * Returns true if a card is a double-faced card (DFC) with a distinct back face image.
 * This is used to determine whether to print a back face on duplex back pages,
 * and whether to show two images in the hover preview.
 *
 * @param {Object|null} p - Scryfall card object
 * @returns {boolean}
 */
function isDFC(p) {
  return p?.card_faces?.length >= 2 && !!p.card_faces[1]?.image_uris;
}

/**
 * buildDeckText(rows)
 * Serializes the card editor rows into standard deck list format.
 * Output example:
 *   4 Lightning Bolt
 *   2 Counterspell
 *   1 Black Lotus
 *
 * Used by the clipboard copy and .txt file export features.
 *
 * @param {Array<{name: string, qty: number|string}>} rows
 * @returns {string}
 */
function buildDeckText(rows) {
  return rows
    .filter(r => r.name.trim())
    .map(r => `${parseInt(r.qty) || 1} ${r.name.trim()}`)
    .join("\n");
}

// ─── CSS string ───────────────────────────────────────────────────────────────
/**
 * CSS
 * All component styles are defined here as a tagged template string and
 * injected into a <style> tag in the render output. This keeps the entire
 * application self-contained in one file without requiring a separate CSS
 * bundling step.
 *
 * Design system:
 *   Background:  #08090f (near-black with a blue tint)
 *   Primary:     #c9a84c (gold — used for titles, active states, accents)
 *   Panel bg:    #0d0f20 / #111428 (dark blue-gray)
 *   Border:      #1a1830 / #1e1c32
 *   Body text:   #e4d8c0 (warm off-white)
 *   Muted text:  #4a4468 / #5a5470
 *   Fonts:       Cinzel (display/headers), Crimson Pro (body)
 */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Pro:ital,wght@0,300;0,400;0,600;1,400&display=swap');

/* ── Keyframe animations ── */
@keyframes fadeIn   { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
@keyframes spin     { to { transform: rotate(360deg); } }
@keyframes phraseIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
@keyframes shimmer  { 0%{background-position:100% 0} 100%{background-position:-100% 0} }
@keyframes slideIn  { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }

*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
body,#root {
  background: #08090f;
  min-height: 100vh;
  font-family: 'Crimson Pro', Georgia, serif;
  color: #e4d8c0;
}
.app {
  min-height: 100vh;
  background: radial-gradient(ellipse at 50% 0%, #101428 0%, #08090f 65%);
}

/* ── Page header ── */
.header {
  text-align: center; padding: 44px 20px 32px;
  position: relative; border-bottom: 1px solid #1e1c30;
}
.header::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse at 50% 0%, rgba(180,140,40,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.header-glyph { font-size: 2rem; margin-bottom: 10px; opacity: 0.7; }
.header-title {
  font-family: 'Cinzel', serif;
  font-size: clamp(1.6rem, 4vw, 2.4rem); font-weight: 700; color: #c9a84c;
  letter-spacing: 0.1em;
  text-shadow: 0 0 40px rgba(201,168,76,0.35), 0 2px 0 rgba(0,0,0,0.5);
}
.header-sub { margin-top: 8px; font-size: 1rem; color: #5a5470; font-style: italic; }

/* ── Main container: 1in margin left and right ── */
.container { width: calc(100vw - 2in); margin: 0 auto; padding: 0 0 80px; }

/* ── Floating panel ── */
.panel {
  margin-top: 36px;
  background: linear-gradient(160deg, #111428 0%, #0c0e1e 100%);
  border: 1px solid #1e1c32; border-radius: 14px;
  padding: 30px 28px; box-shadow: 0 8px 40px rgba(0,0,0,0.4);
}

/* ── Tab strip ── */
.tabs { display: flex; border-bottom: 1px solid #1e1c32; margin-bottom: 26px; gap: 4px; }
.tab-btn {
  padding: 9px 22px 10px; font-family: 'Cinzel', serif;
  font-size: 0.78rem; letter-spacing: 0.09em;
  background: none; border: none; border-bottom: 2px solid transparent;
  margin-bottom: -1px; color: #4a4468; cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.tab-btn:hover { color: #8a8090; }
.tab-btn.active { color: #c9a84c; border-bottom-color: #c9a84c; }

/* ── Form elements ── */
.field-label {
  display: block; font-family: 'Cinzel', serif; font-size: 0.7rem;
  letter-spacing: 0.12em; text-transform: uppercase; color: #6a6080; margin-bottom: 9px;
}
.field-input {
  width: 100%; padding: 13px 16px;
  background: #08090f; border: 1px solid #1e1c32; border-radius: 8px;
  color: #e4d8c0; font-family: 'Crimson Pro', serif; font-size: 1.05rem;
  outline: none; transition: border-color 0.2s, box-shadow 0.2s;
}
.field-input:focus { border-color: #5a4a80; box-shadow: 0 0 0 3px rgba(100,80,160,0.15); }
.field-input::placeholder { color: #2e2a40; }
textarea.field-input {
  min-height: 190px; resize: vertical;
  font-family: 'Courier New', monospace; font-size: 0.88rem; line-height: 1.65;
}
.hint { margin-top: 8px; font-size: 0.85rem; color: #3e3858; font-style: italic; line-height: 1.5; }

/* ── Buttons ── */
.btn-gold {
  display: block; width: 100%; margin-top: 22px; padding: 14px;
  background: linear-gradient(135deg, #9e7820 0%, #c9a84c 45%, #9e7820 100%);
  border: none; border-radius: 8px;
  font-family: 'Cinzel', serif; font-size: 0.92rem; font-weight: 600;
  letter-spacing: 0.1em; color: #0a0810; cursor: pointer;
  transition: box-shadow 0.2s, transform 0.15s;
  box-shadow: 0 4px 20px rgba(201,168,76,0.18);
}
.btn-gold:hover:not(:disabled) { box-shadow: 0 6px 32px rgba(201,168,76,0.38); transform: translateY(-1px); }
.btn-gold:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

.btn-ghost {
  padding: 10px 18px; background: transparent;
  border: 1px solid #2e2a42; border-radius: 7px;
  font-family: 'Cinzel', serif; font-size: 0.75rem; letter-spacing: 0.07em;
  color: #5a5472; cursor: pointer; transition: all 0.2s;
}
.btn-ghost:hover { border-color: #6a6090; color: #9a90b0; }

.btn-sm {
  padding: 5px 11px; background: transparent;
  border: 1px solid #2e2a42; border-radius: 6px;
  font-family: 'Cinzel', serif; font-size: 0.65rem; letter-spacing: 0.06em;
  color: #5a5472; cursor: pointer; transition: all 0.15s; flex-shrink: 0;
}
.btn-sm:hover { border-color: #6a6090; color: #9a90b0; }
.btn-sm.danger:hover { border-color: #8a3030; color: #c07070; }
.btn-sm.success { border-color: #2a5040; color: #60a080; }
.btn-sm.success:hover { border-color: #40a070; color: #80d0a0; }
.btn-sm.copied { border-color: #40a070 !important; color: #80d0a0 !important; }

/* ── Error display ── */
.error-box {
  margin-top: 14px; padding: 13px 16px;
  background: rgba(180,60,60,0.08); border: 1px solid rgba(180,60,60,0.25);
  border-radius: 8px; color: #d08080; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap;
}

/* ── Loading screen ── */
.loading-wrap { margin-top: 80px; text-align: center; padding: 60px 20px; }
.orb {
  width: 64px; height: 64px; margin: 0 auto 28px; border-radius: 50%;
  border: 2px solid #1e1c32; border-top-color: #c9a84c;
  box-shadow: 0 0 20px rgba(201,168,76,0.15);
  animation: spin 1.1s linear infinite;
}
/* The ominous phrase cycles with a fade-up animation on each change */
.loading-phrase {
  font-family: 'Cinzel', serif; font-size: 1.05rem; letter-spacing: 0.05em;
  color: #c9a84c; min-height: 1.6em; margin-bottom: 10px;
  animation: phraseIn 0.4s ease;
}
/* Subtitle shows the actual card name being processed */
.loading-sub { font-size: 0.85rem; color: #3e3858; font-style: italic; min-height: 1.4em; margin-bottom: 18px; }
.progress-track { width: 320px; height: 2px; background: #1a1830; border-radius: 2px; margin: 0 auto; overflow: hidden; }
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6a4a10, #c9a84c, #6a4a10);
  background-size: 200% 100%; border-radius: 2px; transition: width 0.35s ease;
  animation: shimmer 2s linear infinite;
}

/* ── Section header row (above card grid) ── */
.section-head {
  margin-top: 38px; margin-bottom: 18px;
  display: flex; align-items: baseline;
  justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.section-title { font-family: 'Cinzel', serif; font-size: 1.15rem; color: #c9a84c; letter-spacing: 0.06em; }
.section-meta { font-size: 0.85rem; color: #4a4468; font-style: italic; }

/* ── Card selection grid ──
   auto-fill with 160px min column width — fills available width with
   as many columns as possible, respecting the 1in container margin. */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px; margin-bottom: 28px;
}

/* ── Individual card tile ── */
.card-tile {
  background: #0d0f20; border: 1px solid #1a1830; border-radius: 10px;
  padding: 10px; cursor: default;
  transition: border-color 0.18s, transform 0.15s, box-shadow 0.18s;
}
.card-tile:hover {
  border-color: rgba(201,168,76,0.4);
  transform: translateY(-3px);
  box-shadow: 0 8px 28px rgba(0,0,0,0.5);
}
/* Card thumbnail: 5:7 aspect ratio matches actual Magic card proportions */
.card-thumb { width: 100%; aspect-ratio: 5/7; border-radius: 6px; overflow: hidden; margin-bottom: 8px; background: #08090f; }
.card-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
.card-tile:hover .card-thumb img { transform: scale(1.03); }
.card-tile-name {
  font-family: 'Cinzel', serif; font-size: 0.68rem; font-weight: 600;
  color: #d8ccb4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 5px;
}
.card-tile-badges { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; flex-wrap: wrap; }
.badge { font-family: 'Cinzel', serif; font-size: 0.58rem; padding: 2px 6px; border-radius: 20px; }
.badge-qty { background: #1a1830; color: #7a7090; }
.badge-dfc { background: rgba(100,80,180,0.18); color: #9080c8; border: 1px solid rgba(100,80,180,0.3); }
.badge-err { background: rgba(180,60,60,0.12); color: #c07070; }

/* ── Art printing selector — styled for visibility ──
   Uses a distinct background and border so it doesn't blend into the card tile */
.art-select {
  width: 100%; padding: 7px 10px;
  background: #13152a;
  border: 1px solid #3a3460;
  border-radius: 6px;
  color: #c9a84c;
  font-family: 'Crimson Pro', serif; font-size: 0.8rem;
  outline: none; cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  appearance: auto; /* Show native OS dropdown arrow */
}
.art-select:hover { border-color: #6a5a90; background: #181a30; }
.art-select:focus { border-color: #9080c8; box-shadow: 0 0 0 2px rgba(144,128,200,0.2); }
.art-select option { background: #13152a; color: #c9a84c; }

/* ── Hover preview (fixed position near cursor) ──
   Rendered as a fixed overlay so it appears on top of everything.
   Positioned dynamically by handleTileMouseMove() with edge-clamping. */
.card-hover-preview {
  position: fixed; z-index: 9999; display: flex; gap: 12px;
  pointer-events: none; /* Never intercepts mouse events */
  filter: drop-shadow(0 20px 50px rgba(0,0,0,0.9));
  animation: fadeIn 0.12s ease;
}
.card-hover-preview img { width: 220px; height: 308px; border-radius: 12px; object-fit: cover; display: block; }

/* ── Print settings panel ── */
.print-panel {
  margin-top: 36px; background: #0d0f20;
  border: 1px solid #1a1830; border-radius: 14px; padding: 26px 28px;
}
.print-title { font-family: 'Cinzel', serif; font-size: 0.95rem; letter-spacing: 0.07em; color: #c9a84c; margin-bottom: 18px; }
.print-section-label {
  font-family: 'Cinzel', serif; font-size: 0.65rem;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: #4a4468; margin-bottom: 10px; margin-top: 20px;
}
.radio-row { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 4px; }
.radio-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.95rem; color: #8a8098; transition: color 0.15s; }
.radio-label:hover { color: #b0a0c0; }
.radio-label input[type=radio] { accent-color: #c9a84c; width: 13px; height: 13px; }
.cut-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
.cut-btn {
  padding: 6px 14px; font-family: 'Cinzel', serif; font-size: 0.68rem; letter-spacing: 0.06em;
  background: #08090f; border: 1px solid #1a1830; border-radius: 6px;
  color: #5a5472; cursor: pointer; transition: all 0.15s;
}
.cut-btn:hover { border-color: #5a4a80; color: #9a90b0; }
.cut-btn.active { border-color: #c9a84c; color: #c9a84c; background: rgba(201,168,76,0.06); }
.print-info {
  font-size: 0.88rem; color: #4a4468; line-height: 1.65;
  padding: 12px 16px; background: #08090f; border-radius: 7px;
  border-left: 3px solid #2a2248; margin-top: 18px; margin-bottom: 22px;
}
.print-info b { color: #7a7090; }
.print-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.btn-print {
  flex: 1; padding: 14px;
  background: linear-gradient(135deg, #9e7820 0%, #c9a84c 45%, #9e7820 100%);
  border: none; border-radius: 8px;
  font-family: 'Cinzel', serif; font-size: 0.92rem; font-weight: 600;
  letter-spacing: 0.1em; color: #0a0810; cursor: pointer;
  transition: box-shadow 0.2s, transform 0.15s;
  box-shadow: 0 4px 20px rgba(201,168,76,0.18);
}
.btn-print:hover:not(:disabled) { box-shadow: 0 6px 32px rgba(201,168,76,0.4); transform: translateY(-1px); }
.btn-print:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
.btn-resubmit {
  padding: 14px 22px; background: transparent;
  border: 1px solid #5a4a80; border-radius: 8px;
  font-family: 'Cinzel', serif; font-size: 0.78rem; font-weight: 600;
  letter-spacing: 0.08em; color: #9080c8; cursor: pointer; transition: all 0.2s;
}
.btn-resubmit:hover:not(:disabled) { border-color: #9080c8; background: rgba(100,80,180,0.08); color: #b0a0e0; }
.btn-resubmit:disabled { opacity: 0.4; cursor: not-allowed; }

/* ── Collapsible card list editor ── */
.list-toggle {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 0 0; margin-top: 20px;
  border-top: 1px solid #151326;
  cursor: pointer; user-select: none;
}
.list-toggle:hover .list-toggle-label,
.list-toggle:hover .list-toggle-chevron { color: #8a8098; }
.list-toggle-label {
  font-family: 'Cinzel', serif; font-size: 0.65rem;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: #4a4468; transition: color 0.15s;
}
.list-toggle-chevron { font-size: 0.75rem; color: #4a4468; transition: color 0.15s; }
.card-editor {
  background: #08090f; border: 1px solid #1a1830; border-radius: 10px;
  overflow: hidden; margin-top: 12px; animation: slideIn 0.18s ease;
}
.card-editor-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 12px; border-bottom: 1px solid #111228; transition: background 0.15s;
}
.card-editor-row:hover { background: #0d0f28; }
.card-editor-qty {
  width: 46px; padding: 4px 6px; text-align: center;
  background: #111228; border: 1px solid #1a1830; border-radius: 5px;
  color: #c9a84c; font-family: 'Cinzel', serif; font-size: 0.8rem;
  outline: none; flex-shrink: 0;
}
.card-editor-qty:focus { border-color: #5a4a80; }
.card-editor-name {
  flex: 1; padding: 4px 8px;
  background: #111228; border: 1px solid #1a1830; border-radius: 5px;
  color: #d8ccb4; font-family: 'Crimson Pro', serif; font-size: 0.92rem;
  outline: none; min-width: 0;
}
.card-editor-name:focus { border-color: #5a4a80; }
.card-editor-toolbar {
  display: flex; align-items: center; justify-content: flex-end;
  gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid #1a1830; background: #0a0c1a;
}
.card-editor-toolbar-label {
  font-family: 'Cinzel', serif; font-size: 0.6rem;
  letter-spacing: 0.1em; text-transform: uppercase; color: #3a3458; margin-right: auto;
}
.card-editor-add {
  display: flex; gap: 8px; padding: 10px 12px;
  border-top: 1px solid #1a1830; align-items: center;
}
.card-editor-add input[type="text"] {
  flex: 1; padding: 6px 10px;
  background: #111228; border: 1px solid #1a1830; border-radius: 6px;
  color: #d8ccb4; font-family: 'Crimson Pro', serif; font-size: 0.9rem; outline: none;
}
.card-editor-add input[type="text"]:focus { border-color: #5a4a80; }
.card-editor-add input[type="text"]::placeholder { color: #2e2a40; }
.card-editor-add-qty {
  width: 52px; padding: 6px 8px; text-align: center;
  background: #111228; border: 1px solid #1a1830; border-radius: 6px;
  color: #c9a84c; font-family: 'Cinzel', serif; font-size: 0.8rem; outline: none; flex-shrink: 0;
}
.card-editor-add-qty:focus { border-color: #5a4a80; }
.divider { border: none; border-top: 1px solid #151326; margin: 36px 0; }
`;

// =============================================================================
// MAIN COMPONENT
// =============================================================================
/**
 * MTGProxyPrinter
 * Root React component. Manages all application state and renders one of three
 * "steps": input, loading, or select.
 *
 * State overview:
 *   tab          — "url" | "text" — which import tab is active
 *   urlInput     — controlled value for the Manabox URL field
 *   txtInput     — controlled value for the deck list textarea
 *   step         — "input" | "loading" | "select" — current screen
 *   loadMsg      — subtitle text shown below the ominous phrase during loading
 *   loadPct      — progress bar fill percentage (0–100)
 *   error        — error string displayed in the input panel
 *   entries      — Array<Entry> — the loaded card data (see below)
 *   mode         — "duplex" | "front" — print mode
 *   cutPx        — number — gap size in PDF points for cut lines
 *   printing     — boolean — PDF generation in progress
 *   hoverData    — { printing, x, y } | null — hover preview state
 *   listOpen     — boolean — card list editor expanded/collapsed
 *   editRows     — Array<{name, qty}> — live state of the card list editor
 *   addName      — controlled value for the "add card" name input
 *   addQty       — controlled value for the "add card" quantity input
 *   reloading    — boolean — UPDATE LIST in progress
 *   phrase       — current ominous phrase string
 *   phraseAnim   — incremented to force React to re-animate the phrase element
 *   copied       — boolean — clipboard copy confirmation state
 *
 * Entry shape:
 *   {
 *     name:        string,           // Card name
 *     quantity:    number,           // How many copies to print
 *     printings:   ScryfallCard[],   // All printings from Scryfall
 *     selectedIdx: number,           // Index into printings[] for chosen art
 *   }
 */
export default function MTGProxyPrinter() {
  const [tab,        setTab]        = useState("url");
  const [urlInput,   setUrlInput]   = useState("");
  const [txtInput,   setTxtInput]   = useState("");
  const [step,       setStep]       = useState("input");
  const [loadMsg,    setLoadMsg]    = useState("");
  const [loadPct,    setLoadPct]    = useState(0);
  const [error,      setError]      = useState("");
  const [entries,    setEntries]    = useState([]);
  const [mode,       setMode]       = useState("duplex");
  const [cutPx,      setCutPx]      = useState(0.5);
  const [printing,   setPrinting]   = useState(false);
  const [hoverData,  setHoverData]  = useState(null);
  const [listOpen,   setListOpen]   = useState(false);
  const [editRows,   setEditRows]   = useState([]);
  const [addName,    setAddName]    = useState("");
  const [addQty,     setAddQty]     = useState(1);
  const [reloading,  setReloading]  = useState(false);
  const [phrase,     setPhrase]     = useState("");
  const [phraseAnim, setPhraseAnim] = useState(0);
  const [copied,     setCopied]     = useState(false);

  // ── Ominous phrase cycling effect ──
  // Only active while step === "loading". Picks a new random phrase every 4.5s.
  // phraseAnim is incremented to force the CSS animation to re-trigger.
  useEffect(() => {
    if (step !== "loading") return;
    setPhrase(getPhrase());
    const iv = setInterval(() => {
      setPhraseAnim(k => k + 1);
      setPhrase(getPhrase());
    }, 4500);
    return () => clearInterval(iv); // Clean up on unmount or step change
  }, [step]);

  // ── Sync edit rows when entries update ──
  // Whenever the entries array is replaced (after an import or update),
  // rebuild the editRows so the card list editor reflects the new state.
  useEffect(() => {
    if (entries.length > 0) {
      setEditRows(entries.map(e => ({ name: e.name, qty: e.quantity })));
      console.log('[App] editRows synced from entries:', entries.length, 'cards');
    }
  }, [entries]);

  // ── Core import runner ──────────────────────────────────────────────────────
  /**
   * runImport(cards, previousEntries)
   * The shared import logic used by both the initial import and the UPDATE LIST
   * flow. Transitions to the loading step, fetches printings for each card
   * (or restores from art memory), then transitions to the select step.
   *
   * Art memory: before fetching, builds a lookup from previousEntries so that
   * cards already loaded can have their printings and selectedIdx restored
   * without a Scryfall round-trip.
   *
   * @param {Array<{name: string, quantity: number}>} cards
   * @param {Array<Entry>} [previousEntries=[]] - existing entries to pull art memory from
   */
  const runImport = useCallback(async (cards, previousEntries = []) => {
    // Build art memory lookup from previously loaded entries
    const artMemory = {};
    for (const e of previousEntries) {
      artMemory[e.name] = { selectedIdx: e.selectedIdx, printings: e.printings };
    }
    console.log('[App] runImport: art memory populated for', Object.keys(artMemory).length, 'cards');

    setStep("loading");
    setLoadPct(0);

    const result = [];
    let cacheHits  = 0;
    let cacheMisses = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      setLoadMsg(`${card.name}  (${i + 1} / ${cards.length})`);
      setLoadPct(Math.round(((i + 1) / cards.length) * 100));

      const mem = artMemory[card.name];
      if (mem && mem.printings.length > 0) {
        // Art memory hit — reuse cached printings and preserve selection
        result.push({ ...card, printings: mem.printings, selectedIdx: mem.selectedIdx });
        cacheHits++;
        console.log(`[App]   [cache hit] "${card.name}" — ${mem.printings.length} printings, selectedIdx=${mem.selectedIdx}`);
      } else {
        // Cache miss — fetch from Scryfall
        const printings = await fetchPrintings(card.name);
        result.push({ ...card, printings, selectedIdx: 0 });
        cacheMisses++;
        console.log(`[App]   [fetched]   "${card.name}" — ${printings.length} printings`);
      }
    }

    console.log(`[App] runImport complete. Cache hits: ${cacheHits}, Scryfall fetches: ${cacheMisses}`);
    setEntries(result);
    setStep("select");
  }, []);

  // ── Initial import handler ──────────────────────────────────────────────────
  /**
   * handleImport()
   * Triggered by the IMPORT CARDS button. Parses or fetches the card list
   * then delegates to runImport(). No art memory on the first import.
   */
  const handleImport = useCallback(async () => {
    console.log('[App] handleImport triggered. Tab:', tab);
    setError("");
    setStep("loading");
    setPhrase(getPhrase());

    try {
      let cards;
      if (tab === "url") {
        setLoadMsg("Fetching Manabox deck…");
        cards = await fetchManabox(urlInput.trim());
        console.log('[App] Manabox fetch returned', cards.length, 'cards');
      } else {
        cards = parseDeckText(txtInput);
        console.log('[App] parseDeckText returned', cards.length, 'cards');
        if (!cards.length) {
          throw new Error("No cards found. Use format: '4 Lightning Bolt'");
        }
      }
      await runImport(cards, []);
    } catch (e) {
      console.error('[App] handleImport error:', e.message);
      setError(e.message || "An unexpected error occurred.");
      setStep("input");
    }
  }, [tab, urlInput, txtInput, runImport]);

  // ── Update list handler ─────────────────────────────────────────────────────
  /**
   * handleResubmit()
   * Triggered by the ↺ UPDATE LIST button. Validates editRows, then calls
   * runImport() with the current entries as art memory so existing selections
   * are preserved.
   */
  const handleResubmit = async () => {
    const cards = editRows
      .map(r => ({
        name:     r.name.trim(),
        quantity: Math.max(1, Math.min(99, parseInt(r.qty) || 1)),
      }))
      .filter(c => c.name.length > 0);

    console.log('[App] handleResubmit: submitting', cards.length, 'cards');
    if (cards.length === 0) return;

    setReloading(true);
    setPhrase(getPhrase());
    try {
      await runImport(cards, entries);
    } finally {
      setReloading(false);
    }
  };

  // ── Export handlers ─────────────────────────────────────────────────────────

  /**
   * handleCopyList()
   * Copies the current card list to the system clipboard in standard
   * deck list format ("4 Lightning Bolt\n2 Counterspell\n...").
   * Shows a "✓ Copied!" confirmation for 2 seconds.
   */
  const handleCopyList = async () => {
    const text = buildDeckText(editRows);
    console.log('[App] Copying deck list to clipboard. Lines:', editRows.length);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Electron may not always have clipboard API access; fall back to execCommand
      console.warn('[App] navigator.clipboard unavailable, falling back to execCommand');
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /**
   * handleSaveTxt()
   * Triggers a browser-style file download of the deck list as a .txt file.
   * Creates a temporary Blob URL, simulates a click on a hidden anchor tag,
   * then revokes the URL to free memory.
   */
  const handleSaveTxt = () => {
    const text = buildDeckText(editRows);
    console.log('[App] Saving deck list as decklist.txt');
    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "decklist.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Card editor helpers ─────────────────────────────────────────────────────

  /** Update a single field of a single editRow by index. */
  const updateRow = (i, field, value) => {
    setEditRows(rows => {
      const next = [...rows];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  };

  /** Remove a card from the editRows list by index. */
  const removeRow = (i) => {
    console.log('[App] Removing card at index', i, ':', editRows[i]?.name);
    setEditRows(rows => rows.filter((_, idx) => idx !== i));
  };

  /**
   * addRow()
   * Appends a new card to the bottom of the editRows list using the
   * current addName/addQty values, then resets those inputs.
   */
  const addRow = () => {
    const name = addName.trim();
    if (!name) return;
    const qty = Math.max(1, parseInt(addQty) || 1);
    console.log('[App] Adding card:', qty, 'x', name);
    setEditRows(rows => [...rows, { name, qty }]);
    setAddName("");
    setAddQty(1);
  };

  // ── Print handler ───────────────────────────────────────────────────────────
  /**
   * handlePrint()
   * Builds the image URL payload and sends it to the main process via IPC.
   *
   * Page building logic:
   *   1. Flatten entries into a slots[] array (one element per card copy to print)
   *   2. Chunk into pages of 9 slots each (pad last page with nulls)
   *   3. Map each page to front image URLs
   *   4. For duplex: map each page to back image URLs using mirrored column order
   *      backOrder = [2,1,0, 5,4,3, 8,7,6] — reverses each row for long-edge flip
   *   5. Interleave front/back pages: [front0, back0, front1, back1, ...]
   *   6. Send { pages, cutPx } to the main process
   */
  const handlePrint = async () => {
    console.log('[App] handlePrint triggered. Mode:', mode, 'CutPx:', cutPx);
    setPrinting(true);

    try {
      // Flatten all card copies into a single slot array
      const slots = entries.flatMap(e =>
        Array(e.quantity).fill(e.printings[e.selectedIdx] ?? null)
      );
      console.log('[App] Total print slots:', slots.length);

      // Chunk into pages of 9
      const pages = [];
      for (let i = 0; i < slots.length; i += 9) {
        const pg = slots.slice(i, i + 9);
        while (pg.length < 9) pg.push(null); // Pad last page
        pages.push(pg);
      }
      console.log('[App] Pages:', pages.length);

      // Build front page image URL arrays
      const frontPages = pages.map(page => page.map(p => p ? getImg(p, 0) : null));

      if (mode === "duplex") {
        // Mirror columns for long-edge duplex alignment
        // Front:  [0,1,2, 3,4,5, 6,7,8]
        // Back:   [2,1,0, 5,4,3, 8,7,6]
        const backOrder = [2, 1, 0, 5, 4, 3, 8, 7, 6];

        const backPages = pages.map(page =>
          backOrder.map(idx => {
            const p = page[idx];
            if (!p) return null;
            // DFC: print back face. Non-DFC: leave blank (null → white slot in PDF)
            return isDFC(p) ? getImg(p, 1) : null;
          })
        );

        // Interleave: front0, back0, front1, back1, ...
        const interleaved = [];
        for (let i = 0; i < frontPages.length; i++) {
          interleaved.push(frontPages[i]);
          interleaved.push(backPages[i]);
        }

        console.log('[App] Duplex mode: sending', interleaved.length, 'pages (interleaved)');
        if (window.electronAPI?.printToPDF) {
          await window.electronAPI.printToPDF({ pages: interleaved, cutPx });
        } else {
          console.warn('[App] electronAPI.printToPDF not available');
        }

      } else {
        // Front-only mode
        console.log('[App] Front-only mode: sending', frontPages.length, 'pages');
        if (window.electronAPI?.printToPDF) {
          await window.electronAPI.printToPDF({ pages: frontPages, cutPx });
        } else {
          console.warn('[App] electronAPI.printToPDF not available');
        }
      }

    } catch (e) {
      console.error('[App] handlePrint error:', e.message);
    } finally {
      setPrinting(false);
    }
  };

  // ── Hover preview positioning ───────────────────────────────────────────────
  /**
   * handleTileMouseMove(e, printing)
   * Called on mousemove over any card tile. Computes an x/y position for the
   * hover preview that:
   *   - Appears to the right of the cursor (or left if near the right edge)
   *   - Is vertically centered on the cursor
   *   - Is clamped within the viewport with a 16px padding on all sides
   *
   * For DFC cards, the preview is twice as wide (two images side by side),
   * so the edge-flip calculation uses the doubled width.
   *
   * @param {MouseEvent} e
   * @param {Object} printing - Scryfall card object for the hovered tile
   */
  const handleTileMouseMove = (e, printing) => {
    const PAD = 16;
    const PW  = isDFC(printing) ? (220 * 2 + 12 + PAD * 2) : (220 + PAD * 2);
    const PH  = 308 + PAD * 2;

    let x = e.clientX + 24;
    let y = e.clientY - PH / 2;

    // Flip to left side if preview would overflow right edge
    if (x + PW > window.innerWidth - PAD) x = e.clientX - PW - 24;
    // Clamp to top edge
    if (y < PAD) y = PAD;
    // Clamp to bottom edge
    if (y + PH > window.innerHeight - PAD) y = window.innerHeight - PH - PAD;

    setHoverData({ printing, x, y });
  };

  // ── Derived values ──────────────────────────────────────────────────────────
  const totalCards = entries.reduce((s, e) => s + e.quantity, 0);
  const uniqueCards = entries.length;
  const pagesFront  = Math.ceil(totalCards / 9);
  const totalPages  = pagesFront * (mode === "duplex" ? 2 : 1);
  const editTotal   = editRows.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);

  // ==========================================================================
  // RENDER
  // ==========================================================================
  return (
    <>
      {/* Inject all component styles as a single <style> tag */}
      <style>{CSS}</style>

      <div className="app">

        {/* ── Page Header ── */}
        <div className="header">
          <div className="header-glyph">⚔</div>
          <div className="header-title">MTG PROXY PRINTER</div>
          <div className="header-sub">Import from Manabox · choose your art · save as PDF</div>
        </div>

        <div className="container">

          {/* ════════════════════════════════════════════════════════════════
              STEP: INPUT
              Shows tab strip (URL / Deck List), the relevant input field,
              an optional error message, and the Import button.
          ════════════════════════════════════════════════════════════════ */}
          {step === "input" && (
            <div className="panel">
              <div className="tabs">
                <button className={`tab-btn${tab === "url"  ? " active" : ""}`} onClick={() => setTab("url")}>MANABOX URL</button>
                <button className={`tab-btn${tab === "text" ? " active" : ""}`} onClick={() => setTab("text")}>DECK LIST</button>
              </div>

              {tab === "url" ? (
                <>
                  <label className="field-label">Manabox Deck URL</label>
                  <input type="text" className="field-input"
                    placeholder="https://manabox.app/decks/XXXXXXXXXX"
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && urlInput.trim() && handleImport()}
                  />
                  <p className="hint">Open your deck in Manabox → Share → Copy link, then paste here.</p>
                </>
              ) : (
                <>
                  <label className="field-label">Deck List</label>
                  <textarea className="field-input"
                    placeholder={"4 Lightning Bolt\n2 Counterspell\n1 Black Lotus\n20 Island"}
                    value={txtInput}
                    onChange={e => setTxtInput(e.target.value)}
                  />
                  <p className="hint">One card per line: <code style={{color:"#5a5070"}}>4 Lightning Bolt</code></p>
                </>
              )}

              {error && <div className="error-box">⚠  {error}</div>}

              <button className="btn-gold" onClick={handleImport}
                disabled={tab === "url" ? !urlInput.trim() : !txtInput.trim()}>
                IMPORT CARDS
              </button>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP: LOADING
              Shows spinning orb, cycling ominous phrase, card name subtitle,
              and a progress bar filled by loadPct (0–100).
          ════════════════════════════════════════════════════════════════ */}
          {step === "loading" && (
            <div className="loading-wrap">
              <div className="orb" />
              {/* key={phraseAnim} forces React to unmount/remount the element,
                  re-triggering the phraseIn CSS animation on each phrase change */}
              <div className="loading-phrase" key={phraseAnim}>{phrase}</div>
              <div className="loading-sub">{loadMsg}</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${loadPct}%` }} />
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP: SELECT
              Main UI: card art grid + print settings panel.
          ════════════════════════════════════════════════════════════════ */}
          {step === "select" && (
            <>
              <div className="section-head">
                <div className="section-title">Select Card Art</div>
                <div className="section-meta">{uniqueCards} unique · {totalCards} total · hover to preview</div>
              </div>

              {/* ── Card art grid ── */}
              <div className="card-grid">
                {entries.map((entry, i) => {
                  const p        = entry.printings[entry.selectedIdx];
                  const frontImg = getImg(p, 0);
                  const dfc      = isDFC(p);

                  return (
                    <div className="card-tile" key={entry.name + i}
                      onMouseMove={e => p && handleTileMouseMove(e, p)}
                      onMouseLeave={() => setHoverData(null)}
                    >
                      {/* Card thumbnail */}
                      <div className="card-thumb">
                        <img src={frontImg} alt={entry.name}
                          onError={e => { e.target.src = CARD_BACK; }} />
                      </div>

                      {/* Card name (truncated with ellipsis if too long) */}
                      <div className="card-tile-name">{entry.name}</div>

                      {/* Quantity, DFC, and error badges */}
                      <div className="card-tile-badges">
                        <span className="badge badge-qty">×{entry.quantity}</span>
                        {dfc && <span className="badge badge-dfc">DFC</span>}
                        {entry.printings.length === 0 && (
                          <span className="badge badge-err">NOT FOUND</span>
                        )}
                      </div>

                      {/* Art printing selector — only shown if printings were found */}
                      {entry.printings.length > 0 && (
                        <select className="art-select"
                          value={entry.selectedIdx}
                          onChange={e => {
                            const next = [...entries];
                            next[i] = { ...entry, selectedIdx: +e.target.value };
                            setEntries(next);
                            console.log(`[App] Art changed for "${entry.name}": index ${e.target.value}`);
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          {entry.printings.map((pr, pi) => (
                            <option key={pi} value={pi}>
                              {pr.set_name} ({pr.set.toUpperCase()}) #{pr.collector_number}
                              {pr.foil ? " ✦" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>

              <hr className="divider" />

              {/* ── Print settings panel ── */}
              <div className="print-panel">
                <div className="print-title">⬛  PRINT SETTINGS</div>

                {/* Print mode selection */}
                <div className="print-section-label">Print Mode</div>
                <div className="radio-row">
                  <label className="radio-label">
                    <input type="radio" name="pm" value="duplex"
                      checked={mode === "duplex"} onChange={() => setMode("duplex")} />
                    Duplex — Front &amp; Back
                  </label>
                  <label className="radio-label">
                    <input type="radio" name="pm" value="front"
                      checked={mode === "front"} onChange={() => setMode("front")} />
                    Front Only
                  </label>
                </div>

                {/* Cut line thickness buttons */}
                <div className="print-section-label">Cut Lines</div>
                <div className="cut-btn-row">
                  {CUT_OPTIONS.map(opt => (
                    <button key={opt.value}
                      className={`cut-btn${cutPx === opt.value ? " active" : ""}`}
                      onClick={() => { setCutPx(opt.value); console.log('[App] Cut line set to', opt.label, `(${opt.value}pt)`); }}
                    >{opt.label}</button>
                  ))}
                </div>

                {/* Summary info block */}
                <div className="print-info">
                  {mode === "duplex" ? (
                    <><b>Duplex:</b> front + back sheet per page. Double-faced cards print their back face;
                    single-faced cards leave the back slot blank.
                    Back columns are mirrored for long-edge duplex printing.</>
                  ) : (
                    <><b>Front only:</b> one side. Good for opaque sleeves or laminating.</>
                  )}
                  <br /><br />
                  Cards at exactly <b>2.5 × 3.5 in</b> · 3×3 per page ·{" "}
                  <b>{pagesFront} front page{pagesFront !== 1 ? "s" : ""}</b>
                  {mode === "duplex" && ` · ${pagesFront} back page${pagesFront !== 1 ? "s" : ""}`}
                  {" "}= <b>{totalPages} page{totalPages !== 1 ? "s" : ""} total</b>
                  {cutPx === 0 ? " · No cut lines" : ` · ${CUT_OPTIONS.find(o => o.value === cutPx)?.label} cut lines`}
                </div>

                {/* Action buttons row */}
                <div className="print-actions">
                  {/* Start Over: resets to input step */}
                  <button className="btn-ghost" onClick={() => {
                    console.log('[App] Start Over clicked.');
                    setStep("input"); setEntries([]); setError(""); setHoverData(null);
                  }}>
                    ← Start Over
                  </button>

                  {/* Update List: re-runs import using editRows, preserving art memory */}
                  <button className="btn-resubmit" onClick={handleResubmit}
                    disabled={reloading || editRows.filter(r => r.name.trim()).length === 0}>
                    {reloading ? "UPDATING…" : "↺ UPDATE LIST"}
                  </button>

                  {/* Save PDF: sends image data to Electron main process */}
                  <button className="btn-print" onClick={handlePrint} disabled={printing}>
                    {printing ? "GENERATING PDF…" : `SAVE PDF — ${totalCards} CARDS`}
                  </button>
                </div>

                {/* ── Collapsible card list editor ──
                    Collapsed by default. Click the header row to expand/collapse.
                    When expanded, shows editable rows + export toolbar + add row. */}
                <div className="list-toggle" onClick={() => {
                  setListOpen(o => !o);
                  console.log('[App] Card list editor toggled:', !listOpen ? 'open' : 'closed');
                }}>
                  <span className="list-toggle-label">
                    Card List — {editRows.length} unique · {editTotal} total
                  </span>
                  <span className="list-toggle-chevron">{listOpen ? "▲ collapse" : "▼ edit"}</span>
                </div>

                {listOpen && (
                  <div className="card-editor">

                    {/* Export toolbar */}
                    <div className="card-editor-toolbar">
                      <span className="card-editor-toolbar-label">Export List</span>
                      <button className={`btn-sm${copied ? " copied" : ""}`} onClick={handleCopyList}>
                        {copied ? "✓ Copied!" : "⎘ Copy to Clipboard"}
                      </button>
                      <button className="btn-sm" onClick={handleSaveTxt}>
                        ↓ Save as .txt
                      </button>
                    </div>

                    {/* Editable card rows */}
                    {editRows.map((row, i) => (
                      <div className="card-editor-row" key={i}>
                        <input type="number" className="card-editor-qty"
                          value={row.qty} min={1} max={99}
                          onChange={e => updateRow(i, "qty", e.target.value)}
                        />
                        <input type="text" className="card-editor-name"
                          value={row.name}
                          onChange={e => updateRow(i, "name", e.target.value)}
                        />
                        <button className="btn-sm danger" onClick={() => removeRow(i)}
                          title="Remove this card">✕</button>
                      </div>
                    ))}

                    {/* Add new card row */}
                    <div className="card-editor-add">
                      <input type="number" className="card-editor-add-qty"
                        value={addQty} min={1} max={99}
                        onChange={e => setAddQty(e.target.value)}
                      />
                      <input type="text" placeholder="Add a card…"
                        value={addName}
                        onChange={e => setAddName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addRow()}
                      />
                      <button className="btn-sm success" onClick={addRow}>+ Add</button>
                    </div>

                  </div>
                )}
              </div>

            </>
          )}

        </div>
      </div>

      {/* ── Hover Preview Overlay ──
          Rendered outside the main layout so it can float over everything.
          Uses an IIFE to keep the conditional rendering inline and avoid
          a named component for what is essentially a one-liner. */}
      {hoverData && (() => {
        const { printing: p, x, y } = hoverData;
        const dfc   = isDFC(p);
        const front = getImg(p, 0);
        const back  = dfc ? getImg(p, 1) : null;
        return (
          <div className="card-hover-preview" style={{ left: x, top: y }}>
            <img src={front} alt="Card front"
              onError={e => { e.target.style.display = "none"; }} />
            {back && (
              <img src={back} alt="Card back face"
                onError={e => { e.target.style.display = "none"; }} />
            )}
          </div>
        );
      })()}
    </>
  );
}
