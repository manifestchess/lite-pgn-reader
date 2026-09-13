/**
 * electron-builder afterPack hook: embed and sign the Quick Look extension.
 *
 * Signing an .appex is done here, not by electron-builder, because an appex
 * gets its OWN sandbox entitlements (com.apple.security.inherit is wrong
 * for a system-launched extension).
 *
 * Two channels, decided by the output directory (electron-builder runs this
 * hook once per target, so the output directory identifies the channel
 * reliably where a target-list test does not):
 *
 * - Developer ID (dist/release): hardened runtime + timestamp on the appex
 *   too — notarization requires the hardened runtime on every nested
 *   executable. No provisioning profile.
 * - MAS (dist/release-mas, out dirs containing "mas"): NO --options
 *   runtime (a hardened nested bundle inside the non-hardened store parent
 *   is an inconsistency upload validation rejects), and the appex embeds
 *   its OWN provisioning profile — its bundle id
 *   com.manifestchess.lite.PGNPreview is not covered by the app's
 *   profile, and upload validation rejects the pkg without it before any
 *   human sees the app. Development vs distribution profile follows the
 *   "mas-dev" dir name.
 *
 * electron-builder signs the app AFTER afterPack, so the outer signature
 * seals the embedded appex (signing is inside-out).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export default async function afterPack(context) {
  // electron-builder reports the MAS target as electronPlatformName "mas"
  // (macPackager sets platformName="mas" for mas/masDev), and only "darwin"
  // for the Developer ID mac build. Bailing on anything but "darwin" would
  // skip the appex on every store build — the channel this hook exists to
  // serve.
  if (context.electronPlatformName !== "darwin" && context.electronPlatformName !== "mas") {
    return;
  }
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  // Build the appex fresh so it can never go stale relative to the app.
  execFileSync("node", ["scripts/build-quicklook.mjs"], { cwd: root, stdio: "inherit" });

  const appexSrc = path.join(root, "dist-quicklook", "PGNPreview.appex");
  const entitlements = path.join(root, "dist-quicklook", "PGNPreview.entitlements");
  const pluginsDir = path.join(appPath, "Contents", "PlugIns");
  const appexDst = path.join(pluginsDir, "PGNPreview.appex");

  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.rmSync(appexDst, { recursive: true, force: true });
  fs.cpSync(appexSrc, appexDst, { recursive: true });

  const outDirName = path.basename(context.appOutDir);
  const isMas = outDirName.includes("mas");
  const isMasDev = outDirName.includes("mas-dev");

  // Identities are auto-discovered from the keychain by TYPE ("Apple
  // Distribution" / "Apple Development" / "Developer ID Application"); the
  // hook uses whatever PGNREADER_SIGN_IDENTITY or the config names, and
  // otherwise falls back to the bare type so the keychain lookup resolves
  // the signer. No account-specific identity is hard-coded here.
  const config = context.packager.config ?? {};
  const identity =
    process.env.PGNREADER_SIGN_IDENTITY ??
    (isMas
      ? (config.mas?.identity ??
        config.masDev?.identity ??
        (isMasDev ? "Apple Development" : "Apple Distribution"))
      : "Developer ID Application");

  if (isMas) {
    const profileRel = isMasDev
      ? "build/PGNPreview-dev.provisionprofile"
      : "build/PGNPreview.provisionprofile";
    const profile = path.join(root, profileRel);
    if (!fs.existsSync(profile)) {
      throw new Error(
        `[afterpack-quicklook] No provisioning profile at ${profileRel}. ` +
          "The extension's bundle id com.manifestchess.lite.PGNPreview " +
          "needs its own provisioning profile; upload validation " +
          "rejects the submission without it.",
      );
    }
    fs.cpSync(profile, path.join(appexDst, "Contents", "embedded.provisionprofile"));
  }

  const args = ["--force", "--sign", identity, "--entitlements", entitlements];
  if (!isMas) args.push("--options", "runtime");
  args.push("--timestamp", appexDst);
  execFileSync("codesign", args, { stdio: "inherit" });
  console.log(
    `[afterpack-quicklook] embedded and signed PGNPreview.appex (${isMas ? (isMasDev ? "mas-dev" : "mas") : "developer-id"})`,
  );
}
