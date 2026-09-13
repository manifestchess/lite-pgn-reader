/**
 * IPC surface: one document per window; the sender's WebContents resolves
 * the DocumentHost. Every edit answers with the refreshed WireGame so the
 * renderer never holds stale tree state.
 */

import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import { IPC_DOC, IPC_DOC_EVENT, LIMITS } from "./constants";
import {
  DocumentHost,
  ReadOnlyDocumentError,
  SaveConflictError,
  SerializerHonestyError,
  type OpenRefusal,
} from "./documents";
import {
  addMove,
  deleteFromHere,
  promoteVariation,
  setNodeComment,
  setNodeNags,
  setNodeShapes,
  setResult,
  setTag,
  deleteTag,
  UnrepresentableEditError,
} from "../lib/pgn/edit";
import { UnencodableEditsError } from "../lib/pgn/document";
import { parseFen } from "chessops/fen";
import { decodeSlice } from "../lib/pgn/encoding";
import { chessFromSetup, parseUciMove } from "./chess-bridge";
import { chessgroundMove } from "chessops/compat";
import {
  nodeAtPath,
  packWireGame,
  toWireGame,
  toWireRow,
  type PackedWireGame,
  type WireRow,
} from "./wire";
import { isValidId } from "../lib/shared/path";

export interface DocBinding {
  host: DocumentHost;
  filePath: string;
  window: BrowserWindow;
  /** Per-document UI state (game, path, orientation) for restoration. */
  uiState: Record<string, unknown>;
  refusal: OpenRefusal | null;
  /** Wall-clock ms the open+index took, used to suppress the soft banner
   *  when the open met its budgets. */
  indexMs?: number;
}

const byWebContents = new Map<number, DocBinding>();
const pendingByWebContents = new Map<number, Promise<void>>();

/** The window exists before its DocumentHost does (the open races the
 *  renderer load); early IPC awaits the host. */
export function bindPending(webContentsId: number, ready: Promise<void>): void {
  pendingByWebContents.set(webContentsId, ready.catch(() => undefined));
}

async function mustAsync(event: IpcMainInvokeEvent): Promise<DocBinding> {
  const pending = pendingByWebContents.get(event.sender.id);
  if (pending) await pending;
  return must(event);
}

export function bindDocument(binding: DocBinding): void {
  byWebContents.set(binding.window.webContents.id, binding);
  binding.host.watch(() => {
    binding.window.webContents.send(IPC_DOC_EVENT.EXTERNAL_CHANGE, {});
  });
}

/** Forget a binding by id.
 *
 *  The id has to have been read while the window was still alive. `closed`
 *  fires after destruction, and reaching for `window.webContents` there
 *  throws "Object has been destroyed" from inside an event handler, which
 *  Electron surfaces as an uncaught exception dialog and takes the main
 *  process down with it. */
export function unbindByWebContentsId(id: number): DocBinding | undefined {
  const b = byWebContents.get(id);
  byWebContents.delete(id);
  pendingByWebContents.delete(id);
  return b;
}

/** Safe only while the window lives. On the `closed` path use
 *  unbindByWebContentsId with an id captured at creation. */
export function unbindDocument(window: BrowserWindow): DocBinding | undefined {
  if (window.isDestroyed()) return undefined;
  return unbindByWebContentsId(window.webContents.id);
}

export function bindingFor(window: BrowserWindow): DocBinding | undefined {
  if (window.isDestroyed()) return undefined;
  return byWebContents.get(window.webContents.id);
}

function must(event: IpcMainInvokeEvent): DocBinding {
  const b = byWebContents.get(event.sender.id);
  if (!b) throw new Error("no document bound to this window");
  return b;
}

/** Renderer inputs are untrusted (a compromised renderer must not steer
 *  main-process file surgery): indices must be in-range integers, node ids
 *  well-formed step sequences. */
function gameIndexOf(b: DocBinding, raw: unknown): number {
  const i = typeof raw === "number" ? raw : NaN;
  if (!Number.isInteger(i) || i < 0 || i >= b.host.doc.gameCount)
    throw new Error(`invalid game index`);
  return i;
}

function nodeIdOf(raw: unknown): string {
  const id = typeof raw === "string" ? raw : "";
  if (!isValidId(id)) throw new Error("invalid node id");
  return id;
}

