#!/usr/bin/env node
/**
 * Bundle the preload scripts: a sandboxed preload gets a
 * `require` polyfill resolving `electron` and a few Node builtins and
 * nothing else, so a preload split across modules fails at runtime with
 * "module not found". esbuild inlines the imports (preload-api, the channel
 * constants) into one CJS file per preload, overwriting tsc's per-file
 * output. `electron` stays external because the polyfill provides it.
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PRELOADS = [
  ["electron/preload.ts", "dist-electron/electron/preload.js"],
  ["electron/engine/host-preload.ts", "dist-electron/electron/engine/host-preload.js"],
];

for (const [entry, out] of PRELOADS) {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(root, out),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: false,
    logLevel: "warning",
  });
}
console.log("build-preload: ok");
