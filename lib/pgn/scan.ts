/**
 * The one PGN scanner.
 *
 * A single byte-level state machine serves both the document indexer (game
 * boundaries + tag ranges, no token materialization) and the CST parser
 * (every token). Boundaries therefore agree between the two BY CONSTRUCTION —
 * the class of corruption where a fast splitter and the real parser disagree
 * about where a game starts (and an edit then splices bytes into the middle
 * of a neighbour) cannot arise from two implementations, only from a bug in
 * this one.
 *
 * Rules encoded here:
 * - Inside a brace comment nothing is structural: not blank lines, not
 *   tag-shaped lines (`[Source "…"]` occurs mid-comment in real files), not
 *   `%` at column 0 (applying the escape there loses comment content), not
 *   `;`, not parens.
 * - Brace comments do not nest: the first `}` closes. Real files contain
 *   permanently unmatched `{`; the resync rule (blank line then two strict
 *   tag lines) bounds the damage to one flagged game.
 * - `;` inside a tag line's quoted value is not a comment
 *   (`[TimeControl "G/90; +30"]`); string state guards it.
 * - A tag value's `\"` escape can hide `]` and `"` (`[Event "Ch \"]"]`);
 *   unescaped inner quotes from lenient exporters fall back to a last-quote
 *   heuristic with the line kept lenient and byte-preserved.
 * - Tagless files split on standalone termination markers at variation
 *   depth 0; comments and whitespace after a terminator stay attached to
 *   the finished game.
 * - `%` is an escape only at true column 0, outside comments.
 * - Games own their interior bytes only; separator whitespace between games
 *   belongs to gap spans so spans tile the file exactly. Within a game span,
 *   emitted tokens/tag-lines/ws runs tile the span.
 */

/** Movetext token types. WORD subclassification happens in the CST parser. */
export const TOK = {
  WS: 0,
  WORD: 1,
  COMMENT_BRACE: 2,
  COMMENT_SEMI: 3,
  NAG: 4,
  RAV_OPEN: 5,
  RAV_CLOSE: 6,
  RESULT: 7,
  ESCAPE_LINE: 8,
} as const;
export type TokType = (typeof TOK)[keyof typeof TOK];

export const GFLAG = {
  MISSING_TERMINATOR: 1 << 0,
  UNTERMINATED_COMMENT: 1 << 1,
  RESYNCED: 1 << 2,
  NONSTANDARD_RESULT: 1 << 3,
  CONTENT_AFTER_TERMINATOR: 1 << 4,
  MALFORMED_TAGS: 1 << 5,
  UNCLOSED_RAV: 1 << 6,
  ORPHAN_RAV_CLOSE: 1 << 7,
  /** Variation nesting beyond the CST depth cap: parens past the cap are
   *  kept as flat inert tokens (lossless), the game is read-only. Set by the
   *  CST builder, not the scanner. */
  DEPTH_CAPPED: 1 << 8,
} as const;

export interface TagPairRange {
  nameStart: number;
  nameEnd: number;
  /** Raw (still-escaped) value bytes, quotes excluded. */
  valueStart: number;
  valueEnd: number;
}

export interface ScanSink {
  onGameStart(start: number): void;
  /** One header line (may hold several pairs; a malformed line arrives with
   *  strict=false and whatever pairs the lenient parse recovered — possibly
   *  none — and is preserved whole by its line bytes). */
  onTagLine(
    lineStart: number,
    lineEnd: number,
    pairs: TagPairRange[],
    strict: boolean,
  ): void;
  /** Fires once per game when its first movetext byte is reached (never for
   *  header-only games). */
  onMovetextStart?(offset: number): void;
  /** Movetext tokens in document order, whitespace runs included; only
   *  called when opts.emitTokens. Tag-section interior whitespace/EOLs also
   *  arrive here as WS tokens so a game's elements tile its span. */
  onToken?(type: TokType, start: number, end: number): void;
  onGameEnd(
    contentEnd: number,
    flags: number,
    result: { start: number; end: number } | null,
  ): void;
}

export interface ScanOptions {
  emitTokens?: boolean;
}

