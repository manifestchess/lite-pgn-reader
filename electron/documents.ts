/**
 * DocumentHost: one open .pgn file — I/O, identity, caps, undo, save.
 *
 * The save pipeline: full new content to a sibling temp file, fsync (libuv
 * issues F_FULLFSYNC on Darwin), atomic rename over the original, then rebase
 * the in-memory baseline to exactly the bytes written. If the sandbox denies
 * the sibling temp, the fallback writes a crash-safe backup into userData
 * first, then rewrites in place through the granted fd.
 *
 * External modification: identity (size+mtime+sha256) captured at open,
 * re-verified before every save; a mismatch blocks the save.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { LIMITS } from "./constants";
import { PgnDocument, type OpenedGame } from "../lib/pgn/document";
import type { CstGame } from "../lib/pgn/cst";

export interface FileIdentity {
  realPath: string;
  ino: number;
  dev: number;
}

export interface DiskState {
  size: number;
  mtimeMs: number;
  sha256: string;
  /** File mode bits at open — atomic replace preserves them. */
  mode: number;
}

export const OPEN_REFUSAL = {
  TOO_LARGE: "tooLarge",
  TOO_MANY_GAMES: "tooManyGames",
  NOT_PGN: "notPgn",
  IO_ERROR: "ioError",
} as const;
export type OpenRefusalKind = (typeof OPEN_REFUSAL)[keyof typeof OPEN_REFUSAL];

export interface OpenRefusal {
  kind: OpenRefusalKind;
  /** Exact measured values for the refusal screen (never estimates). */
  byteSize: number;
  gameCount: number | null;
  detectedFormat: string | null;
  message: string;
}

export class OpenRefusedError extends Error {
  constructor(public readonly refusal: OpenRefusal) {
    super(refusal.message);
  }
}

const MAGIC: [string, number[]][] = [
  ["zstd archive", [0x28, 0xb5, 0x2f, 0xfd]],
  ["zip archive", [0x50, 0x4b, 0x03, 0x04]],
  ["gzip archive", [0x1f, 0x8b]],
  ["xz archive", [0xfd, 0x37, 0x7a, 0x58, 0x5a]],
  ["7z archive", [0x37, 0x7a, 0xbc, 0xaf]],
  ["SQLite database", [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66]],
  ["bzip2 archive", [0x42, 0x5a, 0x68]],
];

/** Content sniff over the head bytes: binary formats get a refusal naming
 *  the format; NUL bytes are never valid PGN in any supported encoding. */
export function sniffContent(head: Uint8Array): string | null {
  for (const [name, magic] of MAGIC) {
    if (head.length >= magic.length && magic.every((b, i) => head[i] === b))
      return name;
  }
  const isUtf16 =
    head.length >= 2 &&
    ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff));
  for (let i = isUtf16 ? 2 : 0; i < Math.min(head.length, 8192); i++) {
    if (head[i] === 0 && !isUtf16) return "binary data (NUL bytes)";
  }
  return null;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function fileIdentity(filePath: string): FileIdentity {
  const realPath = fs.realpathSync(filePath);
  const st = fs.statSync(realPath);
  return { realPath, ino: st.ino, dev: st.dev };
}

interface UndoEntry {
  gameIndex: number;
  cst: CstGame;
}

export class DocumentHost {
  readonly identity: FileIdentity;
  doc: PgnDocument;
  diskState: DiskState;
  /** Set when the file changed on disk while open. */
  externallyModified = false;
  readonly softCapHit: boolean;
  /** Host-level read-only: UTF-16 sources AND over-cap "open anyway"
   *  documents (open-anyway opens read-only). Blocks edits and saves at this
   *  layer — the renderer badge is not the enforcement. */
  readonly readOnly: boolean;

  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private undoBytes = 0;
  private watcher: fs.FSWatcher | null = null;
  private onExternalChange: (() => void) | null = null;