export interface DocSummary {
  filePath: string;
  fileName: string;
  gameCount: number;
  byteSize: number;
  softCapHit: boolean;
  limits: typeof LIMITS;
  dirty: boolean;
  readOnlyDocument: boolean;
  externallyModified: boolean;
  refusal: OpenRefusal | null;
  indexMs: number;
}

function summaryOf(b: DocBinding): DocSummary {
  return {
    filePath: b.filePath,
    fileName: b.filePath.split("/").pop() ?? b.filePath,
    gameCount: b.host.doc.gameCount,
    byteSize: b.host.diskState.size,
    softCapHit: b.host.softCapHit,
    limits: LIMITS,
    dirty: b.host.doc.dirty,
    readOnlyDocument: b.host.readOnly,
    externallyModified: b.host.externallyModified,
    refusal: b.refusal,
    indexMs: b.indexMs ?? 0,
  };
}

function wireGameOf(b: DocBinding, i: number): PackedWireGame {
  const g = b.host.doc.game(i);
  // game.readOnly is STRUCTURAL only (raw/partial games that cannot be
  // reserialized). Document-level read-only (UTF-16, over-cap open-anyway)
  // deliberately does NOT flow in: those documents stay fully editable in
  // memory — only SAVING to the original file is blocked
  // (summary.readOnlyDocument gates that, with Save As as the way out).
  // packed: nested trees overflow the IPC structured clone on long games
  return packWireGame(
    toWireGame(i, g.sem, g.cst.tags, b.host.doc.entry(i), g.readOnly, g.dirty, g.cst.duplicateTagNames),
  );
}

function pushDirty(b: DocBinding): void {
  b.window.webContents.send(IPC_DOC_EVENT.DIRTY_CHANGED, {
    dirty: b.host.doc.dirty,
  });
  b.window.setDocumentEdited(b.host.doc.dirty);
}

/** Wrap an edit so model-layer rejections travel as structured results. */
function editResult(b: DocBinding, i: number, fn: () => void):
  | { ok: true; game: PackedWireGame; dirty: boolean }
  | { ok: false; message: string } {
  try {
    b.host.applyEdit(i, () => fn());
    pushDirty(b);
    return { ok: true, game: wireGameOf(b, i), dirty: b.host.doc.dirty };
  } catch (e) {
    if (e instanceof UnrepresentableEditError || e instanceof UnencodableEditsError) {
      return { ok: false, message: e.message };
    }
    throw e;
  }
}