const B_LF = 0x0a;
const B_CR = 0x0d;
const B_SP = 0x20;
const B_TAB = 0x09;
const B_VT = 0x0b;
const B_FF = 0x0c;
const B_LBRACKET = 0x5b;
const B_RBRACKET = 0x5d;
const B_LBRACE = 0x7b;
const B_RBRACE = 0x7d;
const B_LPAREN = 0x28;
const B_RPAREN = 0x29;
const B_SEMI = 0x3b;
const B_QUOTE = 0x22;
const B_BACKSLASH = 0x5c;
const B_PERCENT = 0x25;
const B_DOLLAR = 0x24;

const isEol = (b: number): boolean => b === B_LF || b === B_CR;
// 0x1A: DOS ^Z end-of-file marker, present at the tail of CP/M-era
// collections — whitespace so it lands in gap/trailing spans instead of
// flagging the last game (bytes still round-trip via ws slices).
const isInlineWs = (b: number): boolean =>
  b === B_SP || b === B_TAB || b === B_VT || b === B_FF || b === 0x1a;
const isWsByte = (b: number): boolean => isInlineWs(b) || isEol(b);

/** NBSP: C2 A0 in UTF-8, lone A0 in windows-1252. A word delimiter either
 *  way — web-pasted movetext uses it between move number and SAN. */
function nbspLen(buf: Uint8Array, i: number): number {
  const b = buf[i];
  if (b === 0xc2 && buf[i + 1] === 0xa0) return 2;
  if (b === 0xa0) return 1;
  return 0;
}

const isTagNameByte = (b: number): boolean =>
  (b >= 0x41 && b <= 0x5a) ||
  (b >= 0x61 && b <= 0x7a) ||
  (b >= 0x30 && b <= 0x39) ||
  b === 0x5f /* _ */ ||
  b === 0x2d /* - */ ||
  b === 0x2e; /* . */

function lineEndFrom(buf: Uint8Array, i: number, end: number): number {
  while (i < end && !isEol(buf[i]!)) i++;
  return i;
}

function eolLen(buf: Uint8Array, i: number, end: number): number {
  if (i >= end) return 0;
  if (buf[i] === B_CR) return i + 1 < end && buf[i + 1] === B_LF ? 2 : 1;
  if (buf[i] === B_LF) return 1;
  return 0;
}

function isBlankRange(buf: Uint8Array, start: number, contentEnd: number): boolean {
  let i = start;
  while (i < contentEnd) {
    const n = nbspLen(buf, i);
    if (n > 0) {
      i += n;
      continue;
    }
    if (!isInlineWs(buf[i]!)) return false;
    i++;
  }
  return true;
}

export interface TagLineParse {
  pairs: TagPairRange[];
  strict: boolean;
}

/**
 * Try to read the line at [start, contentEnd) as one-or-more tag pairs.
 * Returns null when the line is not tag-shaped at all (then it is movetext).
 * strict = every pair fully well-formed with only whitespace between/after.
 */
