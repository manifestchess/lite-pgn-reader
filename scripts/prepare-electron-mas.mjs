#!/usr/bin/env node
/**
 * Stage the MAS build of Electron for packaging.
 *
 * The standard darwin Electron dist cannot boot under the App Sandbox: the
 * browser process FATALs at mach_port_rendezvous_mac.cc bootstrap_check_in
 * ("Permission denied (1100)") because the seatbelt denies registering the
 * un-prefixed MachPortRendezvousServer name. The MAS dist of the SAME
 * Electron version carries the sandbox-compatible port-rendezvous
 * implementation, and is signable with Developer ID + hardened runtime like
 * any other binary. Not a new dependency: the same electron 43.4.0 release,
 * a different official artifact (electron-v43.4.0-mas-arm64.zip), consumed
 * from the local electron-builder cache.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "43.4.0";
const SHA256 = "8037c385407a2efc9b85b0d1b39121735571e0bc6a00eb44d29c1873fbe1a9d3";
const DEST = "build/electron-mas-dist";

if (fs.existsSync(path.join(DEST, "Electron.app")) && fs.existsSync(path.join(DEST, ".sha256"))) {
  const stamped = fs.readFileSync(path.join(DEST, ".sha256"), "utf8").trim();
  if (stamped === SHA256) {
    console.log(`prepare-electron-mas: ${DEST} already staged (sha ok)`);
    process.exit(0);
  }
}

const candidates = [];
const cacheRoot = path.join(os.homedir(), "Library/Caches/electron");
for (const dir of fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot) : []) {
  const p = path.join(cacheRoot, dir, `electron-v${VERSION}-mas-arm64.zip`);
  if (fs.existsSync(p)) candidates.push(p);
}
const direct = path.join(cacheRoot, `electron-v${VERSION}-mas-arm64.zip`);
if (fs.existsSync(direct)) candidates.push(direct);

let zip = null;
for (const c of candidates) {
  const sha = createHash("sha256").update(fs.readFileSync(c)).digest("hex");
  if (sha === SHA256) {
    zip = c;
    break;
  }
  console.warn(`prepare-electron-mas: ${c} sha mismatch (${sha}), skipping`);
}
if (!zip) {
  console.error(
    `prepare-electron-mas: no verified electron-v${VERSION}-mas-arm64.zip in ${cacheRoot}.\n` +
      `Download the official artifact from the electron v${VERSION} GitHub release,\n` +
      `verify sha256 ${SHA256}, and place it in that cache.`,
  );
  process.exit(2);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
execFileSync("ditto", ["-x", "-k", zip, DEST]);
fs.writeFileSync(path.join(DEST, ".sha256"), `${SHA256}\n`);
console.log(`prepare-electron-mas: staged ${zip} -> ${DEST}`);
