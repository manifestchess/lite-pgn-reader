#!/usr/bin/env node
/**
 * Verify the signed bundle:
 *
 *  1. The app's entitlements contain app-sandbox, NO com.apple.security.network.*
 *  2. Hardened runtime flag set on the signature.
 *  3. Every nested helper is signed by the same team identifier.
 *  4. Engine assets present in the packaged renderer with sane sizes.
 *  5. Licence documents present.
 *  6. .pgn document types declared in Info.plist.
 *  7. Quick Look appex (when present) sandboxed + same team.
 *
 * Prints every check with its evidence; exits nonzero on any failure.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const appPath = process.argv[2];
if (!appPath || !fs.existsSync(appPath)) {
  console.error(`verify-bundle: app not found: ${appPath}`);
  process.exit(2);
}

let failures = 0;
const check = (name, ok, evidence) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${evidence ? ` — ${evidence}` : ""}`);
  if (!ok) failures++;
};

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
/** codesign writes its display output to stderr; capture both streams. */
const shBoth = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

// 1+2. Entitlements + hardened runtime on the main bundle.
const ents = sh("codesign", ["-d", "--entitlements", "-", "--xml", appPath]);
check(
  "app sandbox entitlement present",
  ents.includes("com.apple.security.app-sandbox"),
  "com.apple.security.app-sandbox",
);
const networkKeys = ents.match(/com\.apple\.security\.network\.[a-z]+/g) ?? [];
check(
  "no network entitlements of any kind",
  networkKeys.length === 0,
  networkKeys.join(",") || "none found",
);
const flags = shBoth("codesign", ["-dvv", appPath]);
check(
  "hardened runtime flag on signature",
  /flags=.*runtime/.test(flags),
  (flags.match(/flags=[^\n]*/) ?? ["?"])[0],
);

function signingInfo(p) {
  return shBoth("codesign", ["-dvv", p]);
}

// 3. Same team on every nested code object.
const mainInfo = signingInfo(appPath);
const team = (mainInfo.match(/TeamIdentifier=(\w+)/) ?? [])[1];
check("app signed with a team identifier", Boolean(team), `TeamIdentifier=${team}`);
const nested = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith(".app") || entry.name.endsWith(".framework") || entry.name.endsWith(".appex")) {
        nested.push(p);
      }
      walk(p);
    }
  }
};
walk(path.join(appPath, "Contents"));
let sameTeam = true;
for (const n of nested) {
  const t = (signingInfo(n).match(/TeamIdentifier=(\w+)/) ?? [])[1];
  if (t !== team) {
    sameTeam = false;
    console.log(`      mismatched team on ${path.relative(appPath, n)}: ${t}`);
  }
}
check(`all ${nested.length} nested bundles share the team id`, sameTeam, `TeamIdentifier=${team}`);

// codesign deep verification.
try {
  sh("codesign", ["--verify", "--deep", "--strict", appPath]);
  check("codesign --verify --deep --strict", true, "clean");
} catch (e) {
  check("codesign --verify --deep --strict", false, String(e.message).split("\n")[0]);
}

// 4. Engine assets in the packaged renderer.
const rendererDir = path.join(appPath, "Contents", "Resources", "renderer");
const engineFiles = [
  ["stockfish/stockfish-18-lite.wasm", 1_000_000],
  ["stockfish/stockfish-18-lite-single.wasm", 1_000_000],
  ["stockfish/stockfish-18.wasm", 100_000_000],
];
for (const [rel, minBytes] of engineFiles) {
  const p = path.join(rendererDir, rel);
  const ok = fs.existsSync(p) && fs.statSync(p).size >= minBytes;
  check(`engine asset ${rel}`, ok, ok ? `${fs.statSync(p).size} bytes` : "missing/too small");
}

// 5. Licences.
const licenceDir = path.join(rendererDir, "licenses");
check(
  "licence documents packaged",
  fs.existsSync(licenceDir) && fs.readdirSync(licenceDir).length >= 3,
  fs.existsSync(licenceDir) ? fs.readdirSync(licenceDir).join(",") : "missing",
);

// 6. Document types.
const infoPlist = sh("plutil", ["-convert", "json", "-o", "-", path.join(appPath, "Contents", "Info.plist")]);
const info = JSON.parse(infoPlist);
const docTypes = JSON.stringify(info.CFBundleDocumentTypes ?? []);
check(".pgn document type declared", docTypes.includes("com.manifestchess.pgn"), "CFBundleDocumentTypes");
check(
  "pgn UTI imported",
  JSON.stringify(info.UTImportedTypeDeclarations ?? []).includes("pgn"),
  "UTImportedTypeDeclarations",
);

// 7. Quick Look appex, when embedded.
const appexPath = path.join(appPath, "Contents", "PlugIns", "PGNPreview.appex");
if (fs.existsSync(appexPath)) {
  const appexEnts = sh("codesign", ["-d", "--entitlements", "-", "--xml", appexPath]);
  check("QL appex sandboxed", appexEnts.includes("com.apple.security.app-sandbox"), "");
  const appexTeam = (signingInfo(appexPath).match(/TeamIdentifier=(\w+)/) ?? [])[1];
  check("QL appex same team", appexTeam === team, `TeamIdentifier=${appexTeam}`);
} else {
  console.log("note  Quick Look appex not embedded in this build");
}

console.log(failures === 0 ? "\nverify-bundle: ALL CHECKS PASSED" : `\nverify-bundle: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