export function parseTagLine(
  buf: Uint8Array,
  start: number,
  contentEnd: number,
): TagLineParse | null {
  let i = start;
  // UTF-8 BOMs glued to a tag line mid-file (`cat a.pgn b.pgn` with BOM'd
  // inputs — doubled BOMs occur when both had one) must not demote the line
  // to movetext, or the previous game silently absorbs the entire next
  // game. NBSP indentation (web-pasted PGN) gets the same tolerance the
  // movetext tokenizer already has. Bytes stay in the line, preserved.
  for (;;) {
    if (
      i + 3 <= contentEnd &&
      buf[i] === 0xef &&
      buf[i + 1] === 0xbb &&
      buf[i + 2] === 0xbf
    ) {
      i += 3;
      continue;
    }
    const nb = nbspLen(buf, i);
    if (nb > 0 && i + nb <= contentEnd) {
      i += nb;
      continue;
    }
    if (i < contentEnd && isInlineWs(buf[i]!)) {
      i++;
      continue;
    }
    break;
  }
  if (i >= contentEnd || buf[i] !== B_LBRACKET) return null;
  // The name may be separated from '[' by whitespace ('[ Event "..." ]').
  // The immediate-next-byte check is what keeps '[%clk ...]' lines (wrapped
  // comment content) and stray '[' movetext out.
  let n = i + 1;
  while (n < contentEnd && isInlineWs(buf[n]!)) n++;
  if (n >= contentEnd || !isTagNameByte(buf[n]!)) return null;

  const pairs: TagPairRange[] = [];
  let strict = true;

  scan: while (i < contentEnd) {
    while (i < contentEnd && isInlineWs(buf[i]!)) i++;
    if (i >= contentEnd) break;
    if (buf[i] === B_SEMI) {
      strict = false; // trailing rest-of-line comment after the pairs
      break;
    }
    if (buf[i] !== B_LBRACKET) {
      strict = false;
      break;
    }
    i++;
    while (i < contentEnd && isInlineWs(buf[i]!)) i++;
    const nameStart = i;
    while (i < contentEnd && isTagNameByte(buf[i]!)) i++;
    const nameEnd = i;
    if (nameEnd === nameStart) {
      strict = false;
      break;
    }
    while (i < contentEnd && isInlineWs(buf[i]!)) i++;
    if (i >= contentEnd || buf[i] !== B_QUOTE) {
      strict = false;
      break;
    }
    i++;
    const valueStart = i;
    let closed = false;
    while (i < contentEnd) {
      const b = buf[i]!;
      if (b === B_BACKSLASH && i + 1 < contentEnd) {
        i += 2;
        continue;
      }
      if (b === B_QUOTE) {
        closed = true;
        break;
      }
      i++;
    }
    if (!closed) {
      strict = false;
      break;
    }
    let valueEnd = i;
    i++;
    while (i < contentEnd && isInlineWs(buf[i]!)) i++;
    if (i >= contentEnd || buf[i] !== B_RBRACKET) {
      // Unescaped inner quote from a lenient exporter: last-quote heuristic
      // for this pair, line demoted to lenient, bytes preserved by the caller.
      strict = false;
      for (let j = contentEnd - 1; j > valueStart; j--) {
        if (buf[j] === B_QUOTE) {
          valueEnd = j;
          break;
        }
      }
      pairs.push({ nameStart, nameEnd, valueStart, valueEnd });
      break scan;
    }
    i++;
    pairs.push({ nameStart, nameEnd, valueStart, valueEnd });
  }

  if (pairs.length === 0) {
    // Tag-shaped opener but nothing recoverable: still a header line if it
    // at least ends with ']' — malformed, preserved whole. Otherwise it is
    // movetext.
    let j = contentEnd - 1;
    while (j > start && isInlineWs(buf[j]!)) j--;
    if (j > start && buf[j] === B_RBRACKET) return { pairs: [], strict: false };
    return null;
  }
  return { pairs, strict };
}

export interface ResultShape {
  standard: boolean;
}

export function classifyResultWord(
  buf: Uint8Array,
  start: number,
  end: number,
): ResultShape | null {
  const len = end - start;
  const at = (k: number): number => buf[start + k]!;
  if (len === 1 && at(0) === 0x2a) return { standard: true }; // *
  if (len === 3 && at(1) === 0x2d &&
      ((at(0) === 0x31 && at(2) === 0x30) || (at(0) === 0x30 && at(2) === 0x31)))
    return { standard: true }; // 1-0 / 0-1
  if (len === 7) {
    // 1/2-1/2 (standard) — but a 7-byte mismatch may still be ½–½ below, so
    // this must not early-return before the en-dash branch.
    const s = "1/2-1/2";
    let match = true;
    for (let k = 0; k < 7; k++) if (at(k) !== s.charCodeAt(k)) match = false;
    if (match) return { standard: true };
  }
  // Tolerated wild variants — preserved verbatim, game flagged: ½-½, 1–0,
  // 0–1, ½–½, bare 1/2.
  if (len === 5 && at(0) === 0xc2 && at(1) === 0xbd && at(2) === 0x2d &&
      at(3) === 0xc2 && at(4) === 0xbd)
    return { standard: false }; // ½-½
  if (len === 5 && at(1) === 0xe2 && at(2) === 0x80 && at(3) === 0x93 &&
      ((at(0) === 0x31 && at(4) === 0x30) || (at(0) === 0x30 && at(4) === 0x31)))
    return { standard: false }; // 1–0 / 0–1 (en dash)
  if (len === 7 && at(0) === 0xc2 && at(1) === 0xbd && at(2) === 0xe2 &&
      at(3) === 0x80 && at(4) === 0x93 && at(5) === 0xc2 && at(6) === 0xbd)
    return { standard: false }; // ½–½ (en dash): C2 BD E2 80 93 C2 BD = 7 bytes
  if (len === 3 && at(0) === 0x31 && at(1) === 0x2f && at(2) === 0x32)
    return { standard: false }; // bare 1/2
  return null;
}

