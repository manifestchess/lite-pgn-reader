/**
 * The document index: spans that tile the file plus the per-game metadata
 * the game list renders from.
 *
 * Built by the same scanner the CST parser uses, in boundary mode (no token
 * materialization), so index boundaries and parse boundaries cannot diverge
 * by construction.
 */

import { decodeSlice, type PgnEncoding } from "./encoding";
import { scanPgn, type TagPairRange } from "./scan";
import { unescapeTagValue } from "./cst";

export interface GameEntry {
  /** Absolute byte range of the game's content, separators excluded. */
  start: number;
  end: number;
  /** Scanner GFLAG bits. */
  flags: number;
  /** First standalone terminator token, absolute offsets (null if none). */
  result: { start: number; end: number } | null;
  /** Decoded list-display tags (first occurrence wins). */
  headers: GameHeaders;
  /** Number of header lines seen (0 = tagless/movetext-only game). */
  tagLineCount: number;
  /** True when at least one non-header token appeared (false = header-only). */
  hasMovetext: boolean;
}

/** Exactly the fields the game LIST and the header filter consume — the
 *  index retains one of these per game, so every field here costs ~30k
 *  strings on a large file. Anything else reads from the game's CST tags. */
export interface GameHeaders {
  event?: string;
  date?: string;
  white?: string;
  black?: string;
  result?: string;
  whiteElo?: string;
  blackElo?: string;
  /** Fallback for roster-absent files (e.g. study chapter exports). */
  chapterName?: string;
}

export interface PgnIndex {
  games: GameEntry[];
  /** Every byte before games[0].start (BOM, %-lines, junk, blank lines). */
  preambleEnd: number;
  /** Every byte after the last game's end. */
  trailingStart: number;
  byteLength: number;
}

const LIST_TAGS: Record<string, keyof GameHeaders> = {
  Event: "event",
  Date: "date",
  White: "white",
  Black: "black",
  WhiteElo: "whiteElo",
  BlackElo: "blackElo",
  Result: "result",
  ChapterName: "chapterName",
};

// Byte-level name matching: decoding every tag NAME of a large file just to
// look it up allocates hundreds of thousands of throwaway strings per open.
// List-tag names are ASCII; a name that doesn't byte-match can't be a list
// tag under any supported encoding (both UTF-8 and windows-1252 are
// ASCII-transparent), so only matched VALUES get decoded.
const enc0 = new TextEncoder();
const LIST_TAG_BYTES: [Uint8Array, keyof GameHeaders][] = Object.entries(LIST_TAGS).map(
  ([name, key]) => [enc0.encode(name), key],
);
function matchListTag(
  buf: Uint8Array,
  start: number,
  end: number,
): keyof GameHeaders | null {
  const len = end - start;
  outer: for (const [name, key] of LIST_TAG_BYTES) {
    if (name.length !== len) continue;
    for (let i = 0; i < len; i++) {
      if (buf[start + i] !== name[i]) continue outer;
    }
    return key;
  }
  return null;
}

/**
 * Index a whole file buffer. Cost is one scanner pass; no tokens are
 * materialized. Throws never — any byte sequence yields a valid index.
 */
