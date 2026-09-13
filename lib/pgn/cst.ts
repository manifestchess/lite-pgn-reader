/**
 * The concrete syntax tree: a lossless, byte-faithful representation of one
 * game, produced by the same scanner that indexed the file.
 *
 * Every leaf carries either a source slice (offsets RELATIVE TO THE GAME
 * SPAN, so rebasing after a save never touches the CST) or replacement text
 * created by an edit. Serialization is a pre-order walk emitting each leaf;
 * an untouched game therefore serializes to its exact source bytes, and an
 * edited game's byte diff is confined to the leaves the edit created or
 * replaced.
 *
 * chessops never touches this layer: its writer normalizes castling, strips
 * '}' from comments, rewrites NAGs and re-derives SAN. The semantic layer
 * derives positions FROM the CST and feeds nothing back except brand-new
 * tokens for brand-new moves.
 */

import {
  GFLAG,
  scanPgn,
  TOK,
  type TagPairRange,
  type TokType,
} from "./scan";

/** A leaf: exactly one of src (game-relative byte range) or text is set. */
export interface Tk {
  src: { start: number; end: number } | null;
  text: string | null;
}

export const tkFromSrc = (start: number, end: number): Tk => ({
  src: { start, end },
  text: null,
});
export const tkFromText = (text: string): Tk => ({ src: null, text });

export interface CstTagPair {
  name: string;
  /** Raw (still-escaped) value exactly as written. */
  rawValue: string;
  /** Unescaped value for display (\" and \\ only). */
  value: string;
}

export type HeaderElem =
  | { k: "tagline"; t: Tk; pairs: CstTagPair[]; strict: boolean }
  | { k: "ws"; t: Tk }
  | { k: "escape"; t: Tk };

export const WORD_CLS = {
  MOVENUM: "movenum",
  SAN: "san",
  NULL: "null",
  SUFFIX: "suffix",
  SYM: "sym",
  EP: "ep",
  UNKNOWN: "unknown",
} as const;
export type WordCls = (typeof WORD_CLS)[keyof typeof WORD_CLS];

export type MtItem =
  | { k: "ws"; t: Tk }
  | { k: "word"; t: Tk; cls: WordCls; san: string | null; suffix: string | null }
  | { k: "nag"; t: Tk; value: number | null }
  | { k: "comment"; t: Tk; style: "brace" | "semi"; unclosed: boolean }
  | { k: "rav"; open: Tk; items: MtItem[]; close: Tk | null }
  | { k: "result"; t: Tk }
  | { k: "escape"; t: Tk };

export interface CstGame {
  header: HeaderElem[];
  movetext: MtItem[];
  flags: number;
  /** Result of the strict-tag view: first occurrence wins, duplicates and
   *  conflicts surfaced by the caller walking `header` itself. */
  tags: Map<string, string>;
  /** Names that appeared more than once (first occurrence wins in `tags`;
   *  the tag editor surfaces the conflict from this). */
  duplicateTagNames: string[];
}

export class CstParseError extends Error {}

/** Only \" and \\ are escapes; a backslash before anything else stands for
 *  itself. */
export function unescapeTagValue(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && (raw[i + 1] === '"' || raw[i + 1] === "\\")) {
      out += raw[i + 1];
      i++;
      continue;
    }
    out += raw[i];
  }
  return out;
}

export function escapeTagValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Standalone evaluation-symbol / marker words that are legal movetext but
 *  not moves. Preserved verbatim, semantically inert. Anything word-shaped
 *  outside this list and not SAN/number/null-shaped is UNKNOWN and stops
 *  semantic replay at its position (never silently skipped). */
const SYM_WORDS = new Set([
  "+-", "-+", "+/-", "-/+", "+/=", "=/+", "=", "~", "∞", "=/∞",
  "→", "↑", "↑↑", "⇆", "⨀", "⟳", "N", "D", "RR", "○", "⊕",
  "⩲", "⩱", "±", "∓", "!", "?", "!!", "??", "!?", "?!",
]);

const SUFFIX_RE = /^[!?]{1,2}$/;
const MOVENUM_RE = /^\d+\.{0,3}$/;
const ELLIPSIS_RE = /^\.{1,3}$/; // bare '.' occurs in spaced numbering: '3 . Bb5'
const NULL_WORDS = new Set(["--", "Z0", "z0", "0000", "@@@@"]);
const EP_RE = /^(?:e\.p\.?|ep)$/i;

/** SAN shape, deliberately liberal: fused move numbers (`1.e4`), all
 *  castling spellings (letter O, digit 0, lowercase o, en dash), optional
 *  suffix annotation, promotions with/without '=' — the semantic layer
 *  decides legality; this only routes the token. */