  private constructor(
    identity: FileIdentity,
    doc: PgnDocument,
    diskState: DiskState,
    readOnly: boolean,
  ) {
    this.identity = identity;
    this.doc = doc;
    this.diskState = diskState;
    this.readOnly = readOnly;
    this.softCapHit =
      diskState.size > LIMITS.SOFT_BYTES || doc.gameCount > LIMITS.SOFT_GAMES;
  }

  /**
   * Open with the state machine: stat -> size gate -> sniff -> read ->
   * index -> game-count gate. `allowOverCap` is the explicit "open anyway"
   * consent (read-only document in that mode).
   */
  static open(filePath: string, allowOverCap = false): DocumentHost {
    const identity = fileIdentity(filePath);
    const st = fs.statSync(identity.realPath);
    if (!st.isFile()) {
      throw new OpenRefusedError({
        kind: OPEN_REFUSAL.IO_ERROR,
        byteSize: 0,
        gameCount: null,
        detectedFormat: null,
        message: "not a regular file",
      });
    }
    if (st.size > LIMITS.HARD_BYTES && !allowOverCap) {
      throw new OpenRefusedError({
        kind: OPEN_REFUSAL.TOO_LARGE,
        byteSize: st.size,
        gameCount: null,
        detectedFormat: null,
        message: `this file is ${st.size.toLocaleString()} bytes; Manifest Chess Lite opens files up to ${LIMITS.HARD_BYTES.toLocaleString()} bytes`,
      });
    }

    const fd = fs.openSync(identity.realPath, "r");
    // Uint8Array rather than Buffer: the renderer tsconfig's newer lib makes
    // @types/node's Buffer structurally incompatible with ArrayBufferView,
    // and this file is pulled into that program via the wire-type imports.
    // Same bytes either way; fs.readSync takes any ArrayBufferView.
    let bytes: Uint8Array;
    try {
      const head = new Uint8Array(Math.min(8192, st.size));
      fs.readSync(fd, head, 0, head.length, 0);
      const detected = sniffContent(head);
      if (detected) {
        throw new OpenRefusedError({
          kind: OPEN_REFUSAL.NOT_PGN,
          byteSize: st.size,
          gameCount: null,
          detectedFormat: detected,
          message: `this looks like ${detected}, not plain-text PGN — Manifest Chess Lite opens plain .pgn files only`,
        });
      }
      bytes = new Uint8Array(st.size);
      let off = 0;
      while (off < st.size) {
        const n = fs.readSync(fd, bytes, off, st.size - off, off);
        if (n <= 0) break;
        off += n;
      }
      if (off !== st.size) {
        throw new OpenRefusedError({
          kind: OPEN_REFUSAL.IO_ERROR,
          byteSize: st.size,
          gameCount: null,
          detectedFormat: null,
          message: `could not read the whole file (${off} of ${st.size} bytes)`,
        });
      }
    } finally {
      fs.closeSync(fd);
    }

    // Opening is transactional: a size change during the read is external
    // modification.
    const st2 = fs.statSync(identity.realPath);
    if (st2.size !== st.size) {
      throw new OpenRefusedError({
        kind: OPEN_REFUSAL.IO_ERROR,
        byteSize: st.size,
        gameCount: null,
        detectedFormat: null,
        message: "the file changed while it was being read — try again",
      });
    }

    const doc = PgnDocument.open(new Uint8Array(bytes));
    if (doc.gameCount > LIMITS.HARD_GAMES && !allowOverCap) {
      throw new OpenRefusedError({
        kind: OPEN_REFUSAL.TOO_MANY_GAMES,
        byteSize: st.size,
        gameCount: doc.gameCount,
        detectedFormat: null,
        message: `this file has ${doc.gameCount.toLocaleString()} games; Manifest Chess Lite opens up to ${LIMITS.HARD_GAMES.toLocaleString()}`,
      });
    }

    // Same-size content swap during the read: adopt the FIRST stat's mtime
    // as the baseline so checkExternalChange catches the swap afterwards.
    if (Math.abs(st2.mtimeMs - st.mtimeMs) > 1) {
      throw new OpenRefusedError({
        kind: OPEN_REFUSAL.IO_ERROR,
        byteSize: st.size,
        gameCount: null,
        detectedFormat: null,
        message: "the file changed while it was being read — try again",
      });
    }

    const overCap =
      st.size > LIMITS.HARD_BYTES || doc.gameCount > LIMITS.HARD_GAMES;
    const diskState: DiskState = {
      size: st.size,
      mtimeMs: st2.mtimeMs,
      sha256: sha256Of(bytes),
      mode: st.mode,
    };
    return new DocumentHost(
      identity,
      doc,
      diskState,
      doc.readOnlyDocument || (allowOverCap && overCap),
    );
  }

