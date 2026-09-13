/**
 * The semantic layer: chess positions, legality, and derived annotation
 * views, computed OVER the CST. Nothing here writes bytes; the CST remains
 * the only serialization source. chessops supplies chess rules and
 * FEN/variant handling (including X-FEN and Shredder-FEN castling via its
 * FEN parser); its PGN writer is deliberately unused.
 *
 * Replay failure is scoped: an unplayable or unrecognized token stops
 * semantic processing of ITS container only — a variation failure leaves the
 * mainline whole; remaining tokens stay visible as literal text and every
 * byte still round-trips. Games with any stuck region are read-only.
 */

import { makeFen } from "chessops/fen";
import { startingPosition } from "chessops/pgn";
import { makeSan, parseSan } from "chessops/san";
import type { Move, Position } from "chessops";
import { opposite } from "chessops/util";

import { WORD_CLS, type CstGame, type MtItem } from "./cst";

export interface DrawShapeLite {
  orig: string;
  dest?: string;
  brush: string;
}

export interface CommentMeta {
  /** Prose with recognized, well-formed commands stripped; malformed or
   *  unknown commands stay visible as literal text. */
  displayText: string;
  shapes: DrawShapeLite[];
  clockSeconds?: number;
  emtSeconds?: number;
  evaluation?: { cp?: number; mate?: number; depth?: number };
}

export interface SemNode {
  /** CST refs — where edits splice. */
  wordItem: MtItem & { k: "word" };
  container: MtItem[];
  /** The word exactly as written (display uses this, never re-derived SAN). */
  text: string;
  /** SAN for semantics (null for null moves). */
  san: string | null;
  isNullMove: boolean;
  move: Move | null;
  fen: string;
  ply: number;
  /** Fullmove number of the position BEFORE this move, and the side that
   *  moved — for rendering numbers of newly created moves only. */
  moveNumber: number;
  turn: "white" | "black";
  check: boolean;
  nags: number[];
  nagItems: MtItem[];
  comments: CommentMeta[];
  commentItems: (MtItem & { k: "comment" })[];
  startingComments: CommentMeta[];
  children: SemNode[];
}

export interface StuckInfo {
  /** Decoded token text that stopped replay. */
  token: string;
  reason: string;
  /** True when the stuck container is the game's mainline. */
  mainline: boolean;
}

export interface SemGame {
  children: SemNode[];
  rootComments: CommentMeta[];
  rootCommentItems: (MtItem & { k: "comment" })[];
  initialFen: string;
  initialPosition: Position | null;
  positionError: string | null;
  stuck: StuckInfo[];
  /** Result token text (first depth-0 terminator), null when absent. */
  resultText: string | null;
  resultItem: (MtItem & { k: "result" }) | null;
  /** Result tag vs terminator conflict (both preserved and surfaced). */
  resultConflict: boolean;
  plyCount: number;
}

const SUFFIX_NAG: Record<string, number> = {
  "!": 1,
  "?": 2,
  "!!": 3,
  "??": 4,
  "!?": 5,
  "?!": 6,
};

/** Normalize a SAN spelling for the legality parser ONLY — bytes on disk are
 *  never touched by this. Handles digit-zero/lowercase/en-dash castling,
 *  promotion without '=', slash/paren promotions, fused e.p. suffixes. */
