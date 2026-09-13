/**
 * Renderer document state (zustand). The main process owns the truth; this
 * store mirrors what the window shows: summary, the current game's wire tree,
 * the navigation cursor.
 */

import { create } from "zustand";

import {
  api,
  docGame,
  docRows,
  docSummary,
  unpackGame,
  type DocSummary,
  type PackedWireGame,
  type WireGame,
  type WireNode,
  type WireRow,
} from "../lib/renderer/api";
import {
  lastStepIndex,
  parentId as sharedParentId,
  pathStep,
  resolvePath,
} from "../lib/shared/path";

export type { WireGame, WireNode };

/** Walk the wire tree by node id (shared variable-length step codec). */
export function nodeById(game: WireGame, id: string): WireNode | null {
  return resolvePath<WireNode>(game.children, id);
}

export const parentId = sharedParentId;

/** Flatten the mainline for Home/End navigation. */
export function mainlineIds(game: WireGame): string[] {
  const ids: string[] = [];
  let children = game.children;
  let id = "";
  while (children.length > 0) {
    id += "00";
    ids.push(id);
    children = children[0]!.children;
  }
  return ids;
}

export interface ListFilters {
  eloMin: number | null;
  eloMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  results: string[];
  color: "any" | "white" | "black";
}

export const EMPTY_FILTERS: ListFilters = {
  eloMin: null,
  eloMax: null,
  yearMin: null,
  yearMax: null,
  results: [],
  color: "any",
};

export function filtersActive(f: ListFilters, searchQuery = ""): boolean {
  return (
    f.eloMin !== null ||
    f.eloMax !== null ||
    f.yearMin !== null ||
    f.yearMax !== null ||
    f.results.length > 0 ||
    // Color only narrows the search box — vacuous without a query.
    (f.color !== "any" && searchQuery.trim() !== "")
  );
}

interface DocumentState {
  summary: DocSummary | null;
  rows: Map<number, WireRow>;
  /** Bumped when `rows` gains entries — the Map identity is stable and it is
   *  mutated in place. An immutable copy per merge would be O(n²) churn over a
   *  31k-row scroll, into the hundreds of MB. Subscribe to this. */
  rowsVersion: number;
  game: WireGame | null;
  gameIndex: number;
  /** "" = initial position. */
  currentId: string;
  orientation: "white" | "black";

  // Game-list search/filter (index-backed).
  searchQuery: string;
  filters: ListFilters;
  showFilters: boolean;
  /** The # column is hidden by default (it eats row width). */
  showGameNumber: boolean;
  /** Optional list columns (players are always shown). */
  showEvent: boolean;
  showDate: boolean;
  showResult: boolean;
  /** Visible list order (filter and/or sort applied); null = raw file order. */
  filtered: number[] | null;
  sortColumn: "white" | "black" | "event" | "date" | "result" | null;
  sortDir: "asc" | "desc";

  loadSummary(): Promise<void>;
  bootstrap(): Promise<void>;
  ensureRows(start: number, count: number): Promise<void>;
  ensureRowsAt(indices: number[]): Promise<void>;
  openGame(i: number): Promise<void>;
  /** Move selection to the previous/next game in the visible list order. */
  stepGame(direction: 1 | -1): void;
  newGame(afterIndex?: number): Promise<void>;
  /** Create a new game whose starting position is `fen` (SetUp+FEN tags). */
  newGameFromFen(fen: string, afterIndex?: number): Promise<void>;
  deleteGame(i: number): Promise<void>;
  moveGame(from: number, to: number): Promise<void>;
  setSearchQuery(q: string): void;
  setFilters(patch: Partial<ListFilters>): void;
  resetFilters(): void;
  setShowFilters(show: boolean): void;
  setShowGameNumber(show: boolean): void;
  /** Header click: cycles asc -> desc -> off for a column. */
  setSort(column: "white" | "black" | "event" | "date" | "result" | null): void;
  setColumn(key: "showEvent" | "showDate" | "showResult", show: boolean): void;
  refreshGame(game: PackedWireGame): WireGame;
  navigateTo(id: string): void;
  goForward(): void;
  goBack(): void;
  goStart(): void;
  goEnd(): void;
  enterVariation(direction: 1 | -1): void;
  toggleOrientation(): void;
  setDirty(dirty: boolean): void;
}

type Set_ = (partial: Partial<DocumentState>) => void;
type Get_ = () => DocumentState;