/** Are the next two lines from `pos` strict tag-pair lines? Used only by the
 *  unmatched-brace resync rule. */
function peekTwoStrictTagLines(buf: Uint8Array, pos: number, end: number): boolean {
  // EOLs may only be skipped BEFORE the first line; the second must follow
  // immediately — two consecutive strict tag lines, since a blank line
  // between them is not a header block.
  let i = pos;
  while (i < end && isEol(buf[i]!)) i++;
  for (let n = 0; n < 2; n++) {
    if (i >= end) return false;
    const contentEnd = lineEndFrom(buf, i, end);
    const parsed = parseTagLine(buf, i, contentEnd);
    if (!parsed || !parsed.strict || parsed.pairs.length === 0) return false;
    i = contentEnd + eolLen(buf, contentEnd, end);
  }
  return true;
}

const enum Phase {
  Between,
  Headers,
  Movetext,
}

class Scanner {
  private readonly buf: Uint8Array;
  private readonly end: number;
  private readonly sink: ScanSink;
  private readonly emitTokens: boolean;

  private i = 0;
  private phase: Phase = Phase.Between;
  private gameStart = -1;
  private hasTags = false;
  private flags = 0;
  private lastContentEnd = -1;
  private terminatorSeen = false;
  private resultTok: { start: number; end: number } | null = null;
  private ravDepth = 0;
  private movetextStarted = false;
  /** Start of the pending whitespace run (interior ws is a token; ws at a
   *  game boundary is discarded into the surrounding gap span). */
  private wsRunStart = -1;

  constructor(buf: Uint8Array, sink: ScanSink, opts: ScanOptions) {
    this.buf = buf;
    this.end = buf.length;
    this.sink = sink;
    this.emitTokens = opts.emitTokens === true && sink.onToken !== undefined;
  }

  run(): void {
    const { buf, end } = this;
    // A leading UTF-8 BOM belongs to the preamble span.
    if (end >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) this.i = 3;

    while (this.i < end) this.scanLine();
    this.endGame();
  }

  // ---- token plumbing -----------------------------------------------------

  private tok(type: TokType, s: number, e: number): void {
    if (this.emitTokens && e > s) this.sink.onToken!(type, s, e);
  }

  private noteWs(at: number): void {
    if (this.gameStart >= 0 && this.wsRunStart < 0) this.wsRunStart = at;
  }

  private flushWs(upTo: number): void {
    if (this.wsRunStart >= 0 && upTo > this.wsRunStart)
      this.tok(TOK.WS, this.wsRunStart, upTo);
    this.wsRunStart = -1;
  }

  // ---- game lifecycle -----------------------------------------------------

  private startGame(at: number): void {
    this.gameStart = at;
    this.wsRunStart = -1;
    this.sink.onGameStart(at);
  }

  private endGame(): void {
    if (this.gameStart < 0) return;
    if (this.ravDepth > 0) this.flags |= GFLAG.UNCLOSED_RAV;
    if (this.phase === Phase.Movetext && !this.terminatorSeen)
      this.flags |= GFLAG.MISSING_TERMINATOR;
    this.sink.onGameEnd(this.lastContentEnd, this.flags, this.resultTok);
    this.gameStart = -1;
    this.hasTags = false;
    this.flags = 0;
    this.lastContentEnd = -1;
    this.terminatorSeen = false;
    this.resultTok = null;
    this.ravDepth = 0;
    this.movetextStarted = false;
    this.phase = Phase.Between;
    this.wsRunStart = -1;
  }

  // ---- line dispatch ------------------------------------------------------

