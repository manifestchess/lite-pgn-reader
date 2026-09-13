#!/usr/bin/env node
// Stage the bundled Stockfish WASM engines into public/stockfish/.
//
// The engine assets are the npm package stockfish@18.0.8, committed in this
// repo. If any is missing or fails verification it is re-fetched from npm.
// Every file is verified by size + sha256 before it is accepted, whichever
// source produced it.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const destDir = path.join(root, "public", "stockfish");
const localSource = path.join(root, "public", ".stockfish-source");

const NPM_SPEC = "stockfish@18.0.8";

// Size + sha256 of every engine asset we ship, measured from the pinned npm
// package.
const ASSETS = [
  { name: "stockfish-18.js", bytes: 32771, sha256: "10a0f96d5e2a1bc8646bf4a1a69353ede52499e7d94f6376f7b810404b010ced" },
  { name: "stockfish-18.wasm", bytes: 113007340, sha256: "8bef136a3d7a428b5cbc624459a2091fd3e750c22a48dad9ad3b292ac80373cb" },
  { name: "stockfish-18-lite.js", bytes: 32109, sha256: "f79e667c9d56ee768aca35e8343f91548ceef6a732f67cd82f267cf9eab7f665" },
  { name: "stockfish-18-lite.wasm", bytes: 7093151, sha256: "d50136919dcd90e75eb8df78b255d47d618962b670028b38961343f6eb409174" },
  { name: "stockfish-18-lite-single.js", bytes: 20670, sha256: "2278005057f381491f1c9bb3e44c9f5920b3a00bef9759e33cc6582769a1f1fe" },
  { name: "stockfish-18-lite-single.wasm", bytes: 7295411, sha256: "a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1" },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const verify = (asset, buf) => {
  if (buf.length !== asset.bytes) return `size ${buf.length} != ${asset.bytes}`;
  const digest = sha256(buf);
  if (digest !== asset.sha256) return `sha256 ${digest} != ${asset.sha256}`;
  return null;
};

fs.mkdirSync(destDir, { recursive: true });

const missing = ASSETS.filter((a) => {
  const dest = path.join(destDir, a.name);
  if (!fs.existsSync(dest)) return true;
  return verify(a, fs.readFileSync(dest)) !== null;
});

if (missing.length === 0) {
  console.log("fetch-engines: all engine assets present and verified");
  process.exit(0);
}

// Source 1: a local source directory, if present (read-only).
let stillMissing = [];
for (const asset of missing) {
  const src = path.join(localSource, asset.name);
  if (fs.existsSync(src)) {
    const buf = fs.readFileSync(src);
    if (verify(asset, buf) === null) {
      fs.writeFileSync(path.join(destDir, asset.name), buf);
      console.log(`fetch-engines: ${asset.name} staged from local source`);
      continue;
    }
  }
  stillMissing.push(asset);
}

// Source 2: the pinned npm package.
if (stillMissing.length > 0) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-engines-"));
  try {
    const tarball = execFileSync("npm", ["pack", NPM_SPEC, "--pack-destination", tmp], {
      encoding: "utf8",
    }).trim().split("\n").pop();
    for (const asset of stillMissing) {
      const buf = execFileSync(
        "tar",
        ["-xzOf", path.join(tmp, tarball), `package/bin/${asset.name}`],
        { maxBuffer: 256 * 1024 * 1024 },
      );
      const problem = verify(asset, buf);
      if (problem) throw new Error(`fetch-engines: ${asset.name} from npm failed verification: ${problem}`);
      fs.writeFileSync(path.join(destDir, asset.name), buf);
      console.log(`fetch-engines: ${asset.name} staged from ${NPM_SPEC}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

for (const asset of ASSETS) {
  const problem = verify(asset, fs.readFileSync(path.join(destDir, asset.name)));
  if (problem) {
    console.error(`fetch-engines: FINAL VERIFICATION FAILED for ${asset.name}: ${problem}`);
    process.exit(1);
  }
}
console.log("fetch-engines: all engine assets verified");
