/**
 * Centralized IPC channel names: no inline string discriminators — every
 * channel is a named constant used by main, preload and renderer alike.
 */

/** Renderer -> main (invoke). One document per window; the sender's window
 *  identifies the document, so no document id travels over the wire. */
export const IPC_DOC = {
  /** Returns the document's summary (or an open error/refusal payload). */
  SUMMARY: "doc:summary",
  /** One-call launch payload: summary + first rows + game 0 (launch path). */
  BOOTSTRAP: "doc:bootstrap",
  /** Row range for the virtualized game list. */
  ROWS: "doc:rows",
  /** Rows at explicit indices (filtered-list paging). */
  ROWS_AT: "doc:rowsAt",
  /** Search/filter over the index headers -> matching game indices. */
  FILTER: "doc:filter",
  /** Game-level structure: create, delete, reorder. */
  INSERT_GAME: "doc:insertGame",
  DELETE_GAME: "doc:deleteGame",
  MOVE_GAME: "doc:moveGame",
  /** Full wire tree for one game. */
  GAME: "doc:game",
  /** Edits — each returns the refreshed WireGame + document dirty state. */
  SET_COMMENT: "doc:setComment",
  SET_NAGS: "doc:setNags",
  SET_SHAPES: "doc:setShapes",
  ADD_MOVE: "doc:addMove",
  DELETE_FROM_HERE: "doc:deleteFromHere",
  PROMOTE_VARIATION: "doc:promoteVariation",
  SET_TAG: "doc:setTag",
  DELETE_TAG: "doc:deleteTag",
  SET_RESULT: "doc:setResult",
  UNDO: "doc:undo",
  REDO: "doc:redo",
  /** Save / Save As. */
  SAVE: "doc:save",
  SAVE_AS: "doc:saveAs",
  /** Export current game / clipboard payloads are produced renderer-side
   *  from the wire tree; whole-game raw bytes come from here. */
  GAME_TEXT: "doc:gameText",
  /** UI state persisted per document (game, ply path, orientation). */
  GET_UI_STATE: "doc:getUiState",
  SET_UI_STATE: "doc:setUiState",
  /** Open-anyway confirmation for over-cap files. */
  OPEN_ANYWAY: "doc:openAnyway",
} as const;

/** Main -> renderer (send). */
export const IPC_DOC_EVENT = {
  /** Document changed externally on disk. */
  EXTERNAL_CHANGE: "doc:externalChange",
  /** Dirty state changed (title bar dot, close prompt). */
  DIRTY_CHANGED: "doc:dirtyChanged",
  /** Index progress for large files: {games, bytes, done}. */
  INDEX_PROGRESS: "doc:indexProgress",
  /** Menu-driven actions forwarded to the focused renderer. */
  MENU_ACTION: "menu:action",
} as const;

export const MENU_ACTION = {
  UNDO: "undo",
  REDO: "redo",
  SAVE: "save",
  COPY_PGN: "copyPgn",
  COPY_FEN: "copyFen",
  EXPORT_GAME: "exportGame",
  FLIP_BOARD: "flipBoard",
  TOGGLE_ENGINE: "toggleEngine",
  FIND: "find",
  NEW_GAME: "newGame",
  SETTINGS: "settings",
  ABOUT: "about",
} as const;
export type MenuAction = (typeof MENU_ACTION)[keyof typeof MENU_ACTION];

/** App-level channels. */
export const IPC_APP = {
  /** Timing marks (silent unless PGNREADER_T0 is set). */
  PERF_MARK: "app:perfMark",
  /** Renderer announces it can receive pushes; flushes queued events. */
  READY: "app:ready",
  /** Platform + version info for the About panel. */
  INFO: "app:info",
  /** Open an allowlisted https URL in the user's browser. */
  OPEN_EXTERNAL: "app:openExternal",
  /** Welcome window: open the native file picker. */
  WELCOME_OPEN: "app:welcomeOpen",
  /** Welcome window: open a dropped .pgn by its path. */
  WELCOME_OPEN_PATH: "app:welcomeOpenPath",
} as const;

/** Engine channels. Invokes go renderer -> main; INFO/BESTMOVE/ERROR/STATE
 *  are pushed main -> the renderer that created the session. */
export const IPC_ENGINE = {
  LIST: "engine:list",
  CREATE_SESSION: "engine:createSession",
  DISPOSE_SESSION: "engine:disposeSession",
  SET_OPTIONS: "engine:setOptions",
  ANALYZE: "engine:analyze",
  STOP: "engine:stop",
  /** Press a button-type UCI option (an action, not a value). */
  PRESS_BUTTON: "engine:pressButton",
  /** Boot the hidden engine host ahead of the first request. Post-first-paint
   *  idle work only — never the launch path. */
  PREWARM: "engine:prewarm",
  INFO: "engine:info",
  BESTMOVE: "engine:bestmove",
  ERROR: "engine:error",
  STATE: "engine:state",
} as const;

export const ENGINE_HOST = {
  READY: "engine-host:ready",
  CREATE: "engine-host:create",
  POST: "engine-host:post",
  TERMINATE: "engine-host:terminate",
  OUTPUT: "engine-host:output",
  FAILED: "engine-host:failed",
} as const;

/** The custom scheme serving the packaged renderer. No passthrough branch
 *  exists — an offline app claims no real scheme. */
export const APP_SCHEME = "pgnreader";
export const APP_HOST = "app";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Open limits (exact bytes; strictly-greater comparisons). */
export const LIMITS = {
  SOFT_BYTES: 26_214_400,
  SOFT_GAMES: 30_000,
  HARD_BYTES: 104_857_600,
  HARD_GAMES: 120_000,
} as const;
