/**
 * The in-memory document: one immutable source buffer, the span index, a
 * small cache of parsed games, per-game edit state, and whole-file assembly.
 *
 * Pure model — no filesystem. The Electron layer owns I/O (atomic save,
 * external-change detection, identity); tests exercise this directly.
 *
 * Lifecycle contract: after a successful save the caller invokes
 * rebase(bytesJustWritten); the buffer is replaced, spans re-derived, edit
 * flags cleared. Stale-range corruption cannot arise because nothing else
 * ever mutates the buffer.
 */

import {
  decodeSlice,
  detectEncoding,
  encodeText,
  PGN_ENCODING,
  type EncodingDetection,
  type PgnEncoding,
} from "./encoding";
import { indexPgn, verifyTiling, type GameEntry, type PgnIndex } from "./index";
import {
  parseGameCst,
  serializeCstToBytes,
  WORD_CLS,
  type CstGame,
  type MtItem,
} from "./cst";
import { buildSemantics, type SemGame } from "./semantics";
import { GFLAG } from "./scan";
import { parsePgn, makePgn } from "chessops/pgn";

/** Re-write one game's PGN text through chessops, the write-path format
 *  authority. No fidelity guard: chessops may reformat rare edge-case
 *  variations, and that reformatting is accepted. The only fallback is a
 *  hard parse/make EXCEPTION — not a guard, just refusing to write
 *  `undefined` if chessops throws. */
/** The seven tags chessops seeds with "?" defaults at parse time. These are
 *  the ONLY keys makePgn can inject, so they are the only keys ever eligible
 *  for removal — any other header in game.headers genuinely came from the
 *  file and must never be dropped. */
const SEVEN_TAG_ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];

/** Tag names present in the source's HEADER block, mirroring how chessops
 *  reads headers: the leading run of physical lines that are wholly tag pairs
 *  (several pairs may share a line), stopping at the first non-tag line. That
 *  boundary matters — a `[Tag "..."]`-shaped line inside a movetext comment
 *  must NOT count, or we would keep a seeded STR default the file never had.
 *  The name class matches chessops (allows -+#=:), so no real header is
 *  missed on a shared line. */