export function indexPgn(buf: Uint8Array, encoding: PgnEncoding): PgnIndex {
  const games: GameEntry[] = [];
  const intern = new Map<string, string>();

  let cur: {
    start: number;
    flags: number;
    headers: GameHeaders;
    tagLineCount: number;
    hasMovetext: boolean;
  } | null = null;

  scanPgn(buf, {
    onGameStart(start) {
      cur = { start, flags: 0, headers: {}, tagLineCount: 0, hasMovetext: false };
    },
    onMovetextStart() {
      if (cur) cur.hasMovetext = true;
    },
    onTagLine(_lineStart, _lineEnd, pairs: TagPairRange[], _strict) {
      if (!cur) return;
      cur.tagLineCount++;
      for (const r of pairs) {
        const key = matchListTag(buf, r.nameStart, r.nameEnd);
        if (key && cur.headers[key] === undefined) {
          // Interned: events, dates, results and player names repeat across
          // thousands of games; retaining one string per distinct value
          // instead of one per game is a large share of index memory.
          const v = unescapeTagValue(
            decodeSlice(buf.subarray(r.valueStart, r.valueEnd), encoding),
          );
          const pinned = intern.get(v);
          if (pinned === undefined) {
            intern.set(v, v);
            cur.headers[key] = v;
          } else {
            cur.headers[key] = pinned;
          }
        }
      }
    },
    onGameEnd(contentEnd, flags, result) {
      if (!cur) return;
      games.push({
        start: cur.start,
        end: contentEnd,
        flags,
        result,
        headers: cur.headers,
        tagLineCount: cur.tagLineCount,
        hasMovetext: cur.hasMovetext,
      });
      cur = null;
    },
  });

  // Junk-block reclassification: a tagless run with no terminator and
  // nothing chess-shaped in it is stray prose ("Exported by SomeTool",
  // README text) — its bytes belong to the surrounding gap/preamble/trailing
  // spans, not to a phantom stuck game. Movetext-only games (legal import
  // format) survive the shape test.
  const kept = games.filter((g) => {
    if (g.tagLineCount > 0 || g.result !== null) return true;
    const len = g.end - g.start;
    if (len > 8192) return true; // too big to judge cheaply — keep, badge
    const text = decodeSlice(buf.subarray(g.start, g.end), encoding);
    return looksLikeChess(text);
  });

  return {
    games: kept,
    preambleEnd: kept.length > 0 ? kept[0]!.start : buf.length,
    trailingStart: kept.length > 0 ? kept[kept.length - 1]!.end : buf.length,
    byteLength: buf.length,
  };
}

const CHESS_SHAPE = [
  /\b\d+\.(?:\.\.)?\s*(?:[KQRBNP]?[a-h]?[1-8]?[x:]?[a-h][1-8]|[O0Øo][-–][O0Øo])/, // numbered move
  /(?:^|[\s(])[KQRBN][a-h]?[1-8]?x?[a-h][1-8][+#]?(?=[\s)]|$)/, // piece move
  /(?:^|[\s(])[a-h]x[a-h][1-8](?=[\s)]|$)/, // pawn capture
  /(?:^|[\s(])[O0Øo][-–][O0Øo](?:[-–][O0Øo])?(?=[\s)]|$)/, // castling
  /(?:^|[\s(])(?:--|Z0|z0|0000|@@@@)(?=[\s)]|$)/, // null move (all spellings)
];

/** Does tagless text contain anything move-shaped? Two bare squares also
 *  qualify ('e4 e5' with no numbers). Boundaries are lookaheads so adjacent
 *  tokens both match — a consuming boundary would make 'e4 e5' invisible to
 *  the reclassifier. */
function looksLikeChess(text: string): boolean {
  for (const re of CHESS_SHAPE) if (re.test(text)) return true;
  const squares = text.match(/(?:^|[\s(])[a-h][1-8](?=[\s)]|$)/g);
  return squares !== null && squares.length >= 2;
}

/**
 * Preamble + games + gaps + trailing tile the file. The spans between game
 * ends and next starts are the gaps; this asserts full coverage: monotonic,
 * non-overlapping game spans within [0, len).
 */
export function verifyTiling(index: PgnIndex): { ok: boolean; reason?: string } {
  let prevEnd = 0;
  for (let i = 0; i < index.games.length; i++) {
    const g = index.games[i]!;
    if (g.start < prevEnd)
      return { ok: false, reason: `game ${i} starts at ${g.start} before previous end ${prevEnd}` };
    if (g.end < g.start)
      return { ok: false, reason: `game ${i} has negative span ${g.start}..${g.end}` };
    if (g.end > index.byteLength)
      return { ok: false, reason: `game ${i} ends past EOF` };
    prevEnd = g.end;
  }
  return { ok: true };
}