export function normalizeSanForParse(san: string): string {
  let s = san;
  s = s.replace(/[–—]/g, "-");
  if (/^[0OoØ](-[0OoØ]){1,2}/.test(s)) {
    const dashes = s.match(/^[0OoØ](-[0OoØ]){1,2}/)![0];
    const tail = s.slice(dashes.length);
    const count = dashes.split("-").length - 1;
    s = (count >= 2 ? "O-O-O" : "O-O") + tail;
  }
  s = s.replace(/e\.?p\.?$/i, "");
  s = s.replace(/\(([QRBNqrbn])\)$/, "=$1");
  s = s.replace(/\/([QRBNqrbn])$/, "=$1");
  // Anchored to a promotion context (destination on rank 1/8): an unanchored
  // form would corrupt ANY token ending in q/r/b/n.
  s = s.replace(
    /([a-h][18])=?([qrbn])([+#]?)$/,
    (_, sq: string, p: string, suf: string) => `${sq}=${p.toUpperCase()}${suf}`,
  );
  s = s.replace(/([a-h][18])([QRBN])([+#]?)$/, "$1=$2$3");
  return s;
}

// ---------------------------------------------------------------------------
// Tolerant comment-command parsing (render-only; bytes preserved elsewhere)
// ---------------------------------------------------------------------------

const CMD_RE = /\[%([a-zA-Z]+)\s+([^\]]*)\]/g;
const CLK_RE = /^(-?\d+)\s*:\s*(-?\d+)\s*:\s*(-?\d+(?:\.\d+)?)$/;

function parseClock(payload: string): number | undefined {
  const m = CLK_RE.exec(payload.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const s = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || !Number.isFinite(s)) return undefined;
  return h * 3600 + mm * 60 + s;
}

const SQUARE_RE = /^[a-h][1-8]$/;
const BRUSHES: Record<string, string> = {
  G: "green",
  R: "red",
  Y: "yellow",
  B: "blue",
};

function parseShapes(kind: "csl" | "cal", payload: string): DrawShapeLite[] | null {
  const shapes: DrawShapeLite[] = [];
  for (const part of payload.split(",")) {
    const p = part.trim();
    if (p.length === 0) continue;
    const brush = BRUSHES[p[0]!.toUpperCase()];
    if (!brush) return null;
    const rest = p.slice(1);
    if (kind === "csl") {
      if (!SQUARE_RE.test(rest)) return null;
      shapes.push({ orig: rest, brush });
    } else {
      if (rest.length !== 4) return null;
      const orig = rest.slice(0, 2);
      const dest = rest.slice(2, 4);
      if (!SQUARE_RE.test(orig) || !SQUARE_RE.test(dest)) return null;
      shapes.push({ orig, dest, brush });
    }
  }
  return shapes;
}

function parseEval(payload: string): { cp?: number; mate?: number; depth?: number } | undefined {
  const parts = payload.trim().split(/[\s,]+/);
  const first = parts[0];
  if (first === undefined || first.length === 0) return undefined;
  const depth = parts[1] !== undefined ? Number(parts[1]) : undefined;
  const d = Number.isFinite(depth) ? depth : undefined;
  if (first.startsWith("#")) {
    const mate = Number(first.slice(1));
    return Number.isFinite(mate) ? { mate, depth: d } : undefined;
  }
  // Comma-decimal centipawn-ish values exist in the wild ([%eval 6,0]).
  const normalized = parts.length === 2 && /^-?\d+$/.test(first) && /^\d+$/.test(parts[1]!)
    ? `${first}.${parts[1]}`
    : first.replace(",", ".");
  const pawns = Number(normalized);
  if (!Number.isFinite(pawns)) return undefined;
  return { cp: Math.round(pawns * 100), depth: parts.length === 2 ? undefined : d };
}

/**
 * Parse one comment's inner text. Only commands that parse cleanly are
 * stripped from the display text and surfaced structurally; everything else
 * (unknown [%foo], malformed payloads, bracket-less pseudo-commands) stays
 * visible verbatim.
 */
export function parseCommentMeta(inner: string): CommentMeta {
  const shapes: DrawShapeLite[] = [];
  let clockSeconds: number | undefined;
  let emtSeconds: number | undefined;
  let evaluation: CommentMeta["evaluation"];
  const display = inner.replace(CMD_RE, (whole, name: string, payload: string) => {
    switch (name) {
      case "clk": {
        const v = parseClock(payload);
        if (v === undefined) return whole;
        if (clockSeconds === undefined) clockSeconds = v;
        return "";
      }
      case "emt": {
        const v = parseClock(payload);
        if (v === undefined) return whole;
        if (emtSeconds === undefined) emtSeconds = v;
        return "";
      }
      case "eval": {
        const v = parseEval(payload);
        if (v === undefined) return whole;
        if (evaluation === undefined) evaluation = v;
        return "";
      }
      case "csl":
      case "cal": {
        const v = parseShapes(name, payload);
        if (v === null) return whole;
        shapes.push(...v);
        return "";
      }
      default:
        // Unknown command: keep visible; round-trip is raw-byte anyway.
        return whole;
    }
  });
  return {
    displayText: display.replace(/\s+/g, " ").trim(),
    shapes,
    clockSeconds,
    emtSeconds,
    evaluation,
  };
}

/** Comment token bytes -> inner text (strip braces / leading semicolon). */
export function commentInner(raw: string, style: "brace" | "semi"): string {
  if (style === "semi") return raw.replace(/^;/, "");
  let s = raw;
  if (s.startsWith("{")) s = s.slice(1);
  if (s.endsWith("}")) s = s.slice(0, -1);
  return s;
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

/** First SAN-classed word of a container (recursing into a leading RAV);
 *  null when the line opens with a null move or holds no SAN evidence. */
function firstSanText(
  items: MtItem[],
  decodeTk: (item: MtItem) => string,
): string | null {
  for (const it of items) {
    if (it.k === "ws" || it.k === "comment" || it.k === "escape" || it.k === "nag") continue;
    if (it.k === "rav") return firstSanText(it.items, decodeTk);
    if (it.k === "word") {
      if (
        it.cls === WORD_CLS.MOVENUM ||
        it.cls === WORD_CLS.EP ||
        it.cls === WORD_CLS.SYM ||
        it.cls === WORD_CLS.SUFFIX
      )
        continue;
      if (it.cls === WORD_CLS.SAN) return it.san ?? decodeTk(it);
      return null;
    }
    return null;
  }
  return null;
}

/** The side a variation's leading move-number indicator claims to move:
 *  '2...' -> black, '2.' -> white, none -> null. Fused forms ('2...Nf6')
 *  count; anything before the first move-ish word is skipped, and a
 *  variation that LEADS with a nested variation takes the nested one's
 *  indicator (deletion can leave `( (3. Ke2) )` shapes behind). */
export function leadingTurnIndicator(
  items: MtItem[],
  decodeTk: (item: MtItem) => string,
): "white" | "black" | null {
  for (const it of items) {
    if (it.k === "ws" || it.k === "comment" || it.k === "escape" || it.k === "nag") continue;
    if (it.k === "rav") return leadingTurnIndicator(it.items, decodeTk);
    if (it.k === "word") {
      if (it.cls === WORD_CLS.MOVENUM || it.cls === WORD_CLS.SAN) {
        const m = /^\d+(\.+)/.exec(decodeTk(it));
        if (!m) return null;
        return m[1]!.length >= 2 ? "black" : "white";
      }
      return null;
    }
    return null;
  }
  return null;
}

/** Canonical form for conflict detection only — a nonstandard spelling of
 *  the SAME outcome is not a conflict (it is already flagged nonstandard). */
export function normalizeResult(text: string): string {
  const t = text.trim();
  if (t === "1-0" || t === "1–0") return "1-0";
  if (t === "0-1" || t === "0–1") return "0-1";
  if (t === "1/2-1/2" || t === "½-½" || t === "½–½" || t === "1/2") return "1/2-1/2";
  if (t === "*") return "*";
  return t;
}

function playNull(pos: Position): Position {
  const next = pos.clone();
  next.turn = opposite(next.turn);
  next.epSquare = undefined;
  if (next.turn === "white") next.fullmoves += 1;
  next.halfmoves += 1;
  return next;
}

export function buildSemantics(
  cst: CstGame,
  decodeTk: (item: MtItem) => string,
): SemGame {
  const headers = cst.tags;
  let pos0: Position | null = null;
  let positionError: string | null = null;
  try {
    pos0 = startingPosition(headers).unwrap();
  } catch (e) {
    positionError = e instanceof Error ? e.message : String(e);
  }

  const stuck: StuckInfo[] = [];
  const rootComments: CommentMeta[] = [];
  const rootCommentItems: (MtItem & { k: "comment" })[] = [];
  const rootChildren: SemNode[] = [];
  let resultItem: (MtItem & { k: "result" }) | null = null;
  let resultText: string | null = null;
  let plyCount = 0;

  interface Anchor {
    arr: SemNode[];
    pos: Position;
    ply: number;
  }

  const processContainer = (
    items: MtItem[],
    startAnchor: Anchor,
    mainline: boolean,
  ): void => {
    let cur: Anchor = startAnchor;
    let prev: Anchor | null = null;
    let lastNode: SemNode | null = null;
    let pendingStarting: { meta: CommentMeta; item: MtItem & { k: "comment" } }[] = [];
    let halted = false;

    for (const item of items) {
      if (halted) break;
      switch (item.k) {
        case "ws":
        case "escape":
          break;
        case "comment": {
          const meta = parseCommentMeta(commentInner(decodeTk(item), item.style));
          if (lastNode) {
            lastNode.comments.push(meta);
            lastNode.commentItems.push(item);
          } else if (mainline && cur === startAnchor) {
            rootComments.push(meta);
            rootCommentItems.push(item);
          } else {
            pendingStarting.push({ meta, item });
          }
          break;
        }
        case "nag": {
          if (lastNode && item.value !== null) {
            lastNode.nags.push(item.value);
            lastNode.nagItems.push(item);
          }
          break;
        }
        case "result": {
          if (mainline && resultItem === null) {
            resultItem = item;
            resultText = decodeTk(item);
          }
          break;
        }
        case "rav": {
          let anchor = prev ?? startAnchor;
          // Tolerant re-anchor: a variation opening with a black-continuation
          // number ('2... Nf6') while the anchor has white to move is an
          // alternative to the FOLLOWING move — the shape line deletion and
          // flattened-analysis exporters produce. Re-anchor one ply later
          // when that position's turn matches the indicator. Bytes are
          // untouched; this is a reading, not a repair.
          const expected = leadingTurnIndicator(item.items, decodeTk);
          if (
            expected !== null &&
            anchor.pos.turn !== expected &&
            cur.pos.turn === expected &&
            lastNode !== null
          ) {
            // The indicator wants the shifted anchor — but a ply-parity TYPO
            // in the indicator satisfies this test too (a mainline "13..."
            // typo repeated inside the RAV would re-anchor the variation past
            // the very move it replaces). The variation's first SAN
            // adjudicates: shift only when it is playable there; when it
            // parses only at the rewound anchor, the indicator is the error
            // and the rewind stands. Bytes untouched either way — this is a
            // reading, not a repair.
            const first = firstSanText(item.items, decodeTk);
            if (first === null) {
              anchor = cur;
            } else {
              // PREFER THE REWIND: the PGN spec anchors a RAV to the move
              // it follows. Shift only on positive evidence — the first SAN
              // unplayable at the spec anchor but playable at the shifted one
              // (the exporter-produced shape this heuristic exists for). A
              // move playable at BOTH stays at the spec anchor.
              const n = normalizeSanForParse(first);
              if (!parseSan(anchor.pos, n) && parseSan(cur.pos, n)) anchor = cur;
            }
          }
          processContainer(
            item.items,
            { arr: anchor.arr, pos: anchor.pos, ply: anchor.ply },
            false,
          );
          break;
        }
        case "word": {
          if (item.cls === WORD_CLS.MOVENUM || item.cls === WORD_CLS.EP) break;
          if (item.cls === WORD_CLS.SYM) break;
          if (item.cls === WORD_CLS.SUFFIX) {
            const nag = SUFFIX_NAG[decodeTk(item)];
            if (lastNode && nag !== undefined) {
              lastNode.nags.push(nag);
              lastNode.nagItems.push(item);
            }
            break;
          }
          if (item.cls === WORD_CLS.UNKNOWN) {
            const raw = decodeTk(item);
            // A result spelling where a move is expected (truncated
            // variation, duplicated terminator) ends THIS container cleanly
            // instead of sticking the game; bytes are preserved regardless.
            if (/^(1[-–—]0|0[-–—]1|1\/2[-–—]1\/2|\*|½[-–—]½)$/.test(raw)) {
              if (mainline && resultText === null) resultText = raw;
              halted = true;
              break;
            }
            stuck.push({
              token: raw,
              reason: "unrecognized token",
              mainline,
            });
            halted = true;
            break;
          }
          // SAN or null move.
          const text = decodeTk(item);
          const before = cur.pos;
          let after: Position;
          let move: Move | null = null;
          let sanForNode: string | null = null;
          if (item.cls === WORD_CLS.NULL) {
            after = playNull(before);
          } else {
            const normalized = normalizeSanForParse(item.san ?? text);
            const parsed = parseSan(before, normalized);
            if (!parsed) {
              // Optional debug instrumentation: distinguishes a diverged
              // `before` from a mangled token.
              if (process.env.PGNREADER_DEBUG_SEM) {
                console.error(
                  `[sem-debug] fen=${makeFen(before.toSetup())} cls=${String(item.cls)} ` +
                    `raw=${JSON.stringify(decodeTk(item))} san=${JSON.stringify(item.san)} ` +
                    `normalized=${JSON.stringify(normalized)} mainline=${String(mainline)}`,
                );
              }
              stuck.push({
                token: text,
                reason: "illegal or unparseable move",
                mainline,
              });
              halted = true;
              break;
            }
            move = parsed;
            sanForNode = makeSan(before, parsed);
            after = before.clone();
            after.play(parsed);
          }
          const node: SemNode = {
            wordItem: item,
            container: items,
            text,
            san: sanForNode,
            isNullMove: item.cls === WORD_CLS.NULL,
            move,
            fen: makeFen(after.toSetup()),
            ply: cur.ply + 1,
            moveNumber: before.fullmoves,
            turn: before.turn,
            check: after.isCheck(),
            nags: [],
            nagItems: [],
            comments: [],
            commentItems: [],
            startingComments: pendingStarting.map((p) => p.meta),
            children: [],
          };
          // A suffix fused into the move token ('e4!') is a NAG-equivalent
          // annotation on this node; the bytes stay in the word token.
          if (item.suffix !== null) {
            const nag = SUFFIX_NAG[item.suffix];
            if (nag !== undefined) node.nags.push(nag);
          }
          if (pendingStarting.length > 0) pendingStarting = [];
          cur.arr.push(node);
          if (mainline && node.ply > plyCount) plyCount = node.ply;
          prev = cur;
          cur = { arr: node.children, pos: after, ply: node.ply };
          lastNode = node;
          break;
        }
      }
    }
  };

  let initialFen = "";
  if (pos0) {
    initialFen = headers.get("FEN")?.trim() || makeFen(pos0.toSetup());
    processContainer(
      cst.movetext,
      { arr: rootChildren, pos: pos0, ply: 0 },
      true,
    );
  } else {
    initialFen = headers.get("FEN")?.trim() ?? "";
  }

  const tagResult = headers.get("Result");
  const resultConflict =
    tagResult !== undefined &&
    resultText !== null &&
    normalizeResult(tagResult) !== normalizeResult(resultText);

  return {
    children: rootChildren,
    rootComments,
    rootCommentItems,
    initialFen,
    initialPosition: pos0,
    positionError,
    stuck,
    resultText,
    resultItem,
    resultConflict,
    plyCount,
  };
}