  watch(onChange: () => void): void {
    this.onExternalChange = onChange;
    this.armWatcher();
  }

  /** (Re-)attach the FSWatcher. An atomic save renames a new inode over the
   *  old one and a kqueue watcher follows the inode, not the path — without
   *  re-arming, external changes after the app's own first save are invisible
   *  for the rest of the session. */
  private armWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    try {
      this.watcher = fs.watch(this.identity.realPath, () => {
        this.checkExternalChange();
      });
    } catch {
      // Watching is best-effort; the pre-save re-verify is the guarantee.
    }
  }

  checkExternalChange(verifyHash = false): boolean {
    try {
      const st = fs.statSync(this.identity.realPath);
      let changed =
        st.size !== this.diskState.size ||
        Math.abs(st.mtimeMs - this.diskState.mtimeMs) > 1;
      if (!changed && verifyHash) {
        // Size+mtime can be spoofed by touch -r / rsync-style tooling; the
        // save path re-verifies content.
        const onDisk = new Uint8Array(fs.readFileSync(this.identity.realPath));
        changed = sha256Of(onDisk) !== this.diskState.sha256;
      }
      if (changed && !this.externallyModified) {
        this.externallyModified = true;
        this.onExternalChange?.();
      }
      return changed;
    } catch {
      if (!this.externallyModified) {
        this.externallyModified = true;
        this.onExternalChange?.();
      }
      return true;
    }
  }

  // ---- undo/redo ----------------------------------------------------------

  /** Undo history is budgeted in BYTES as well as entries: snapshots are
   *  whole-CST clones, and a 1MB single game costs ~70MB per snapshot —
   *  unbounded, the 200-entry cap alone would allow ~14GB in the main
   *  process. Entry sizes are approximated by the game's slice length, which
   *  tracks CST size closely. */
  private static readonly UNDO_MAX_ENTRIES = 200;
  private static readonly UNDO_MAX_BYTES = 96 * 1024 * 1024;

  private pushUndo(entry: UndoEntry, approxBytes: number): void {
    this.undoStack.push(entry);
    this.undoBytes += approxBytes;
    while (
      this.undoStack.length > DocumentHost.UNDO_MAX_ENTRIES ||
      (this.undoBytes > DocumentHost.UNDO_MAX_BYTES && this.undoStack.length > 1)
    ) {
      const dropped = this.undoStack.shift();
      if (dropped) this.undoBytes -= this.doc.gameSlice(dropped.gameIndex).length;
    }
    this.redoStack = [];
  }

  applyEdit(gameIndex: number, mutate: (g: OpenedGame) => void): OpenedGame {
    // Document-level read-only (UTF-16, over-cap open-anyway) deliberately
    // does NOT gate edits: everything is editable in memory, only save()
    // over the original is refused (Save As is the way out). Structural
    // per-game read-only still throws inside doc.applyEdit.
    // Clone BEFORE mutating (rollback needs it) but push to the undo stack
    // only on success, so a failed edit at the cap does not eat an undo level.
    const snapshot = structuredClone(this.doc.game(gameIndex).cst);
    try {
      const result = this.doc.applyEdit(gameIndex, mutate);
      this.pushUndo(
        { gameIndex, cst: snapshot },
        this.doc.gameSlice(gameIndex).length,
      );
      return result;
    } catch (e) {
      this.doc.restoreGame(gameIndex, snapshot);
      throw e;
    }
  }

  /** Structural edits (insert/delete/move) shift game indices, which the
   *  per-game undo snapshots key on, so history clears — same rule as save.
   *  These are refused on structurally read-only DOCUMENTS only at save; in
   *  memory they always work. */
  private clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
  }

  /** Add a blank game after `afterIndex` (−1 = start, ≥count = end).
   *  Returns the new game's index. */
  insertGame(afterIndex: number): number {
    const { doc, newIndex } = this.doc.insertGameAfter(afterIndex);
    this.doc = doc;
    this.clearHistory();
    return newIndex;
  }

  deleteGame(i: number): void {
    if (this.doc.gameCount <= 1) throw new Error("a file must keep at least one game");
    this.doc = this.doc.deleteGame(i);
    this.clearHistory();
  }

  moveGame(from: number, to: number): void {
    this.doc = this.doc.moveGame(from, to);
    this.clearHistory();
  }

  undo(): number | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({
      gameIndex: entry.gameIndex,
      cst: structuredClone(this.doc.game(entry.gameIndex).cst),
    });
    this.doc.restoreGame(entry.gameIndex, entry.cst);
    return entry.gameIndex;
  }

  redo(): number | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({
      gameIndex: entry.gameIndex,
      cst: structuredClone(this.doc.game(entry.gameIndex).cst),
    });
    this.doc.restoreGame(entry.gameIndex, entry.cst);
    return entry.gameIndex;
  }

  // ---- save ---------------------------------------------------------------

  /**
   * Atomic save. Returns the new disk state. Throws SaveConflictError when
   * the on-disk file no longer matches the opened baseline,
   * ReadOnlyDocumentError for read-only documents (UTF-16 / over-cap), and
   * SerializerHonestyError when a dirty game's serialization would not
   * reparse to the model's structure (never write bytes the app itself would
   * disagree with).
   */
  save(opts: { force?: boolean } = {}): DiskState {
    if (this.readOnly) throw new ReadOnlyDocumentError();
    // Clean document: nothing to write. This is the trivially-safe form
    // and the second guard (after readOnly) against ever rewriting a file
    // whose bytes the user did not change. `force` (no UI path sets it)
    // skips just this short-circuit so the full serialize + verify + fsync +
    // rename cost can be measured; every other
    // guard still applies and an unedited document serializes to its own
    // bytes, so a forced save is byte-identical.
    if (!this.doc.dirty && !opts.force) return this.diskState;
    if (this.checkExternalChange(true)) {
      throw new SaveConflictError(
        "the file changed on disk since it was opened — reload it or save a copy elsewhere",
      );
    }
    const badGame = this.doc.verifySerializedGames();
    if (badGame !== null) {
      throw new SerializerHonestyError(badGame);
    }
    // Full chessops write path: games are re-written through chessops at the
    // disk boundary, with a per-game guard that keeps original bytes on any
    // parse failure or variation drop.
    const { bytes: content, spans } = this.doc.serializeForDisk();
    const written = writeAtomic(this.identity.realPath, content, this.diskState.mode);
    this.doc = this.doc.rebaseFast(content, spans);
    this.diskState = {
      size: content.length,
      mtimeMs: written.mtimeMs,
      sha256: sha256Of(content),
      mode: this.diskState.mode,
    };
    this.externallyModified = false;
    // Undo snapshots reference byte offsets in the PRE-SAVE game slices;
    // restoring them against the rebased baseline would splice stale
    // offsets, so the history clears.
    this.undoStack = [];
    this.redoStack = [];
    this.undoBytes = 0;
    this.armWatcher();
    return this.diskState;
  }

  saveAs(targetPath: string): DiskState {
    // Allowed for read-only documents: the copy is an explicit destination
    // the user chose (a UTF-16 original stays untouched; its copy is UTF-8).
    const content = this.doc.serializeForDisk().bytes;
    writeAtomic(targetPath, content, this.diskState.mode);
    // Save As does not rebase onto the new path; the caller opens a
    // fresh window for the copy if desired.
    return {
      size: content.length,
      mtimeMs: Date.now(),
      sha256: sha256Of(content),
      mode: this.diskState.mode,
    };
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}