  private scanLine(): void {
    const { buf, end } = this;
    const lineStart = this.i;
    const contentEnd = lineEndFrom(buf, lineStart, end);
    const nextLine = contentEnd + eolLen(buf, contentEnd, end);

    // Column-0 escape line — true column 0 only, and never inside a brace
    // comment (brace state never reaches here: comments are consumed whole).
    // After a game's terminator the line belongs to the GAP: stray %-lines
    // between games are separator bytes, and keeping them in-game also
    // exposes them to edit-tail rebuilds, which loses bytes.
    if (buf[lineStart] === B_PERCENT) {
      if (this.gameStart >= 0 && this.terminatorSeen) this.endGame();
      if (this.gameStart >= 0) {
        this.flushWs(lineStart);
        this.tok(TOK.ESCAPE_LINE, lineStart, contentEnd);
        this.lastContentEnd = contentEnd;
        this.noteWs(contentEnd);
      }
      this.i = nextLine;
      return;
    }

    if (isBlankRange(buf, lineStart, contentEnd)) {
      if (this.phase === Phase.Headers) this.phase = Phase.Movetext;
      this.noteWs(lineStart);
      this.i = nextLine;
      return;
    }

    const tagLine = parseTagLine(buf, lineStart, contentEnd);
    if (tagLine) {
      // A BOM glued to a game-starting tag line (`cat` of BOM'd files) is a
      // separator byte: it goes to the gap, never inside the new game's
      // span (a span may not start with a BOM — slice reparse and tag-line
      // edits both depend on it). Inside a header block it stays in-game.
      let bomBytes = 0;
      while (
        buf[lineStart + bomBytes] === 0xef &&
        buf[lineStart + bomBytes + 1] === 0xbb &&
        buf[lineStart + bomBytes + 2] === 0xbf
      )
        bomBytes += 3;
      const startsNewGame =
        this.gameStart < 0 || this.phase === Phase.Movetext;
      const effStart = bomBytes > 0 && startsNewGame ? lineStart + bomBytes : lineStart;
      if (this.phase === Phase.Movetext && this.gameStart >= 0) {
        // A tag line after movetext ends the previous game.
        this.endGame();
      }
      if (this.gameStart < 0) this.startGame(effStart);
      else this.flushWs(effStart); // interior ws between tag lines
      this.phase = Phase.Headers;
      this.hasTags = true;
      if (!tagLine.strict) this.flags |= GFLAG.MALFORMED_TAGS;
      this.sink.onTagLine(effStart, contentEnd, tagLine.pairs, tagLine.strict);
      this.lastContentEnd = contentEnd;
      this.noteWs(contentEnd);
      this.i = nextLine;
      return;
    }

    // Movetext line.
    if (this.gameStart < 0) {
      // The game span starts at the line's first byte so indentation
      // round-trips inside the game (deterministic tiling).
      this.startGame(lineStart);
      this.phase = Phase.Movetext;
      this.movetextStarted = true;
      this.sink.onMovetextStart?.(lineStart);
    } else if (!this.movetextStarted) {
      this.phase = Phase.Movetext;
      this.movetextStarted = true;
      this.sink.onMovetextStart?.(lineStart);
    }
    this.tokenizeMovetext(lineStart);
  }

