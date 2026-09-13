/**
 * Generate the app icon (build/icon.png), 1024x1024.
 *
 * The mark is a warm cream squircle tile carrying eight dark squares
 * (a 3x3 grid with the bottom-middle cell empty). Cream rather than pure
 * white so the tile keeps an edge on the App Store's white card instead of
 * dissolving into it.
 *
 * Rendered by WebKit (the same engine as the screenshot compositor):
 * a browser does squircle corners and antialiasing better than any raster
 * library, and the corners are transparent so macOS gets a real rounded
 * icon rather than a white square.
 *
 *   node scripts/gen-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { webkit } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "build/icon.png");

const SIZE = 1024;
const TILE = { inset: 118, size: 788, r: 176 };
const CELL = 165; // square side
const GAP = 58; // gap between squares
const CELL_R = 38;

const TILE_FILL = "#f0ece3"; // warm cream ground
// True black for the LAUNCHER icon only, so the squares read as dark as
// possible under macOS 26's Liquid Glass sheen. The in-app mark
// (public/brand/logo-mark-*.webp, used by the sidebar + welcome screen) is a
// separate asset with charcoal squares and is not produced here.
const SQUARE_FILL = "#000000"; // flat fill, no gradient

// 3x3 grid with the bottom-middle cell empty.
const span = 3 * CELL + 2 * GAP;
const pad = (TILE.size - span) / 2;
const origin = TILE.inset + pad;
const step = CELL + GAP;
const squares = [];
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    if (row === 2 && col === 1) continue; // empty bottom-middle
    squares.push({ x: origin + col * step, y: origin + row * step });
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="${TILE.inset}" y="${TILE.inset}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.r}" ry="${TILE.r}" fill="${TILE_FILL}"/>
  ${squares
    .map(
      (s) =>
        `<rect x="${s.x}" y="${s.y}" width="${CELL}" height="${CELL}" rx="${CELL_R}" ry="${CELL_R}" fill="${SQUARE_FILL}"/>`,
    )
    .join("\n  ")}
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  html, body { width: ${SIZE}px; height: ${SIZE}px; background: transparent; }
</style></head><body>${svg}</body></html>`;

const browser = await webkit.launch();
const pageCtx = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});
await pageCtx.setContent(html);
await pageCtx.locator("svg").waitFor();
const buf = await pageCtx.screenshot({ omitBackground: true, type: "png" });
fs.writeFileSync(OUT, buf);
await browser.close();

console.log(`[gen-icon] wrote ${OUT} (${SIZE}x${SIZE}, cream tile, ${squares.length} squares)`);
