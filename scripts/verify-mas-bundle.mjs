#!/usr/bin/env node
/**
 * Post-build gate for the store bundle — the checks that would otherwise come
 * back as upload-validation refusals or review rejections:
 *
 *   node scripts/verify-mas-bundle.mjs dist/release-mas/mas-arm64
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir || !fs.existsSync(outDir)) {
  console.error(`verify-mas-bundle: output dir not found: ${outDir}`);
  process.exit(2);
}
const appPath = path.join(outDir, "Manifest Chess Lite.app");
const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? "" });
  } catch (e) {
    results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
  }
};
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};

const entitlementsOf = (target) =>
  sh("codesign", ["-d", "--entitlements", "-", "--xml", target]);

check("app is signed with a team identifier", () => {
  const out = sh("codesign", ["-dv", appPath]);
  const team = (out.match(/TeamIdentifier=(\w+)/) ?? [])[1];
  if (!team || team === "not") throw new Error(out.slice(0, 300));
  // Optionally pin to a specific team via APPLE_TEAM_ID; otherwise just
  // require that the bundle carries one.
  const expected = process.env.APPLE_TEAM_ID;
  if (expected && team !== expected)
    throw new Error(`TeamIdentifier=${team}, expected ${expected}`);
  return `TeamIdentifier=${team}`;
});

check("hardened runtime is OFF (store channel)", () => {
  const out = sh("codesign", ["-dv", appPath]);
  const m = /flags=([^\s]+)/.exec(out);
  if (m && /runtime/.test(m[1])) throw new Error(`flags=${m[1]} — hardened runtime must be off for MAS`);
  return m ? `flags=${m[1]}` : "no flags line";
});

check("app entitlements: sandbox on, ZERO cs.* keys, no network", () => {
  const xml = entitlementsOf(appPath);
  if (!/com\.apple\.security\.app-sandbox/.test(xml)) throw new Error("app-sandbox missing");
  if (/com\.apple\.security\.cs\./.test(xml))
    throw new Error("cs.* entitlement present — hardened-runtime keys on a store binary");
  if (/com\.apple\.security\.network\./.test(xml)) throw new Error("network entitlement present");
  return "sandbox + user-selected files only";
});

check("provisioning profile embedded in the app", () => {
  const p = path.join(appPath, "Contents", "embedded.provisionprofile");
  if (!fs.existsSync(p)) throw new Error("Contents/embedded.provisionprofile missing");
  return `${fs.statSync(p).size} bytes`;
});

check("Quick Look appex embeds its OWN profile", () => {
  const p = path.join(
    appPath,
    "Contents/PlugIns/PGNPreview.appex/Contents/embedded.provisionprofile",
  );
  if (!fs.existsSync(p)) throw new Error("appex embedded.provisionprofile missing — upload validation rejects this");
  return `${fs.statSync(p).size} bytes`;
});

check("appex is NOT hardened and keeps its own sandbox entitlements", () => {
  const appex = path.join(appPath, "Contents/PlugIns/PGNPreview.appex");
  const out = sh("codesign", ["-dv", appex]);
  const m = /flags=([^\s]+)/.exec(out);
  if (m && /runtime/.test(m[1]))
    throw new Error("appex hardened inside non-hardened parent — upload validation objects");
  const xml = entitlementsOf(appex);
  if (!/com\.apple\.security\.app-sandbox/.test(xml)) throw new Error("appex sandbox missing");
  if (/com\.apple\.security\.inherit/.test(xml))
    throw new Error("appex must NOT inherit — it is system-launched");
  return "own sandbox, not hardened";
});

check("PrivacyInfo.xcprivacy packaged, collected-data empty", () => {
  const p = path.join(appPath, "Contents/Resources/PrivacyInfo.xcprivacy");
  if (!fs.existsSync(p)) throw new Error("Resources/PrivacyInfo.xcprivacy missing");
  const txt = fs.readFileSync(p, "utf8");
  if (!/NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/.test(txt))
    throw new Error("collected-data types not the empty array");
  return "declares no collection";
});

check("engine + licence assets present", () => {
  const res = path.join(appPath, "Contents/Resources");
  for (const f of ["renderer/stockfish/stockfish-18-lite.wasm", "renderer/licenses/COPYING.md"]) {
    if (!fs.existsSync(path.join(res, f))) throw new Error(`${f} missing`);
  }
  return "wasm + licences";
});

check("deep signature verifies", () => {
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath]);
  return "clean";
});

check("store pkg produced (skip for mas-dev)", () => {
  if (outDir.includes("mas-dev")) return "mas-dev: dir target, no pkg expected";
  // electron-builder writes the .pkg inside the app out dir (dist/release-mas/
  // mas-arm64) or, depending on version, in its parent. Check both.
  for (const d of [outDir, path.dirname(outDir)]) {
    const pkgs = fs.readdirSync(d).filter((f) => f.endsWith("-mas.pkg"));
    if (pkgs.length > 0) return path.join(path.relative(process.cwd(), d), pkgs[0]);
  }
  throw new Error("no *-mas.pkg in the output dir or its parent");
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(failed === 0 ? "verify-mas-bundle: ALL CHECKS PASSED" : `verify-mas-bundle: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