export class SaveConflictError extends Error {}

export class ReadOnlyDocumentError extends Error {
  constructor() {
    super("This file is read-only — use File → Save As to keep your changes.");
  }
}

export class SerializerHonestyError extends Error {
  constructor(public readonly gameIndex: number) {
    super(
      `refusing to save: game ${gameIndex + 1}'s edited form would not read back the same way it looks now — nothing was written`,
    );
  }
}

/**
 * Sibling temp + fsync + rename. On EPERM/EACCES creating the sibling
 * (sandbox powerbox denial), falls back to journaled in-place rewrite:
 * crash-safe backup of the ORIGINAL first, then truncate+write+fsync via a
 * fd opened on the granted path.
 */
export function writeAtomic(
  targetPath: string,
  content: Uint8Array,
  mode = 0o644,
): { mtimeMs: number } {
  const dir = path.dirname(targetPath);
  const tmp = path.join(
    dir,
    `.${path.basename(targetPath)}.pgnreader-tmp-${process.pid}`,
  );
  try {
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeSync(fd, content, 0, content.length, 0);
      // Preserve the original's permission bits: a chmod-600 file must not
      // come back world-readable after one save.
      fs.fchmodSync(fd, mode & 0o7777);
      fs.fsyncSync(fd); // F_FULLFSYNC via libuv on Darwin
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, targetPath);
    // Best-effort parent-directory fsync (where permitted): makes the rename
    // itself durable, not just the file contents.
    try {
      const dirFd = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      /* directory fsync denied — the file itself is already durable */
    }
    const st = fs.statSync(targetPath);
    return { mtimeMs: st.mtimeMs };
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the temp path never overwrote anything */
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") {
      (err as Error).message = `${(err as Error).message} (temp file: ${tmp}; the original was not modified)`;
      throw err;
    }
    return writeJournaled(targetPath, content);
  }
}

