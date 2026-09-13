#!/usr/bin/env node
/**
 * Build the renderer: one esbuild bundle (launch path — single JS file,
 * code-cached by Chromium after first run), one PostCSS/Tailwind pass over
 * styles/globals.css, and the static assets staged beside them.
 *
 * Output layout (dist/renderer/ == the pgnreader://app/ root):
 *   index.html  app.js  app.css  chess-assets/  sounds/  font/
 *   engine-host/  stockfish/  licenses/
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dist", "renderer");
fs.mkdirSync(out, { recursive: true });

const t0 = performance.now();

// 1. JS bundle.
await build({
  entryPoints: [path.join(root, "app", "main.tsx")],
  outdir: out,
  entryNames: "app",
  chunkNames: "chunks/[name]-[hash]",
  splitting: true,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome130",
  jsx: "automatic",
  minify: process.env.PGNREADER_DEV !== "1",
  sourcemap: process.env.PGNREADER_DEV === "1" ? "inline" : false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  loader: { ".woff2": "file", ".svg": "file" },
  logLevel: "warning",
});

// 2. CSS via PostCSS + Tailwind v4.
const postcss = (await import("postcss")).default;
const tailwind = (await import("@tailwindcss/postcss")).default;
const cssIn = path.join(root, "styles", "globals.css");
const css = fs.readFileSync(cssIn, "utf8");
const result = await postcss([tailwind({ base: root })]).process(css, {
  from: cssIn,
  to: path.join(out, "app.css"),
});
fs.writeFileSync(path.join(out, "app.css"), result.css);

// 3. index.html.
fs.copyFileSync(path.join(root, "app", "index.html"), path.join(out, "index.html"));

// 4. Static assets.
const assetDirs = ["chess-assets", "sounds", "font", "engine-host", "stockfish", "licenses", "brand"];
for (const dir of assetDirs) {
  const src = path.join(root, "public", dir);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(out, dir), { recursive: true });
}

console.log(`build-renderer: ok in ${(performance.now() - t0).toFixed(0)}ms`);
