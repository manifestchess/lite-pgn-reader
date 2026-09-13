/**
 * Every legal document the app must convey, in one place.
 *
 * Shared deliberately, the same way scripts/engine-assets.mjs is: the
 * viewer that renders these, the script that stages them, and the
 * verifier that refuses to package a build without them all read this
 * list, so adding a document cannot leave one of the three behind.
 *
 * Conveying them is a condition of distribution, not a courtesy. GPLv3
 * sections 4 and 5, GPLv2 sections 1 and 3, Apache-2.0 section 4(a),
 * and the MIT and ISC notice clauses all require the licence itself to
 * travel with the binary. A hyperlink is not a copy.
 */

/**
 * @typedef {object} LegalDocument
 * @property {string} path Path within the renderer's own origin.
 * @property {string} label Disclosure label in the viewer.
 * @property {string} firstLine
 *   Opening text of the real document. The viewer matches on this rather
 *   than on the HTTP status, because a missing file does not 404:
 *   `resolveAppFile` falls back to the SPA entry point and returns
 *   index.html with status 200, so `res.ok` is true for a document that
 *   is not there.
 * @property {string[]} contains
 *   Strings that must appear in the shipped file. Distinguishes the real
 *   document from a truncated copy, and from another document that opens
 *   with the same line, which GPLv2 and GPLv3 both do.
 * @property {string} [generatedFrom]
 *   Path relative to the repository root. Present when the file is
 *   staged into public/ at build time rather than committed.
 */

/** @type {LegalDocument[]} */
export const LEGAL_DOCUMENTS = [
  {
    // The app itself, plus Stockfish, chessops and Chessground.
    path: "/licenses/GPL-3.0.txt",
    label: "GNU General Public License v3",
    firstLine: "                    GNU GENERAL PUBLIC LICENSE",
    contains: [
      "Version 3, 29 June 2007",
      "TERMS AND CONDITIONS",
      "4. Conveying Verbatim Copies",
      "5. Conveying Modified Source Versions",
      "6. Conveying Non-Source Forms",
    ],
  },
  {
    // The pgn4web figurine font, and the cburnett, merida and mono piece
    // sets. GPLv2+ obliges its own copy; shipping v3 does not cover it.
    path: "/licenses/GPL-2.0.txt",
    label: "GNU General Public License v2",
    firstLine: "                    GNU GENERAL PUBLIC LICENSE",
    contains: ["Version 2, June 1991", "TERMS AND CONDITIONS", "NO WARRANTY"],
  },
  {
    // The lila boards and sounds, and the letter, pirouetti and pixel
    // piece sets. Already shipped beside the sounds it came with, so it
    // is referenced where it lies rather than copied.
    path: "/sounds/LICENSE-AGPL-3.0.txt",
    label: "GNU Affero General Public License v3",
    firstLine: "                    GNU AFFERO GENERAL PUBLIC LICENSE",
    contains: ["Version 3, 19 November 2007", "TERMS AND CONDITIONS"],
  },
  {
    path: "/licenses/Apache-2.0.txt",
    label: "Apache License 2.0",
    // apache.org serves this with a leading blank line. Matched as it is
    // rather than trimmed, because the point of this check is to catch a
    // file that is not the licence at all.
    firstLine: "\n                                 Apache License",
    contains: ["Version 2.0, January 2004", "4. Redistribution"],
  },
  {
    path: "/licenses/MIT.txt",
    label: "MIT License",
    firstLine: "MIT License",
    contains: ["Permission is hereby granted", "Maurizio Monge"],
  },
  {
    path: "/licenses/ISC.txt",
    label: "ISC License",
    firstLine: "ISC License",
    contains: ["Permission to use, copy, modify", "Lucide"],
  },
  {
    // The attribution the CC BY and CC BY-SA assets require. The root
    // copy is outside electron-builder's `files`, so it never reaches
    // the bundle on its own.
    path: "/licenses/COPYING.md",
    label: "Bundled assets and their licences",
    firstLine: "# Copying Manifest Chess Lite",
    contains: ["# Copying Manifest Chess Lite", "CC BY"],
    generatedFrom: "COPYING.md",
  },
];