const SAN_RE =
  /^(?:\d+\.{1,3})?(?:[KQRBNP]?[a-h]?[1-8]?[x:]?[a-h][1-8](?:=?\(?[QRBNqrbn]\)?|\/?[QRBNqrbn])?|[OoØ0](?:[-–][OoØ0]){1,2}|[a-h][x:][a-h][1-8]?|[a-h][18]?=?[QRBNqrbn]?)[+#]?(?:\s*(?:e\.p\.?))?[!?]{0,2}$/;

function classifyWord(word: string): {
  cls: WordCls;
  san: string | null;
  suffix: string | null;
} {
  if (NULL_WORDS.has(word)) return { cls: WORD_CLS.NULL, san: null, suffix: null };
  if (MOVENUM_RE.test(word) || ELLIPSIS_RE.test(word))
    return { cls: WORD_CLS.MOVENUM, san: null, suffix: null };
  if (SUFFIX_RE.test(word)) return { cls: WORD_CLS.SUFFIX, san: null, suffix: word };
  if (EP_RE.test(word)) return { cls: WORD_CLS.EP, san: null, suffix: null };
  if (SAN_RE.test(word)) {
    // Strip a fused move-number prefix and trailing suffix annotation to get
    // the SAN the semantic layer should try; the token bytes stay whole.
    // At least one dot is required: a bare digit run is not a number prefix,
    // so digit-zero castling ('0-0') keeps its leading '0'.
    let san = word.replace(/^\d+\.{1,3}/, "");
    const suffixMatch = san.match(/[!?]{1,2}$/);
    const suffix = suffixMatch ? suffixMatch[0] : null;
    san = san.replace(/[!?]{1,2}$/, "");
    if (NULL_WORDS.has(san)) return { cls: WORD_CLS.NULL, san: null, suffix };
    if (san.length === 0) return { cls: WORD_CLS.MOVENUM, san: null, suffix: null };
    return { cls: WORD_CLS.SAN, san, suffix };
  }
  if (SYM_WORDS.has(word)) return { cls: WORD_CLS.SYM, san: null, suffix: null };
  return { cls: WORD_CLS.UNKNOWN, san: null, suffix: null };
}

export interface CstParseResult {
  game: CstGame;
  /** True when the scanner saw the slice as exactly one game covering the
   *  whole span — the precondition for using this CST to serialize. When
   *  false the caller must treat the game as raw (read-only, byte-preserved). */
  coherent: boolean;
}

/**
 * Parse one game's bytes (the exact span the indexer produced) into a CST.
 * `bytes` is the game's own slice; all offsets are slice-relative.
 */
/** Beyond this nesting depth, RAV parens flatten into inert tokens: bytes
 *  and order preserved exactly, structure not — the game is flagged
 *  DEPTH_CAPPED and read-only. Set far above realistic nesting and far below
 *  every recursion cliff downstream. */
const RAV_DEPTH_CAP = 200;

export function parseGameCst(
  bytes: Uint8Array,
  decode: (start: number, end: number) => string,
): CstParseResult {
  const header: HeaderElem[] = [];
  const stack: MtItem[][] = [[]];
  let flattenedOpens = 0;
  let inMovetext = false;
  let gameCount = 0;
  let firstStart = -1;
  let lastEnd = -1;
  let flags = 0;
  const tags = new Map<string, string>();
  const duplicateTagNames: string[] = [];

  const top = (): MtItem[] => stack[stack.length - 1]!;

  scanPgn(
    bytes,
    {
      onGameStart(start) {
        gameCount++;
        if (firstStart < 0) firstStart = start;
      },
      onTagLine(lineStart, lineEnd, pairRanges: TagPairRange[], strict) {
        if (gameCount !== 1) return;
        const pairs: CstTagPair[] = pairRanges.map((r) => {
          const name = decode(r.nameStart, r.nameEnd);
          const rawValue = decode(r.valueStart, r.valueEnd);
          const value = unescapeTagValue(rawValue);
          if (!tags.has(name)) tags.set(name, value);
          else if (!duplicateTagNames.includes(name)) duplicateTagNames.push(name);
          return { name, rawValue, value };
        });
        header.push({ k: "tagline", t: tkFromSrc(lineStart, lineEnd), pairs, strict });
      },
      onToken(type: TokType, start, end) {
        if (gameCount !== 1) return;
        const t = tkFromSrc(start, end);
        if (!inMovetext && type !== TOK.WS && type !== TOK.ESCAPE_LINE) {
          inMovetext = true;
        }
        switch (type) {
          case TOK.WS:
            (inMovetext ? top() : header).push(
              inMovetext ? { k: "ws", t } : { k: "ws", t },
            );
            break;
          case TOK.ESCAPE_LINE:
            (inMovetext ? top() : header).push(
              inMovetext ? { k: "escape", t } : { k: "escape", t },
            );
            break;
          case TOK.WORD: {
            const word = decode(start, end);
            const { cls, san, suffix } = classifyWord(word);
            top().push({ k: "word", t, cls, san, suffix });
            break;
          }
          case TOK.NAG: {
            const digits = decode(start + 1, end);
            const value = digits.length > 0 ? Number(digits) : null;
            top().push({ k: "nag", t, value });
            break;
          }
          case TOK.COMMENT_BRACE: {
            const raw = decode(start, end);
            const unclosed = !raw.endsWith("}");
            top().push({ k: "comment", t, style: "brace", unclosed });
            break;
          }
          case TOK.COMMENT_SEMI:
            top().push({ k: "comment", t, style: "semi", unclosed: false });
            break;
          case TOK.RAV_OPEN: {
            if (stack.length > RAV_DEPTH_CAP) {
              flattenedOpens++;
              flags |= GFLAG.DEPTH_CAPPED;
              top().push({ k: "word", t, cls: WORD_CLS.SYM, san: null, suffix: null });
              break;
            }
            const rav: MtItem = { k: "rav", open: t, items: [], close: null };
            top().push(rav);
            stack.push(rav.items);
            break;
          }
          case TOK.RAV_CLOSE: {
            if (flattenedOpens > 0) {
              flattenedOpens--;
              top().push({ k: "word", t, cls: WORD_CLS.SYM, san: null, suffix: null });
              break;
            }
            if (stack.length > 1) {
              stack.pop();
              // Attach the close paren to the rav we just left.
              const parent = top();
              const rav = parent[parent.length - 1];
              if (rav && rav.k === "rav") rav.close = t;
            } else {
              // Orphan close paren: preserved as an inert word.
              top().push({ k: "word", t, cls: WORD_CLS.SYM, san: null, suffix: null });
            }
            break;
          }
          case TOK.RESULT:
            top().push({ k: "result", t });
            break;
        }
        if (end > lastEnd) lastEnd = end;
      },
      onGameEnd(contentEnd, gflags) {
        if (gameCount === 1) {
          flags |= gflags;
          if (contentEnd > lastEnd) lastEnd = contentEnd;
        }
      },
    },
    { emitTokens: true },
  );

  // Unclosed RAVs at game end keep close=null (flag already set by scanner).
  const coherent =
    gameCount === 1 &&
    firstStart === 0 &&
    trimEnd(bytes, lastEnd < 0 ? 0 : lastEnd) === trimEnd(bytes, bytes.length);

  return {
    game: { header, movetext: stack[0]!, flags, tags, duplicateTagNames },
    coherent,
  };
}

function trimEnd(bytes: Uint8Array, from: number): number {
  let i = from;
  while (
    i > 0 &&
    (bytes[i - 1] === 0x20 ||
      bytes[i - 1] === 0x09 ||
      bytes[i - 1] === 0x0a ||
      bytes[i - 1] === 0x0d ||
      bytes[i - 1] === 0x0b ||
      bytes[i - 1] === 0x0c)
  )
    i--;
  return i;
}

// ---------------------------------------------------------------------------
// Serialization: pre-order walk, each leaf verbatim.
// ---------------------------------------------------------------------------

export interface SerializeSink {
  /** Emit a slice of the game's original bytes. */
  src(start: number, end: number): void;
  /** Emit new text (encoded by the caller into the file's encoding). */
  text(text: string): void;
}

export function serializeCst(game: CstGame, sink: SerializeSink): void {
  const emit = (t: Tk): void => {
    if (t.src) sink.src(t.src.start, t.src.end);
    else if (t.text !== null) sink.text(t.text);
  };
  for (const el of game.header) emit(el.t);
  // Iterative walk — the save path must be immune to hostile nesting depth
  // (a stack overflow mid-serialization is potential data loss).
  type Frame = { items: MtItem[]; i: number; close: Tk | null };
  const stack: Frame[] = [{ items: game.movetext, i: 0, close: null }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.i >= frame.items.length) {
      if (frame.close) emit(frame.close);
      stack.pop();
      continue;
    }
    const it = frame.items[frame.i]!;
    frame.i++;
    if (it.k === "rav") {
      emit(it.open);
      stack.push({ items: it.items, i: 0, close: it.close });
    } else {
      emit(it.t);
    }
  }
}

/** Serialize into a byte array using the game's original bytes for src
 *  leaves and `encode` for text leaves. */
export function serializeCstToBytes(
  game: CstGame,
  original: Uint8Array,
  encode: (text: string) => Uint8Array,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  serializeCst(game, {
    src(start, end) {
      const c = original.subarray(start, end);
      chunks.push(c);
      total += c.length;
    },
    text(text) {
      const c = encode(text);
      chunks.push(c);
      total += c.length;
    },
  });
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Deep-walk helper used by edits and the semantic layer. Iterative for the
 *  same reason as serializeCst. */
export function* iterItems(items: MtItem[]): Generator<MtItem> {
  const stack: { items: MtItem[]; i: number }[] = [{ items, i: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.i >= frame.items.length) {
      stack.pop();
      continue;
    }
    const it = frame.items[frame.i]!;
    frame.i++;
    yield it;
    if (it.k === "rav") stack.push({ items: it.items, i: 0 });
  }
}

export { GFLAG };
