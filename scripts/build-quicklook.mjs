/**
 * Build the Quick Look preview extension.
 *
 * `node scripts/build-quicklook.mjs [--out <dir>]`
 *
 * A script rather than config because electron-builder has no concept of an
 * app extension: an .appex is a bundle with its own Info.plist, bundle
 * identifier and sandbox, and it must be signed before the app is, since
 * signing is inside-out. An afterPack hook does the embedding.
 *
 * The extension runs in a separate system-launched process and cannot call
 * into Electron, so its small PGN reader is deliberately independent of the
 * app's chessops-based parser rather than duplicated by accident.
 */
import { execFileSync } from "child_process";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(root, "quicklook", "PGNPreview");

const outArg = process.argv.indexOf("--out");
const outDir =
  outArg !== -1 ? process.argv[outArg + 1] : path.join(root, "dist-quicklook");

const bundleName = "PGNPreview.appex";
const bundlePath = path.join(outDir, bundleName);
const macosDir = path.join(bundlePath, "Contents", "MacOS");

const SOURCES = [
  "PGNDocument.swift",
  "PGNParser.swift",
  "PreviewRenderer.swift",
  "PreviewProvider.swift",
];

/** Deployment target. Matches LSMinimumSystemVersion in the Info.plist. */
const DEPLOYMENT_TARGET = "12.0";

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf-8" });
}

const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf-8"),
).version;

/**
 * CFBundleVersion, which must equal the containing app's.
 *
 * App Store Connect refuses an upload whose extension disagrees with its
 * host ("CFBundleVersion Mismatch"), so this reads the same override
 * scripts/build-mas.mjs uses and falls back to the package version when
 * there is none. Apple also caps it at three period-separated integers,
 * which is checked here rather than discovered forty minutes later at
 * the end of a signed build.
 */
const build = process.env.PGNREADER_BUILD_NUMBER ?? version;

if (!/^\d+(\.\d+){0,2}$/.test(build)) {
  console.error(
    `[quicklook] CFBundleVersion "${build}" is not one to three ` +
      `period-separated integers, which App Store Connect requires.`,
  );
  process.exit(1);
}

console.log(`[quicklook] Building ${bundleName} ${version} (build ${build})`);

rmSync(bundlePath, { recursive: true, force: true });
mkdirSync(macosDir, { recursive: true });

const sdk = run("xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();

// -emit-executable, NOT a loadable bundle. pluginkit launches an .appex as a
// process rather than dlopening it, and Apple's own (Finder's FileSearch
// .appex) report "Mach-O 64-bit executable". Linking it as a bundle shows up
// as a signing failure rather than a load failure: codesign accepts
// --entitlements against an MH_BUNDLE and silently stores nothing, so the
// extension comes out unsandboxed with no entitlements and fails validation.
//
// -module-name must match the Info.plist's NSExtensionPrincipalClass prefix
// (PGNPreview.PreviewProvider). Swift class names are module-qualified at
// runtime, so a mismatch means the host cannot find the class and the
// preview silently falls back to a generic icon.
run("xcrun", [
  "swiftc",
  "-sdk",
  sdk,
  "-target",
  `arm64-apple-macosx${DEPLOYMENT_TARGET}`,
  "-module-name",
  "PGNPreview",
  "-emit-executable",
  // The extension's entry point. Without it the linker looks for main()
  // and the executable cannot be launched by the extension host.
  "-Xlinker",
  "-e",
  "-Xlinker",
  "_NSExtensionMain",
  // Restricts the API surface to what an extension may call, the same
  // way Xcode's APPLICATION_EXTENSION_API_ONLY does.
  "-application-extension",
  "-O",
  "-o",
  path.join(macosDir, "PGNPreview"),
  ...SOURCES.map((f) => path.join(sourceDir, f)),
]);

// Stamp the version so the extension does not disagree with the app it
// ships inside. A mismatch is a validation error at submission.
const infoPlist = readFileSync(path.join(sourceDir, "Info.plist"), "utf-8");

writeFileSync(
  path.join(bundlePath, "Contents", "Info.plist"),
  infoPlist.replaceAll("__VERSION__", version).replaceAll("__BUILD__", build),
);

copyFileSync(
  path.join(sourceDir, "PGNPreview.entitlements"),
  path.join(outDir, "PGNPreview.entitlements"),
);

console.log(`[quicklook] Built ${bundlePath}`);
