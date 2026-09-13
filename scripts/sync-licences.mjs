#!/usr/bin/env node
/**
 * Put every legal document the app must convey where the renderer can
 * fetch it, and fail loudly if one is missing.
 *
 * Most are committed under public/. COPYING.md is not: it carries the
 * attribution owed by the CC BY and CC BY-SA assets, it lives at the
 * repository root, and electron-builder does not package the root
 * (`build.files` is the compiled output, not the repository root). Copying
 * it into public/ before the Next export is what gets it into out/, and
 * therefore into app.asar. Generated rather than committed twice,
 * because a hand-maintained second copy is a copy that drifts.
 *
 * Must run before `next build` on every path that produces a shippable
 * bundle, including scripts/build-mas.mjs.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LEGAL_DOCUMENTS } from "./legal-documents.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicPath = (doc) => path.join(root, "public", doc.path.slice(1));

let failed = false;

for (const doc of LEGAL_DOCUMENTS) {
  if (doc.generatedFrom) {
    const from = path.join(root, doc.generatedFrom);

    if (!existsSync(from)) {
      console.error(`missing ${doc.generatedFrom}`);
      failed = true;
      continue;
    }
    copyFileSync(from, publicPath(doc));
  }

  const dest = publicPath(doc);

  if (!existsSync(dest)) {
    console.error(`missing public${doc.path}`);
    failed = true;
    continue;
  }

  // Checked here as well as in the bundle verifier, so a truncated or
  // swapped file is caught before a forty-minute signed build rather
  // than after it.
  const text = readFileSync(dest, "utf-8");
  const missing = doc.contains.filter((needle) => !text.includes(needle));

  if (!text.startsWith(doc.firstLine) || missing.length > 0) {
    console.error(`public${doc.path} is not ${doc.label}`);
    failed = true;
  }
}

if (failed) process.exit(1);