function sourceHeaderNames(text: string): Set<string> {
  const names = new Set<string>();
  const tag = /^[ \t]*\[[ \t]*([A-Za-z0-9][A-Za-z0-9_+#=:-]*)[ \t]+"(?:[^"\\]|\\.)*"[ \t]*\]/;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    let matchedAny = false;
    for (;;) {
      const m = tag.exec(line);
      if (!m) break;
      names.add(m[1]!);
      matchedAny = true;
      line = line.slice(m[0].length);
    }
    if (!matchedAny) break; // first non-header line: the header block ends here
  }
  return names;
}

function chessopsRewrite(gameText: string): string | null {
  try {
    const game = parsePgn(gameText)[0];
    if (!game) return null;
    // chessops seeds the Seven Tag Roster with "?" defaults at parse time, so
    // makePgn would otherwise write [White "?"], [Date "????.??.??"] etc. into
    // files that never carried them (study and repertoire exports often omit
    // players) — a "what goes in comes out" violation. Remove only those seven
    // keys, and only when the source's header block did not actually carry
    // them; every other header is left exactly as chessops parsed it.
    const present = sourceHeaderNames(gameText);
    for (const key of SEVEN_TAG_ROSTER) {
      if (!present.has(key)) game.headers.delete(key);
    }
    return makePgn(game);
  } catch {
    return null;
  }
}

/** Flags that make a game read-only: its CST contains (or may contain)
 *  regions whose byte meaning an edit could corrupt. */
const READONLY_FLAGS =
  GFLAG.UNTERMINATED_COMMENT |
  GFLAG.RESYNCED |
  GFLAG.UNCLOSED_RAV |
  GFLAG.ORPHAN_RAV_CLOSE |
  GFLAG.DEPTH_CAPPED;

export interface OpenedGame {
  cst: CstGame;
  sem: SemGame;
  /** Decode any CST leaf to display text. */
  decodeTk: (item: MtItem) => string;
  /** Editing is disabled to protect the bytes (badged in the UI). */
  readOnly: boolean;
  /** Serialization currently differs from the source bytes. */
  dirty: boolean;
  /** Dominant line-ending style of this game's own bytes. */
  eol: string;
}

export class UnencodableEditsError extends Error {
  constructor(public readonly characters: string[]) {
    super(
      `edits contain characters this file's encoding cannot represent: ${characters.join(" ")}`,
    );
  }
}

const PARSE_CACHE_LIMIT = 4;

export class PgnDocument {
  readonly bytes: Uint8Array;
  readonly encoding: PgnEncoding;
  readonly detection: EncodingDetection;
  readonly index: PgnIndex;
  /** UTF-16 sources open read-only over a transcoded buffer. */
  readonly readOnlyDocument: boolean;

  private readonly games = new Map<number, OpenedGame>();
  private readonly parseOrder: number[] = [];
  /** Set when a game was inserted or deleted: the whole document differs
   *  from disk even though no per-game serialization does (byte-identity is
   *  a per-game property; game-count changes are document-level). */
  private structurallyDirty = false;

  private constructor(
    bytes: Uint8Array,
    detection: EncodingDetection,
    index: PgnIndex,
    readOnlyDocument: boolean,
  ) {
    this.bytes = bytes;
    this.detection = detection;
    this.encoding = detection.encoding;
    this.index = index;
    this.readOnlyDocument = readOnlyDocument;
  }

  static open(source: Uint8Array): PgnDocument {
    const detection = detectEncoding(source);
    let bytes = source;
    let readOnly = false;
    if (
      detection.encoding === PGN_ENCODING.UTF16LE ||
      detection.encoding === PGN_ENCODING.UTF16BE
    ) {
      // Transcode for display/indexing; the on-disk bytes stay untouched and
      // the document is read-only until an explicit conversion.
      const text = decodeSlice(source, detection.encoding);
      bytes = new TextEncoder().encode(text.replace(/^﻿/, ""));
      readOnly = true;
    }
    const effective = readOnly
      ? { encoding: PGN_ENCODING.UTF8, bomLength: 0 }
      : detection;
    const index = indexPgn(bytes, effective.encoding);
    const tiling = verifyTiling(index);
    if (!tiling.ok) {
      // Structurally impossible by construction; if it ever fires, refusing
      // to open beats corrupting on save.
      throw new Error(`span tiling violated: ${tiling.reason}`);
    }
    return new PgnDocument(
      bytes,
      readOnly ? { encoding: PGN_ENCODING.UTF8, bomLength: 0 } : detection,
      index,
      readOnly,
    );
  }

  get gameCount(): number {
    return this.index.games.length;
  }

  entry(i: number): GameEntry {
    const g = this.index.games[i];
    if (!g) throw new Error(`no game ${i}`);
    return g;
  }

  gameSlice(i: number): Uint8Array {
    const g = this.entry(i);
    return this.bytes.subarray(g.start, g.end);
  }

  /** Parse (or fetch) a game. Edited games are pinned in the cache. */
  game(i: number): OpenedGame {
    const cached = this.games.get(i);
    if (cached) {
      this.touch(i);
      return cached;
    }
    const g = this.entry(i);
    const slice = this.gameSlice(i);
    const decode = (s: number, e: number): string =>
      decodeSlice(slice.subarray(s, e), this.encoding);
    const { game: cst, coherent } = parseGameCst(slice, decode);
    const decodeTk = (item: MtItem): string => {
      const t = item.k === "rav" ? item.open : item.t;
      return t.src ? decode(t.src.start, t.src.end) : (t.text ?? "");
    };
    const sem = buildSemantics(cst, decodeTk);
    const opened: OpenedGame = {
      cst,
      sem,
      decodeTk,
      // STRUCTURAL only: a game is read-only when it cannot be faithfully
      // re-serialized. Document-level read-only (UTF-16 transcode, over-cap
      // open-anyway) blocks SAVING at the host, never editing — Save As is
      // the way out and converts.
      readOnly:
        !coherent ||
        (g.flags & READONLY_FLAGS) !== 0 ||
        sem.stuck.length > 0 ||
        sem.positionError !== null,
      dirty: false,
      eol: dominantEol(slice),
    };
    this.games.set(i, opened);
    this.touch(i);
    this.evict();
    return opened;
  }

  /**
   * Apply a mutation to game i's CST, rebuild semantics, recompute the dirty
   * flag against the source bytes (edit-then-undo-to-original comes back
   * clean — the belt-and-braces byte check lives in serializeAll too).
   */
  applyEdit(i: number, mutate: (game: OpenedGame) => void): OpenedGame {
    const opened = this.game(i);
    if (opened.readOnly) throw new Error("game is read-only");
    mutate(opened);
    opened.sem = buildSemantics(opened.cst, opened.decodeTk);
    opened.dirty = !this.serializedEqualsSource(i, opened);
    this.syncEntryHeaders(i, opened);
    return opened;
  }

  /** Replace a game's CST wholesale (undo/redo restore). */
  restoreGame(i: number, cst: CstGame): OpenedGame {
    const opened = this.game(i);
    opened.cst = cst;
    opened.sem = buildSemantics(cst, opened.decodeTk);
    opened.dirty = !this.serializedEqualsSource(i, opened);
    this.syncEntryHeaders(i, opened);
    return opened;
  }

  /** Keep the index entry's LIST headers truthful after a tag edit: rows
   *  and the header filter read entry.headers, which were captured at index
   *  time and would otherwise stay stale until the next save+rebase. */
  private syncEntryHeaders(i: number, opened: OpenedGame): void {
    const entry = this.entry(i);
    const t = opened.cst.tags;
    entry.headers = {
      event: t.get("Event"),
      date: t.get("Date"),
      white: t.get("White"),
      black: t.get("Black"),
      whiteElo: t.get("WhiteElo"),
      blackElo: t.get("BlackElo"),
      result: t.get("Result"),
      chapterName: t.get("ChapterName"),
    };
  }


  /** A minimal new game: seven-tag roster with unknown values and a lone
   *  result terminator (the STR, exactly what a fresh game is). */
  static readonly NEW_GAME_TEXT =
    '[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n*';

  /** Re-index `newBytes` in this document's encoding, preserving the
   *  read-only intent, and mark it structurally dirty. Insert/delete route
   *  through here so the full tiling + parse invariants are re-established
   *  by construction rather than patched. */
  private reindexFrom(newBytes: Uint8Array): PgnDocument {
    const index = indexPgn(newBytes, this.encoding);
    const tiling = verifyTiling(index);
    if (!tiling.ok) throw new Error(`span tiling violated: ${tiling.reason}`);
    const next = PgnDocument.fromParts(
      newBytes,
      this.detection,
      index,
      this.readOnlyDocument,
    );
    next.structurallyDirty = true;
    return next;
  }

  private encodedNewGame(): Uint8Array {
    const enc = encodeText(PgnDocument.NEW_GAME_TEXT, this.encoding);
    if (!enc.ok) throw new Error("cannot encode a new game in this file's encoding");
    return enc.bytes;
  }

  private sep(): Uint8Array {
    const enc = encodeText("\n\n", this.encoding);
    return enc.ok ? enc.bytes : new Uint8Array([0x0a, 0x0a]);
  }

  /**
   * New document with a blank game added after `afterIndex` (-1 = before
   * all, ≥count-1 = at the end). Every OTHER game keeps its exact source
   * bytes AND its exact surrounding gaps — only the one new separator is
   * introduced — so insert is the precise inverse of deleting the new game.
   * Returns the new game's index.
   */
  insertGameAfter(afterIndex: number): { doc: PgnDocument; newIndex: number } {
    const { bytes, spans } = this.serializeAllWithSpans();
    const game = this.encodedNewGame();
    const sep = this.sep();
    let merged: Uint8Array;
    let newIndex: number;
    if (spans.length === 0) {
      merged = game;
      newIndex = 0;
    } else if (afterIndex >= spans.length - 1) {
      // After the last game: existing content, SEP, new game, trailing.
      const at = spans[spans.length - 1]!.end;
      merged = concatBytes([bytes.subarray(0, at), sep, game, bytes.subarray(at)]);
      newIndex = spans.length;
    } else {
      // Before game k+1: new game + SEP inserted at that game's start, so
      // deleting the new game removes exactly [newGame, SEP] and restores
      // the original bytes verbatim.
      const k = afterIndex < 0 ? -1 : afterIndex;
      const at = spans[k + 1]!.start;
      merged = concatBytes([bytes.subarray(0, at), game, sep, bytes.subarray(at)]);
      newIndex = k + 1;
    }
    return { doc: this.reindexFrom(merged), newIndex };
  }

  /** New document with game `i` removed. A non-last game takes the gap that
   *  FOLLOWS it; the last game takes the gap that PRECEDES it. Every other
   *  game and gap is preserved byte-for-byte. */
  deleteGame(i: number): PgnDocument {
    const n = this.index.games.length;
    if (i < 0 || i >= n) throw new Error(`no game ${i}`);
    const { bytes, spans } = this.serializeAllWithSpans();
    let from: number;
    let to: number;
    if (i < n - 1) {
      from = spans[i]!.start;
      to = spans[i + 1]!.start; // game + following gap
    } else {
      from = n > 1 ? spans[n - 2]!.end : spans[i]!.start; // preceding gap + game
      to = spans[i]!.end;
    }
    return this.reindexFrom(concatBytes([bytes.subarray(0, from), bytes.subarray(to)]));
  }

  /** New document with game `from` moved to position `to` (indices in the
   *  current order). Every game keeps its exact bytes; only order changes. */
  moveGame(from: number, to: number): PgnDocument {
    const n = this.index.games.length;
    if (from < 0 || from >= n || to < 0 || to >= n) throw new Error("move out of range");
    if (from === to) return this;
    const { bytes, spans } = this.serializeAllWithSpans();
    // Positional-gap model: the gaps are fixed connective tissue between
    // slots; only the GAMES shuffle between them. Every gap (including
    // exotic multi-blank-line ones) is preserved verbatim, every game's
    // bytes are preserved verbatim, and move(a,b) then move(b,a) is exactly
    // the identity.
    const preamble = bytes.subarray(0, spans[0]!.start);
    const games: Uint8Array[] = spans.map((s) => bytes.subarray(s.start, s.end));
    const gaps: Uint8Array[] = [];
    for (let i = 0; i < n - 1; i++) gaps.push(bytes.subarray(spans[i]!.end, spans[i + 1]!.start));
    const trailing = bytes.subarray(spans[n - 1]!.end);
    const [moved] = games.splice(from, 1);
    games.splice(to, 0, moved!);
    const parts: Uint8Array[] = [preamble];
    for (let i = 0; i < games.length; i++) {
      if (i > 0) parts.push(gaps[i - 1]!); // gap in its fixed slot
      parts.push(games[i]!);
    }
    parts.push(trailing);
    return this.reindexFrom(concatBytes(parts));
  }

  get dirty(): boolean {
    if (this.structurallyDirty) return true;
    for (const g of this.games.values()) if (g.dirty) return true;
    return false;
  }

  dirtyGameIndices(): number[] {
    const out: number[] = [];
    for (const [i, g] of this.games.entries()) if (g.dirty) out.push(i);
    return out.sort((a, b) => a - b);
  }

  /**
   * The bytes to WRITE to disk: the byte-preserving serialization, then
   * every game re-written through chessops (the format authority for
   * output). chessops is byte-identical for the vast majority of games and
   * cosmetically reformats a small fraction.
   *
   * A per-game GUARD keeps original bytes whenever chessops would drop a
   * variation or fail to parse — never lose data. The internal model stays
   * byte-preserving; this pass runs only here, at the write boundary.
   */
  serializeForDisk(): { bytes: Uint8Array; spans: { start: number; end: number; wasDirty: boolean }[] } {
    const src = this.serializeAllWithSpans();
    if (src.spans.length === 0) return src;
    const dec = (b: Uint8Array): string => decodeSlice(b, this.encoding);
    const enc = (s: string): Uint8Array => {
      const r = encodeText(s, this.encoding);
      if (!r.ok) throw new UnencodableEditsError([...new Set(r.unrepresentable)]);
      return r.bytes;
    };
    const chunks: Uint8Array[] = [];
    const spans: { start: number; end: number; wasDirty: boolean }[] = [];
    let out = 0;
    const push = (c: Uint8Array): void => {
      chunks.push(c);
      out += c.length;
    };
    // Preamble.
    push(src.bytes.subarray(0, src.spans[0]!.start));
    for (let i = 0; i < src.spans.length; i++) {
      const s = src.spans[i]!;
      const gameBytes = src.bytes.subarray(s.start, s.end);
      const rewritten = chessopsRewrite(dec(gameBytes));
      const start = out;
      // A game span never includes its trailing newline — the inter-game gap
      // (preserved verbatim below) owns all separator whitespace. makePgn
      // always appends one, so writing it here would insert a blank line
      // between games AND accumulate another on every subsequent save. Strip
      // it so the rewrite occupies exactly the game's own bytes.
      push(rewritten === null ? gameBytes : enc(rewritten.replace(/\n+$/, "")));
      spans.push({ start, end: out, wasDirty: s.wasDirty });
      // Gap to the next game (or trailing after the last).
      const gapFrom = s.end;
      const gapTo = i + 1 < src.spans.length ? src.spans[i + 1]!.start : src.bytes.length;
      push(src.bytes.subarray(gapFrom, gapTo));
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      bytes.set(c, o);
      o += c.length;
    }
    return { bytes, spans };
  }

  serializeGame(i: number, opened: OpenedGame): Uint8Array {
    const slice = this.gameSlice(i);
    const bad: string[] = [];
    const out = serializeCstToBytes(opened.cst, slice, (text) => {
      const r = encodeText(text, this.encoding);
      if (!r.ok) {
        bad.push(...r.unrepresentable);
        return new Uint8Array(0);
      }
      return r.bytes;
    });
    if (bad.length > 0) throw new UnencodableEditsError([...new Set(bad)]);
    return out;
  }

  private serializedEqualsSource(i: number, opened: OpenedGame): boolean {
    const slice = this.gameSlice(i);
    let out: Uint8Array;
    try {
      out = this.serializeGame(i, opened);
    } catch {
      return false;
    }
    if (out.length !== slice.length) return false;
    for (let k = 0; k < out.length; k++) if (out[k] !== slice[k]) return false;
    return true;
  }

  /**
   * Assemble the complete file: preamble + every game (source bytes unless
   * its serialization differs) + gaps + trailing, byte-for-byte.
   */
  serializeAll(): Uint8Array {
    return this.serializeAllWithSpans().bytes;
  }

  /** serializeAll plus each game's span in the OUTPUT (rebase input). */
  serializeAllWithSpans(): {
    bytes: Uint8Array;
    spans: { start: number; end: number; wasDirty: boolean }[];
  } {
    const chunks: Uint8Array[] = [];
    const spans: { start: number; end: number; wasDirty: boolean }[] = [];
    let cursor = 0;
    let outCursor = 0;
    const push = (c: Uint8Array): void => {
      chunks.push(c);
      outCursor += c.length;
    };
    for (let i = 0; i < this.index.games.length; i++) {
      const g = this.index.games[i]!;
      push(this.bytes.subarray(cursor, g.start)); // preamble / gap
      const opened = this.games.get(i);
      const gameStart = outCursor;
      let wasDirty = false;
      if (opened && opened.dirty) {
        const out = this.serializeGame(i, opened);
        // Belt and braces: byte-equal output is written from source.
        if (equalBytes(out, this.gameSlice(i))) {
          push(this.gameSlice(i));
        } else {
          push(out);
          wasDirty = true;
        }
      } else {
        push(this.bytes.subarray(g.start, g.end));
      }
      spans.push({ start: gameStart, end: outCursor, wasDirty });
      cursor = g.end;
    }
    push(this.bytes.subarray(cursor)); // trailing span
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return { bytes: out, spans };
  }

  /**
   * Serializer honesty, checked in the save path: every dirty game's
   * serialization must reparse to the same structure the model holds.
   * Compares a token-level fingerprint (kinds + decoded text + tag lines +
   * RAV nesting). Returns the failing game index or null.
   */
  verifySerializedGames(): number | null {
    for (const [i, opened] of this.games.entries()) {
      if (!opened.dirty) continue;
      let out: Uint8Array;
      try {
        out = this.serializeGame(i, opened);
      } catch {
        return i;
      }
      const decodeNew = (s: number, e: number): string =>
        decodeSlice(out.subarray(s, e), this.encoding);
      const reparsed = parseGameCst(out, decodeNew);
      if (!reparsed.coherent) return i;
      const a = cstFingerprint(opened.cst, opened.decodeTk);
      const b = cstFingerprint(reparsed.game, (item) => {
        const t = item.k === "rav" ? item.open : item.t;
        return t.src ? decodeNew(t.src.start, t.src.end) : (t.text ?? "");
      });
      if (a !== b) return i;
    }
    return null;
  }

  /** After a successful save: the written bytes become the new baseline.
   *  Full re-open re-detects and re-indexes everything; the fast path shifts
   *  the existing span index arithmetically and re-derives entries only for
   *  games that were rewritten. */
  rebase(written: Uint8Array): PgnDocument {
    return PgnDocument.open(written);
  }

  rebaseFast(
    written: Uint8Array,
    spans: { start: number; end: number; wasDirty: boolean }[],
  ): PgnDocument {
    if (spans.length !== this.index.games.length) return PgnDocument.open(written);
    const games: GameEntry[] = [];
    for (let i = 0; i < spans.length; i++) {
      const old = this.index.games[i]!;
      const span = spans[i]!;
      if (!span.wasDirty) {
        games.push({ ...old, start: span.start, end: span.end });
        continue;
      }
      // Rewritten game: re-derive its entry from its own new bytes. The
      // slice must index as exactly one game (its CST was just verified);
      // anything else falls back to the full re-open.
      const slice = written.subarray(span.start, span.end);
      const sub = indexPgn(slice, this.encoding);
      if (sub.games.length !== 1) return PgnDocument.open(written);
      const e = sub.games[0]!;
      games.push({
        ...e,
        start: span.start + e.start,
        end: span.start + e.end,
        result: e.result
          ? { start: span.start + e.result.start, end: span.start + e.result.end }
          : null,
      });
    }
    const index: PgnIndex = {
      games,
      preambleEnd: games.length > 0 ? games[0]!.start : written.length,
      trailingStart: games.length > 0 ? games[games.length - 1]!.end : written.length,
      byteLength: written.length,
    };
    const tiling = verifyTiling(index);
    if (!tiling.ok) return PgnDocument.open(written);
    return PgnDocument.fromParts(written, this.detection, index, this.readOnlyDocument);
  }

  /** Internal fast-path constructor (rebaseFast). */
  static fromParts(
    bytes: Uint8Array,
    detection: EncodingDetection,
    index: PgnIndex,
    readOnlyDocument: boolean,
  ): PgnDocument {
    return new PgnDocument(bytes, detection, index, readOnlyDocument);
  }

  private touch(i: number): void {
    const at = this.parseOrder.indexOf(i);
    if (at >= 0) this.parseOrder.splice(at, 1);
    this.parseOrder.push(i);
  }

  private evict(): void {
    while (this.games.size > PARSE_CACHE_LIMIT) {
      const victim = this.parseOrder.find((i) => {
        const g = this.games.get(i);
        return g !== undefined && !g.dirty;
      });
      if (victim === undefined) return; // everything dirty stays pinned
      this.parseOrder.splice(this.parseOrder.indexOf(victim), 1);
      this.games.delete(victim);
    }
  }
}

/** Token-level structural fingerprint: tag lines (decoded), then the
 *  movetext walk with kinds, decoded text, and rav nesting markers. */
export function cstFingerprint(
  cst: CstGame,
  decodeTk: (item: MtItem) => string,
): string {
  const parts: string[] = [];
  for (const el of cst.header) {
    if (el.k === "tagline") {
      for (const p of el.pairs) parts.push(`T${p.name}=${p.value}`);
    }
  }
  const walk = (items: MtItem[]): void => {
    const stack: { items: MtItem[]; i: number }[] = [{ items, i: 0 }];
    while (stack.length > 0) {
      const f = stack[stack.length - 1]!;
      if (f.i >= f.items.length) {
        stack.pop();
        if (stack.length > 0) parts.push(")");
        continue;
      }
      const it = f.items[f.i]!;
      f.i++;
      switch (it.k) {
        case "ws":
        case "escape":
          break;
        case "word":
          if (it.cls === WORD_CLS.MOVENUM) break;
          parts.push(`w${decodeTk(it)}`);
          break;
        case "nag":
          parts.push(`n${decodeTk(it)}`);
          break;
        case "comment": {
          // Comment CONTENT equality, not byte equality: an edited comment
          // is rebuilt as `{ … }` whose padding is formatting, not content.
          const raw = decodeTk(it);
          const inner =
            it.style === "semi"
              ? raw.replace(/^;/, "")
              : raw.replace(/^\{/, "").replace(/\}$/, "");
          parts.push(`c${inner.trim()}`);
          break;
        }
        case "result":
          parts.push(`r${decodeTk(it)}`);
          break;
        case "rav":
          parts.push("(");
          stack.push({ items: it.items, i: 0 });
          break;
      }
    }
  };
  walk(cst.movetext);
  return parts.join("\u0000");
}

function dominantEol(slice: Uint8Array): string {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0x0a) {
      if (slice[i - 1] === 0x0d) crlf++;
      else lf++;
    }
  }
  return crlf > lf ? "\r\n" : "\n";
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