  /**
   * Tokenize movetext starting at `from` until the end of the current line
   * (multi-line brace comments are consumed whole, moving the line). Leaves
   * this.i at the start of the next line to scan.
   */
  private tokenizeMovetext(from: number): void {
    const { buf, end } = this;
    let p = from;

    while (p < end) {
      const b = buf[p]!;

      const el = eolLen(buf, p, end);
      if (el > 0) {
        this.noteWs(p);
        this.i = p + el;
        return;
      }

      const nb = nbspLen(buf, p);
      if (nb > 0 || isInlineWs(b)) {
        this.noteWs(p);
        p += nb > 0 ? nb : 1;
        continue;
      }

      // Tagless-file splitting: a finished game (standalone terminator seen)
      // followed by a non-comment token starts the next game right here.
      if (this.terminatorSeen && b !== B_LBRACE && b !== B_SEMI) {
        if (!this.hasTags) {
          this.endGame();
          this.startGame(p);
          this.phase = Phase.Movetext;
          this.movetextStarted = true;
          this.sink.onMovetextStart?.(p);
        }
        // Tagged games absorb trailing content, flagged, preserved.
      }

      this.flushWs(p);

      if (b === B_LBRACE) {
        p = this.scanBraceComment(p);
        if (p < 0) return; // game was resynced or comment hit EOF
        continue;
      }
      if (b === B_SEMI) {
        const lineEnd = lineEndFrom(buf, p, end);
        this.tok(TOK.COMMENT_SEMI, p, lineEnd);
        this.lastContentEnd = lineEnd;
        p = lineEnd;
        continue;
      }
      if (b === B_LPAREN) {
        this.tok(TOK.RAV_OPEN, p, p + 1);
        this.ravDepth++;
        this.lastContentEnd = p + 1;
        p++;
        continue;
      }
      if (b === B_RPAREN) {
        if (this.ravDepth === 0) this.flags |= GFLAG.ORPHAN_RAV_CLOSE;
        else this.ravDepth--;
        this.tok(TOK.RAV_CLOSE, p, p + 1);
        this.lastContentEnd = p + 1;
        p++;
        continue;
      }
      if (b === B_DOLLAR) {
        let q = p + 1;
        while (q < end && buf[q]! >= 0x30 && buf[q]! <= 0x39) q++;
        this.tok(q > p + 1 ? TOK.NAG : TOK.WORD, p, q);
        this.lastContentEnd = q;
        p = q;
        continue;
      }
      if (b === B_RBRACE) {
        // Stray close brace outside any comment: punctuation, preserved.
        this.tok(TOK.WORD, p, p + 1);
        this.lastContentEnd = p + 1;
        p++;
        continue;
      }

      // Word token.
      let q = p + 1;
      while (q < end) {
        const wb = buf[q]!;
        if (
          isWsByte(wb) ||
          nbspLen(buf, q) > 0 ||
          wb === B_LBRACE ||
          wb === B_RBRACE ||
          wb === B_SEMI ||
          wb === B_LPAREN ||
          wb === B_RPAREN ||
          wb === B_DOLLAR
        )
          break;
        q++;
      }
      const result = classifyResultWord(buf, p, q);
      if (result && this.ravDepth === 0) {
        this.tok(TOK.RESULT, p, q);
        if (!this.terminatorSeen) {
          this.terminatorSeen = true;
          this.resultTok = { start: p, end: q };
          if (!result.standard) this.flags |= GFLAG.NONSTANDARD_RESULT;
        } else {
          this.flags |= GFLAG.CONTENT_AFTER_TERMINATOR;
        }
      } else {
        this.tok(result ? TOK.RESULT : TOK.WORD, p, q);
        if (this.terminatorSeen && this.hasTags)
          this.flags |= GFLAG.CONTENT_AFTER_TERMINATOR;
      }
      this.lastContentEnd = q;
      p = q;
    }
    this.i = end;
  }

  /**
   * Consume a brace comment starting at `open` (buf[open] === '{'). The
   * first '}' closes it — no nesting. Returns the offset just after '}', or
   * -1 when the scan ended the game (resync / EOF) and this.i was updated.
   */
  private scanBraceComment(open: number): number {
    const { buf, end } = this;
    let q = open + 1;
    while (q < end) {
      const cb = buf[q]!;
      if (cb === B_RBRACE) {
        this.tok(TOK.COMMENT_BRACE, open, q + 1);
        this.lastContentEnd = q + 1;
        return q + 1;
      }
      const el = eolLen(buf, q, end);
      if (el > 0) {
        const lineStart = q + el;
        const lineContentEnd = lineEndFrom(buf, lineStart, end);
        if (
          lineStart < end &&
          isBlankRange(buf, lineStart, lineContentEnd) &&
          peekTwoStrictTagLines(
            buf,
            lineContentEnd + eolLen(buf, lineContentEnd, end),
            end,
          )
        ) {
          // Unmatched '{' resync: close this game at the end of the comment's
          // last content line, flag it, resume at the blank.
          this.tok(TOK.COMMENT_BRACE, open, q);
          this.lastContentEnd = q;
          this.flags |= GFLAG.UNTERMINATED_COMMENT | GFLAG.RESYNCED;
          this.endGame();
          this.i = lineStart;
          return -1;
        }
        q = lineStart;
        continue;
      }
      q++;
    }
    // Unclosed at EOF: token to the trimmed end; trailing ws goes to the
    // trailing span.
    let contentEnd = end;
    while (contentEnd > open + 1 && isWsByte(buf[contentEnd - 1]!)) contentEnd--;
    this.tok(TOK.COMMENT_BRACE, open, contentEnd);
    this.lastContentEnd = contentEnd;
    this.flags |= GFLAG.UNTERMINATED_COMMENT;
    this.endGame();
    this.i = end;
    return -1;
  }
}

export function scanPgn(
  buf: Uint8Array,
  sink: ScanSink,
  opts: ScanOptions = {},
): void {
  new Scanner(buf, sink, opts).run();
}