/** The row cache is a viewport cache, not a whole-file mirror: a 120k-game
 *  open-anyway file must not accumulate 120k rows in the renderer. Maps are
 *  insertion-ordered, refetches re-insert at the end, so trimming from the
 *  front is oldest-first; anything visible that gets evicted refetches on
 *  the next ensure pass (one IPC). */
const ROW_CACHE_CAP = 4096;
function evictRows(rows: Map<number, WireRow>): void {
  if (rows.size <= ROW_CACHE_CAP) return;
  for (const k of rows.keys()) {
    if (rows.size <= ROW_CACHE_CAP) break;
    rows.delete(k);
  }
}

let filterGen = 0;
let openGen = 0;
async function refilter(set: Set_, get: Get_): Promise<void> {
  const { searchQuery, filters, sortColumn, sortDir } = get();
  const gen = ++filterGen;
  if (
    searchQuery.trim() === "" &&
    !filtersActive(filters, searchQuery) &&
    sortColumn === null
  ) {
    set({ filtered: null });
    return;
  }
  const indices = (await api().docFilter({
    query: searchQuery,
    color: filters.color,
    eloMin: filters.eloMin ?? undefined,
    eloMax: filters.eloMax ?? undefined,
    yearMin: filters.yearMin ?? undefined,
    yearMax: filters.yearMax ?? undefined,
    results: filters.results,
    sortColumn: sortColumn ?? undefined,
    sortDir,
  })) as number[];
  if (gen !== filterGen) return; // a newer query superseded this one
  set({ filtered: indices });
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  summary: null,
  rows: new Map(),
  rowsVersion: 0,
  game: null,
  gameIndex: 0,
  currentId: "",
  orientation: "white",
  searchQuery: "",
  filters: EMPTY_FILTERS,
  showFilters: false,
  showGameNumber: false,
  showEvent: false,
  showDate: false,
  showResult: true,
  filtered: null,
  sortColumn: null,
  sortDir: "asc",

  async loadSummary() {
    const summary = await docSummary();
    set({ summary });
  },

  async bootstrap() {
    // One IPC round trip on the launch path (summary + first rows + game 0).
    const payload = (await api().docBootstrap()) as {
      summary: DocSummary;
      rows: WireRow[];
      game: PackedWireGame | null;
    };
    const rows = new Map<number, WireRow>();
    for (const r of payload.rows) rows.set(r.i, r);
    set({
      summary: payload.summary,
      rows,
      rowsVersion: 0,
      game: payload.game ? unpackGame(payload.game) : null,
      gameIndex: 0,
      currentId: "",
    });
  },

  async ensureRows(start, count) {
    const { rows } = get();
    let missing = false;
    for (let i = start; i < start + count; i++) {
      if (!rows.has(i)) {
        missing = true;
        break;
      }
    }
    if (!missing) return;
    const fetched = await docRows(start, count);
    for (const r of fetched) rows.set(r.i, r);
    evictRows(rows);
    set({ rowsVersion: get().rowsVersion + 1 });
  },

  async ensureRowsAt(indices) {
    const { rows } = get();
    const missing = indices.filter((i) => !rows.has(i));
    if (missing.length === 0) return;
    const fetched = (await api().docRowsAt(missing)) as WireRow[];
    for (const r of fetched) rows.set(r.i, r);
    evictRows(rows);
    set({ rowsVersion: get().rowsVersion + 1 });
  },

  async openGame(i) {
    // Generation guard: two fast row clicks whose IPC responses resolve out
    // of order must not leave the board on the earlier game.
    const gen = ++openGen;
    const game = await docGame(i);
    if (gen !== openGen) return;
    set({ game, gameIndex: i, currentId: "" });
  },

  stepGame(direction) {
    const { filtered, gameIndex, summary } = get();
    if (filtered !== null) {
      if (filtered.length === 0) return;
      const pos = filtered.indexOf(gameIndex);
      const nextPos = pos < 0 ? (direction > 0 ? 0 : filtered.length - 1) : pos + direction;
      if (nextPos < 0 || nextPos >= filtered.length) return;
      void get().openGame(filtered[nextPos]!);
      return;
    }
    const next = gameIndex + direction;
    if (next < 0 || next >= (summary?.gameCount ?? 0)) return;
    void get().openGame(next);
  },

  async newGame(afterIndex) {
    const after = afterIndex ?? get().gameIndex;
    const res = (await api().insertGame(after)) as { newIndex: number; gameCount: number };
    // Row cache and any filter are invalidated by the reshuffle; reload
    // the summary, drop cached rows, and open the fresh game.
    await get().loadSummary();
    get().rows.clear();
    set({ rowsVersion: get().rowsVersion + 1, filtered: null, searchQuery: "", sortColumn: null });
    await get().openGame(res.newIndex);
  },

  async newGameFromFen(fen, afterIndex) {
    const after = afterIndex ?? get().gameIndex;
    const res = (await api().insertGame(after)) as { newIndex: number };
    // Mark the game as starting from `fen`: SetUp "1" + the FEN tag are what
    // chessops (and buildSemantics) read to seat the initial position.
    await api().setTag(res.newIndex, "SetUp", "1");
    await api().setTag(res.newIndex, "FEN", fen.trim());
    await get().loadSummary();
    get().rows.clear();
    set({ rowsVersion: get().rowsVersion + 1, filtered: null, searchQuery: "", sortColumn: null });
    await get().openGame(res.newIndex);
  },

  async deleteGame(i) {
    const res = (await api().deleteGame(i)) as { ok: boolean; message?: string; gameCount?: number };
    if (!res.ok) return;
    await get().loadSummary();
    get().rows.clear();
    const count = res.gameCount ?? get().summary?.gameCount ?? 1;
    const next = Math.min(get().gameIndex, count - 1);
    set({ rowsVersion: get().rowsVersion + 1, filtered: null });
    await get().openGame(Math.max(0, next));
  },

  async moveGame(from, to) {
    await api().moveGame(from, to);
    await get().loadSummary();
    get().rows.clear();
    // Selection follows the moved game to its new index.
    set({ rowsVersion: get().rowsVersion + 1, filtered: null, gameIndex: to });
    await get().openGame(to);
  },

  setSearchQuery(q) {
    set({ searchQuery: q });
    void refilter(set, get);
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
    void refilter(set, get);
  },

  resetFilters() {
    set({ filters: EMPTY_FILTERS, searchQuery: "" });
    void refilter(set, get);
  },

  setShowFilters(show) {
    set({ showFilters: show });
  },

  setShowGameNumber(show) {
    set({ showGameNumber: show });
  },

  setSort(column) {
    const { sortColumn, sortDir } = get();
    if (column === null || (sortColumn === column && sortDir === "desc")) {
      set({ sortColumn: null, sortDir: "asc" });
    } else if (sortColumn === column) {
      set({ sortDir: "desc" });
    } else {
      set({ sortColumn: column, sortDir: "asc" });
    }
    void refilter(set, get);
  },

  setColumn(key, show) {
    set({ [key]: show } as Partial<DocumentState>);
  },

  refreshGame(packed) {
    const game = unpackGame(packed);
    const { currentId, rows } = get();
    // Keep the cursor when the node still exists after an edit.
    const still = nodeById(game, currentId);
    // A tag edit can change this game's list row and its filter
    // membership: drop the cached row (the next ensure pass refetches the
    // now-synced entry headers) and re-run any active filter.
    rows.delete(game.index);
    set({ game, currentId: still ? currentId : "", rowsVersion: get().rowsVersion + 1 });
    void refilter(set, get);
    return game;
  },

  navigateTo(id) {
    set({ currentId: id });
  },

  goForward() {
    const { game, currentId } = get();
    if (!game) return;
    const node = currentId === "" ? null : nodeById(game, currentId);
    const children = node ? node.children : game.children;
    if (children.length > 0) set({ currentId: currentId + "00" });
  },

  goBack() {
    const { currentId } = get();
    if (currentId.length > 0) set({ currentId: parentId(currentId) });
  },

  goStart() {
    set({ currentId: "" });
  },

  goEnd() {
    const { game } = get();
    if (!game) return;
    const ids = mainlineIds(game);
    set({ currentId: ids[ids.length - 1] ?? "" });
  },

  enterVariation(direction) {
    // On a node with siblings: move to the next/previous sibling variation.
    const { game, currentId } = get();
    if (!game || currentId.length < 2) return;
    const pid = parentId(currentId);
    const parent = pid === "" ? null : nodeById(game, pid);
    const siblings = parent ? parent.children : game.children;
    const idx = lastStepIndex(currentId);
    if (idx === null) return;
    const next = idx + direction;
    if (next >= 0 && next < siblings.length) {
      set({ currentId: pid + pathStep(next) });
    }
  },

  toggleOrientation() {
    set((s) => ({ orientation: s.orientation === "white" ? "black" : "white" }));
  },

  setDirty(dirty) {
    set((s) =>
      s.summary ? { summary: { ...s.summary, dirty } } : {},
    );
  },
}));


