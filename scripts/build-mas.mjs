#!/usr/bin/env node
/**
 * Mac App Store build. Two disciplines matter:
 *
 * - Signing identities are left to AUTO-DISCOVERY. Neither CSC_NAME nor
 *   mas.identity may name the application certificate: electron-builder
 *   reuses that value as the search filter for the "3rd Party Mac
 *   Developer Installer" certificate and dies not finding it. Unset, each
 *   certificate is discovered by its own type. The Quick Look hook has no
 *   discovery of its own, so its identity is derived here and passed via
 *   PGNREADER_SIGN_IDENTITY.
 *
 * - PGNREADER_BUILD_NUMBER sets CFBundleVersion independently of the
 *   marketing version: App Store Connect refuses a re-upload of the same
 *   CFBundleVersion, and it refuses AFTER the build. Validated here as 1-3
 *   dot-separated integers.
 *
 *   node scripts/build-mas.mjs [--dev]
 *
 * --dev packages mas-dev (Mac App Development profile): the only variant
 * that RUNS locally — distribution profiles carry no ProvisionedDevices,
 * and the binary refuses to launch despite a valid-looking signature.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isDev = process.argv.includes("--dev");

const run = (cmd, args, env) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    stdio: "inherit",
    cwd: root,
    env: env ? { ...process.env, ...env } : process.env,
  });
};

function findSigningIdentity(certificateType) {
  if (process.env.PGNREADER_SIGN_IDENTITY) return process.env.PGNREADER_SIGN_IDENTITY;
  const listed = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  const unique = [
    ...new Set(
      [...listed.matchAll(new RegExp(`"(${certificateType}: [^"]+)"`, "g"))].map((m) => m[1]),
    ),
  ];
  if (unique.length === 0) {
    throw new Error(
      `[mas] No "${certificateType}" certificate in the keychain. Install one ` +
        `or set PGNREADER_SIGN_IDENTITY.`,
    );
  }
  if (unique.length > 1) {
    throw new Error(
      `[mas] More than one "${certificateType}" certificate installed:\n` +
        unique.map((n) => `  ${n}`).join("\n") +
        `\nSet PGNREADER_SIGN_IDENTITY to the one to use.`,
    );
  }
  return unique[0];
}

const buildNumber = process.env.PGNREADER_BUILD_NUMBER;
if (buildNumber && !/^\d+(\.\d+){0,2}$/.test(buildNumber)) {
  console.error(
    `[mas] PGNREADER_BUILD_NUMBER "${buildNumber}" is not 1-3 dot-separated ` +
      `integers; App Store Connect rejects anything else — after the build.`,
  );
  process.exit(1);
}

// Profiles first: fail in seconds, not after the full compile.
const appProfile = isDev ? "build/embedded-dev.provisionprofile" : "build/embedded.provisionprofile";
const appexProfile = isDev
  ? "build/PGNPreview-dev.provisionprofile"
  : "build/PGNPreview.provisionprofile";
for (const p of [appProfile, appexProfile]) {
  if (!fs.existsSync(path.join(root, p))) {
    console.error(
      `[mas] Missing ${p}. Provisioning profiles need the owner's Apple ` +
        `account.`,
    );
    process.exit(2);
  }
}

fs.rmSync(path.join(root, "dist-electron"), { recursive: true, force: true });
fs.rmSync(path.join(root, "dist", "renderer"), { recursive: true, force: true });
fs.rmSync(path.join(root, "dist", "release-mas"), { recursive: true, force: true });

run("node", ["scripts/fetch-engines.mjs"]);
run("node", ["scripts/prepare-electron-mas.mjs"]);
run("npx", ["tsc", "-p", "electron/tsconfig.json"]);
run("node", ["scripts/build-preload.mjs"]);
run("npx", ["tsc", "--noEmit"]);
run("node", ["scripts/build-renderer.mjs"]);

const quickLookIdentity = findSigningIdentity(
  isDev ? "Apple Development" : "Apple Distribution",
);
if (buildNumber) console.log(`[mas] CFBundleVersion: ${buildNumber}`);

run(
  "npx",
  [
    "electron-builder",
    "--mac",
    isDev ? "mas-dev" : "mas",
    "--arm64",
    "--config",
    "electron-builder.mas.json",
    ...(buildNumber ? [`--config.buildVersion=${buildNumber}`] : []),
    "--publish",
    "never",
  ],
  {
    // Auto-discovery per certificate type — see the header. CSC_NAME must
    // be EMPTY; the Quick Look hook alone reads the derived identity.
    CSC_NAME: "",
    CSC_IDENTITY_AUTO_DISCOVERY: "true",
    PGNREADER_SIGN_IDENTITY: quickLookIdentity,
  },
);

run("node", [
  "scripts/verify-mas-bundle.mjs",
  isDev ? "dist/release-mas/mas-dev-arm64" : "dist/release-mas/mas-arm64",
]);
console.log("\nbuild-mas: complete");
