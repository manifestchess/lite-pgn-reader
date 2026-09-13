/**
 * Every legal document the app must convey, in one place.
 *
 * Conveying them is a condition of distribution, not a courtesy. GPLv3
 * sections 4 and 5, GPLv2 sections 1 and 3, and the MIT and ISC notice
 * clauses all require the licence itself to travel with the binary. A
 * hyperlink is not a copy. The texts are staged under public/licenses/
 * (the AGPL copy ships beside the sounds it covers) and served from the
 * app's own origin, so the packaged offline build reads them locally.
 */

export interface LegalDocument {
  /** Path within the renderer's own origin. */
  path: string;
  /** Disclosure label in the viewer. */
  label: string;
  /**
   * Opening text of the real document. The viewer matches on this as a
   * belt-and-braces check that the served file is the licence itself and
   * not some fallback page.
   */
  firstLine: string;
}

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  {
    // The app itself, plus Stockfish, chessops and chessground.
    path: "/licenses/GPL-3.0.txt",
    label: "GNU General Public License v3",
    firstLine: "                    GNU GENERAL PUBLIC LICENSE",
  },
  {
    // The figurine font and the cburnett, merida and mono piece sets.
    // GPLv2+ obliges its own copy; shipping v3 does not cover it.
    path: "/licenses/GPL-2.0.txt",
    label: "GNU General Public License v2",
    firstLine: "                    GNU GENERAL PUBLIC LICENSE",
  },
  {
    // The lila board art and sounds, and the letter, pirouetti and pixel
    // piece sets. Shipped beside the sounds it came with, so it is
    // referenced where it lies rather than copied.
    path: "/sounds/LICENSE-AGPL-3.0.txt",
    label: "GNU Affero General Public License v3",
    firstLine: "                    GNU AFFERO GENERAL PUBLIC LICENSE",
  },
  {
    path: "/licenses/MIT.txt",
    label: "MIT License",
    firstLine: "MIT License",
  },
  {
    // The Lucide icon drawings the interface buttons are derived from.
    path: "/licenses/ISC.txt",
    label: "ISC License",
    firstLine: "ISC License",
  },
  {
    // The attribution the CC BY and CC BY-SA assets require.
    path: "/licenses/COPYING.md",
    label: "Bundled assets and their licences",
    firstLine: "# Copying",
  },
];