export function registerDocHandlers(): void {
  ipcMain.handle(IPC_DOC.SUMMARY, async (event) => summaryOf(await mustAsync(event)));

  // The launch path is sensitive to IPC round-trip cost: one call returns
  // everything the first interactive frame needs.
  ipcMain.handle(IPC_DOC.BOOTSTRAP, async (event) => {
    const b = await mustAsync(event);
    const summary = summaryOf(b);
    const rowCount = Math.min(b.host.doc.gameCount, 120);
    const rows: WireRow[] = [];
    for (let i = 0; i < rowCount; i++) rows.push(toWireRow(i, b.host.doc.entry(i)));
    const game =
      summary.refusal === null && b.host.doc.gameCount > 0 ? wireGameOf(b, 0) : null;
    return { summary, rows, game };
  });

  ipcMain.handle(
    IPC_DOC.ROWS,
    async (event, start: number, count: number): Promise<WireRow[]> => {
      const b = await mustAsync(event);
      const end = Math.min(b.host.doc.gameCount, start + count);
      const rows: WireRow[] = [];
      for (let i = Math.max(0, start); i < end; i++) {
        rows.push(toWireRow(i, b.host.doc.entry(i)));
      }
      return rows;
    },
  );

  ipcMain.handle(
    IPC_DOC.ROWS_AT,
    async (event, rawIndices: unknown): Promise<WireRow[]> => {
      const b = await mustAsync(event);
      if (!Array.isArray(rawIndices)) return [];
      const rows: WireRow[] = [];
      // Bounded: the virtualized list never asks for more than a viewport.
      for (const raw of rawIndices.slice(0, 400)) {
        const i = typeof raw === "number" ? Math.trunc(raw) : NaN;
        if (!Number.isFinite(i) || i < 0 || i >= b.host.doc.gameCount) continue;
        rows.push(toWireRow(i, b.host.doc.entry(i)));
      }
      return rows;
    },
  );

  // Search/filter over the already-decoded index headers. Pure metadata —
  // never touches game bytes; a 30k-game sweep is ~ms. Returns matching
  // game indices in file order.
  ipcMain.handle(IPC_DOC.FILTER, async (event, rawQuery: unknown): Promise<number[]> => {
    const b = await mustAsync(event);
    const q = (typeof rawQuery === "object" && rawQuery !== null ? rawQuery : {}) as {
      query?: unknown;
      color?: unknown;
      eloMin?: unknown;
      eloMax?: unknown;
      yearMin?: unknown;
      yearMax?: unknown;
      results?: unknown;
      sortColumn?: unknown;
      sortDir?: unknown;
    };
    const text = typeof q.query === "string" ? q.query.trim().toLowerCase() : "";
    const color = q.color === "white" || q.color === "black" ? q.color : "any";
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const eloMin = num(q.eloMin);
    const eloMax = num(q.eloMax);
    const yearMin = num(q.yearMin);
    const yearMax = num(q.yearMax);
    const results =
      Array.isArray(q.results) && q.results.length > 0
        ? new Set(q.results.filter((r): r is string => typeof r === "string"))
        : null;

    const out: number[] = [];
    const doc = b.host.doc;
    for (let i = 0; i < doc.gameCount; i++) {
      const h = doc.entry(i).headers;
      if (text) {
        const hay =
          color === "white"
            ? (h.white ?? h.chapterName ?? "")
            : color === "black"
              ? (h.black ?? "")
              : `${h.white ?? ""}\n${h.black ?? ""}\n${h.event ?? ""}\n${h.chapterName ?? ""}`;
        if (!hay.toLowerCase().includes(text)) continue;
      }
      if (eloMin !== null || eloMax !== null) {
        const we = h.whiteElo ? parseInt(h.whiteElo, 10) : NaN;
        const be = h.blackElo ? parseInt(h.blackElo, 10) : NaN;
        const inRange = (e: number): boolean =>
          Number.isFinite(e) && (eloMin === null || e >= eloMin) && (eloMax === null || e <= eloMax);
        if (!inRange(we) && !inRange(be)) continue;
      }
      if (yearMin !== null || yearMax !== null) {
        const y = h.date ? parseInt(h.date.slice(0, 4), 10) : NaN;
        if (!Number.isFinite(y)) continue;
        if (yearMin !== null && y < yearMin) continue;
        if (yearMax !== null && y > yearMax) continue;
      }
      if (results && !results.has(h.result ?? "")) continue;
      out.push(i);
    }
    // Optional sort over the matched set (list header clicks). String
    // compare on the decoded header field; empties sort last either way;
    // file order is the tiebreak so sorting is stable across runs.
    const SORTABLE = new Set(["white", "black", "event", "date", "result"]);
    const col = typeof q.sortColumn === "string" && SORTABLE.has(q.sortColumn)
      ? (q.sortColumn as "white" | "black" | "event" | "date" | "result")
      : null;
    if (col) {
      const dir = q.sortDir === "desc" ? -1 : 1;
      const keyOf = (i: number): string => {
        const h = doc.entry(i).headers;
        return (col === "white" ? (h.white ?? h.chapterName) : h[col]) ?? "";
      };
      out.sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka === "" && kb !== "") return 1;
        if (kb === "" && ka !== "") return -1;
        const c = ka.localeCompare(kb);
        return c !== 0 ? c * dir : a - b;
      });
    }
    return out;
  });

  ipcMain.handle(IPC_DOC.INSERT_GAME, async (event, rawAfter: unknown) => {
    const b = await mustAsync(event);
    const after = typeof rawAfter === "number" ? Math.trunc(rawAfter) : b.host.doc.gameCount - 1;
    const newIndex = b.host.insertGame(after);
    pushDirty(b);
    return { ok: true as const, gameCount: b.host.doc.gameCount, newIndex };
  });

  ipcMain.handle(IPC_DOC.DELETE_GAME, async (event, rawI: unknown) => {
    const b = await mustAsync(event);
    const i = gameIndexOf(b, rawI);
    try {
      b.host.deleteGame(i);
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
    pushDirty(b);
    return { ok: true as const, gameCount: b.host.doc.gameCount };
  });

  ipcMain.handle(IPC_DOC.MOVE_GAME, async (event, rawFrom: unknown, rawTo: unknown) => {
    const b = await mustAsync(event);
    const from = gameIndexOf(b, rawFrom);
    const to = gameIndexOf(b, rawTo);
    b.host.moveGame(from, to);
    pushDirty(b);
    return { ok: true as const, gameCount: b.host.doc.gameCount };
  });

  ipcMain.handle(IPC_DOC.GAME, async (event, i: number) => wireGameOf(await mustAsync(event), i));

  ipcMain.handle(IPC_DOC.GAME_TEXT, async (event, rawI: unknown): Promise<string> => {
    const b = await mustAsync(event);
    const i = gameIndexOf(b, rawI);
    const g = b.host.doc.game(i);
    const bytes = g.dirty
      ? b.host.doc.serializeGame(i, g)
      : b.host.doc.gameSlice(i);
    // Decode with the DOCUMENT's encoding — a bare TextDecoder mojibakes
    // every windows-1252 export.
    return decodeSlice(bytes, b.host.doc.encoding);
  });

  ipcMain.handle(
    IPC_DOC.SET_COMMENT,
    async (event, i: number, nodeId: string, prose: string) => {
      const b = await mustAsync(event);
      return editResult(b, i, () => {
        const g = b.host.doc.game(i);
        if (nodeId === "") {
          setRootCommentViaEdit(b, i, prose);
          return;
        }
        const node = nodeAtPath(g.sem, nodeId);
        if (!node) throw new Error(`no node ${nodeId}`);
        setNodeComment(node, prose, g.decodeTk, g.eol);
      });
    },
  );

  ipcMain.handle(
    IPC_DOC.SET_NAGS,
    async (event, i: number, nodeId: string, nags: number[]) => {
      const b = await mustAsync(event);
      return editResult(b, i, () => {
        const g = b.host.doc.game(i);
        const node = nodeAtPath(g.sem, nodeId);
        if (!node) throw new Error(`no node ${nodeId}`);
        setNodeNags(node, nags, g.decodeTk);
      });
    },
  );

  ipcMain.handle(
    IPC_DOC.SET_SHAPES,
    async (event, i: number, nodeId: string, shapes: { orig: string; dest?: string; brush: string }[]) => {
      const b = await mustAsync(event);
      return editResult(b, i, () => {
        const g = b.host.doc.game(i);
        const node = nodeAtPath(g.sem, nodeId);
        if (!node) throw new Error(`no node ${nodeId}`);
        setNodeShapes(node, shapes, g.decodeTk);
      });
    },
  );

  ipcMain.handle(
    IPC_DOC.ADD_MOVE,
    async (event, rawI: unknown, rawParentId: unknown, uci: string) => {
      const b = await mustAsync(event);
      const i = gameIndexOf(b, rawI);
      const parentId = nodeIdOf(rawParentId);
      // Replaying a move that already exists is NAVIGATION, not an edit —
      // without this check, playing 1.e4 on a game that starts 1.e4 would
      // dirty the file with a duplicate (1.e4) variation.
      {
        const g = b.host.doc.game(i);
        const parent = parentId === "" ? null : nodeAtPath(g.sem, parentId);
        const children = parent ? parent.children : g.sem.children;
        const exists = children.some((c) => {
          if (!c.move) return false;
          const cg = chessgroundMove(c.move);
          const promo = (c.move as { promotion?: string }).promotion;
          const suffix = promo
            ? ({ queen: "q", rook: "r", bishop: "b", knight: "n" } as Record<string, string>)[promo] ?? ""
            : "";
          return `${cg[0]}${cg[1]}${suffix}` === uci;
        });
        if (exists) {
          return { ok: true as const, game: wireGameOf(b, i), dirty: b.host.doc.dirty };
        }
      }
      return editResult(b, i, () => {
        const g = b.host.doc.game(i);
        const parent = parentId === "" ? null : nodeAtPath(g.sem, parentId);
        if (parentId !== "" && !parent) throw new Error(`no node ${parentId}`);
        const fen = parent ? parent.fen : g.sem.initialFen;
        const pos = chessFromSetup(parseFen(fen).unwrap());
        const move = parseUciMove(pos, uci);
        if (!move) throw new UnrepresentableEditError(`illegal move ${uci}`);
        addMove({ parent, position: pos, cst: g.cst, sem: g.sem, eol: g.eol }, move);
      });
    },
  );

  ipcMain.handle(IPC_DOC.DELETE_FROM_HERE, async (event, i: number, nodeId: string) => {
    const b = await mustAsync(event);
    return editResult(b, i, () => {
      const g = b.host.doc.game(i);
      const node = nodeAtPath(g.sem, nodeId);
      if (!node) throw new Error(`no node ${nodeId}`);
      deleteFromHere(g.cst, node, g.decodeTk);
    });
  });

  ipcMain.handle(IPC_DOC.PROMOTE_VARIATION, async (event, i: number, nodeId: string) => {
    const b = await mustAsync(event);
    return editResult(b, i, () => {
      const g = b.host.doc.game(i);
      const node = nodeAtPath(g.sem, nodeId);
      if (!node) throw new Error(`no node ${nodeId}`);
      promoteVariation(g.cst, node);
    });
  });

  ipcMain.handle(
    IPC_DOC.SET_TAG,
    async (event, i: number, name: string, value: string) => {
      const b = await mustAsync(event);
      return editResult(b, i, () => {
        const g = b.host.doc.game(i);
        setTag(g.cst, name, value, g.eol);
      });
    },
  );

  ipcMain.handle(IPC_DOC.DELETE_TAG, async (event, i: number, name: string) => {
    const b = await mustAsync(event);
    return editResult(b, i, () => {
      const g = b.host.doc.game(i);
      deleteTag(g.cst, name);
    });
  });

  ipcMain.handle(IPC_DOC.SET_RESULT, async (event, i: number, result: string) => {
    const b = await mustAsync(event);
    return editResult(b, i, () => {
      const g = b.host.doc.game(i);
      setResult(g.cst, g.sem, result, g.eol);
    });
  });

  ipcMain.handle(IPC_DOC.UNDO, async (event) => {
    const b = await mustAsync(event);
    const i = b.host.undo();
    pushDirty(b);
    return i === null ? null : { index: i, game: wireGameOf(b, i) };
  });

  ipcMain.handle(IPC_DOC.REDO, async (event) => {
    const b = await mustAsync(event);
    const i = b.host.redo();
    pushDirty(b);
    return i === null ? null : { index: i, game: wireGameOf(b, i) };
  });

  ipcMain.handle(IPC_DOC.SAVE, async (event) => {
    const b = await mustAsync(event);
    try {
      b.host.save();
      pushDirty(b);
      return { ok: true as const, byteSize: b.host.diskState.size };
    } catch (e) {
      if (e instanceof SaveConflictError) {
        return { ok: false as const, conflict: true as const, message: e.message };
      }
      if (
        e instanceof UnencodableEditsError ||
        e instanceof ReadOnlyDocumentError ||
        e instanceof SerializerHonestyError
      ) {
        return { ok: false as const, conflict: false as const, message: e.message };
      }
      throw e;
    }
  });

  ipcMain.handle(IPC_DOC.SAVE_AS, async (event) => {
    const b = await mustAsync(event);
    const res = await dialog.showSaveDialog(b.window, {
      defaultPath: b.filePath.replace(/\.pgn$/i, " copy.pgn"),
      filters: [{ name: "PGN", extensions: ["pgn"] }],
    });
    if (res.canceled || !res.filePath) return { ok: false as const, canceled: true as const };
    b.host.saveAs(res.filePath);
    return { ok: true as const, filePath: res.filePath };
  });

  ipcMain.handle(IPC_DOC.GET_UI_STATE, async (event) => must(event).uiState);
  ipcMain.handle(IPC_DOC.SET_UI_STATE, async (event, state: Record<string, unknown>) => {
    const b = await mustAsync(event);
    b.uiState = { ...b.uiState, ...state };
    persistUiState(b);
  });
}

// Root comment plumbing: edit.ts exposes setRootComment(cst, sem, ...).
import { setRootComment } from "../lib/pgn/edit";
function setRootCommentViaEdit(b: DocBinding, i: number, prose: string): void {
  const g = b.host.doc.game(i);
  setRootComment(g.cst, g.sem, prose, g.decodeTk);
}

// UI-state persistence lives with the window manager (sidecar file in
// userData keyed by file identity); injected to avoid a circular import.
let persistUiState: (b: DocBinding) => void = () => {};
export function setUiStatePersister(fn: (b: DocBinding) => void): void {
  persistUiState = fn;
}
