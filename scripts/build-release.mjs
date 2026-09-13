#!/usr/bin/env node
/**
 * The release build: clean -> engines -> typecheck-fresh compile -> renderer
 * -> electron-builder (signed, hardened, sandboxed) -> verify-bundle.
 *
 * A clean first-party compile exits 0 with an empty warning log;
 * scripts/verify-bundle.mjs validates the packaged bundle.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
};

fs.rmSync(path.join(root, "dist-electron"), { recursive: true, force: true });
fs.rmSync(path.join(root, "dist", "renderer"), { recursive: true, force: true });
fs.rmSync(path.join(root, "dist", "release"), { recursive: true, force: true });

run("node", ["scripts/fetch-engines.mjs"]);
run("node", ["scripts/prepare-electron-mas.mjs"]);

// First-party compile. tsc emits nothing on success; any diagnostic is a
// failure (noEmitOnError is implied by strict CI use — assert exit 0).
run("npx", ["tsc", "-p", "electron/tsconfig.json"]);
run("node", ["scripts/build-preload.mjs"]);
run("npx", ["tsc", "--noEmit"]);
run("node", ["scripts/build-renderer.mjs"]);

run("node", ["scripts/build-quicklook.mjs"]);

run("npx", ["electron-builder", "--mac", "--arm64", "--config", "electron-builder.json"]);

run("node", [
  "scripts/verify-bundle.mjs",
  path.join(root, "dist", "release", "mac-arm64", "Manifest Chess Lite.app"),
]);

console.log("\nbuild-release: complete");