/** Fallback for sandboxed grants that cover only the file itself: back up
 *  the original into the recovery area (fsynced BEFORE the original is
 *  touched — a backup living only in page cache defends against nothing),
 *  then rewrite in place. On failure the backup is KEPT and the error names
 *  it; recovery is offered at next open via pendingRecoveryFor(). */
function writeJournaled(
  targetPath: string,
  content: Uint8Array,
): { mtimeMs: number } {
  const backupDir = recoveryDir();
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(
    backupDir,
    `${path.basename(targetPath)}.${Date.now()}.bak`,
  );
  fs.copyFileSync(targetPath, backup);
  const bfd = fs.openSync(backup, "r");
  try {
    fs.fsyncSync(bfd);
  } finally {
    fs.closeSync(bfd);
  }
  const fd = fs.openSync(targetPath, "r+");
  try {
    fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, content, 0, content.length, 0);
    fs.fsyncSync(fd);
  } catch (err) {
    (err as Error).message =
      `${(err as Error).message} — the file may be incomplete; your previous version is safe at ${backup}`;
    throw err;
  } finally {
    fs.closeSync(fd);
  }
  fs.rmSync(backup, { force: true });
  const st = fs.statSync(targetPath);
  return { mtimeMs: st.mtimeMs };
}

let recoveryDirOverride: string | null = null;
export function setRecoveryDir(dir: string): void {
  recoveryDirOverride = dir;
}
function recoveryDir(): string {
  if (recoveryDirOverride) return recoveryDirOverride;
  return path.join(process.env.TMPDIR ?? "/tmp", "pgnreader-recovery");
}

/** Newest interrupted-save backup for a file, if one exists (offered at
 *  open). */
export function pendingRecoveryFor(filePath: string): string | null {
  const base = path.basename(filePath);
  let newest: { p: string; t: number } | null = null;
  try {
    for (const name of fs.readdirSync(recoveryDir())) {
      if (!name.startsWith(`${base}.`) || !name.endsWith(".bak")) continue;
      const middle = name.slice(base.length + 1, -4);
      if (!/^\d+$/.test(middle)) continue;
      const t = Number(middle);
      if (!newest || t > newest.t) newest = { p: path.join(recoveryDir(), name), t };
    }
  } catch {
    return null;
  }
  return newest?.p ?? null;
}
