/**
 * The renderer-facing API surface, built over a minimal bridge: preload.ts
 * stays tiny, and this module imports nothing from electron.
 */

import { IPC_APP, IPC_DOC, IPC_DOC_EVENT, IPC_ENGINE } from "./constants";

export interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
  /** Resolve a dropped File to its absolute path (Electron webUtils; the
   *  File must be read in the preload context, so it is wired in preload.ts). */
  pathForFile(file: unknown): string;
}

export function createElectronApi(bridge: Bridge) {
  const sub = (channel: string) => (listener: (payload: unknown) => void) => {
    const wrapped = (...args: unknown[]): void => listener(args[0]);
    bridge.on(channel, wrapped);
    return () => bridge.removeListener(channel, wrapped);
  };

  return {
    appReady: () => bridge.invoke(IPC_APP.READY),
    openExternal: (url: string) => bridge.invoke(IPC_APP.OPEN_EXTERNAL, url),
    /** Welcome window only: open the native picker / a dropped .pgn. */
    openFromWelcome: () => bridge.invoke(IPC_APP.WELCOME_OPEN),
    openPathFromWelcome: (filePath: string) =>
      bridge.invoke(IPC_APP.WELCOME_OPEN_PATH, filePath),
    getPathForFile: (file: unknown) => bridge.pathForFile(file),
    perfMark: (name: string) => bridge.invoke(IPC_APP.PERF_MARK, name),
    appInfo: () => bridge.invoke(IPC_APP.INFO),

    docSummary: () => bridge.invoke(IPC_DOC.SUMMARY),
    docBootstrap: () => bridge.invoke(IPC_DOC.BOOTSTRAP),
    docRows: (start: number, count: number) => bridge.invoke(IPC_DOC.ROWS, start, count),
    docRowsAt: (indices: number[]) => bridge.invoke(IPC_DOC.ROWS_AT, indices),
    docFilter: (q: unknown) => bridge.invoke(IPC_DOC.FILTER, q),
    insertGame: (afterIndex: number) => bridge.invoke(IPC_DOC.INSERT_GAME, afterIndex),
    deleteGame: (i: number) => bridge.invoke(IPC_DOC.DELETE_GAME, i),
    moveGame: (from: number, to: number) => bridge.invoke(IPC_DOC.MOVE_GAME, from, to),
    docGame: (i: number) => bridge.invoke(IPC_DOC.GAME, i),
    docGameText: (i: number) => bridge.invoke(IPC_DOC.GAME_TEXT, i),
    setComment: (i: number, nodeId: string, prose: string) =>
      bridge.invoke(IPC_DOC.SET_COMMENT, i, nodeId, prose),
    setNags: (i: number, nodeId: string, nags: number[]) =>
      bridge.invoke(IPC_DOC.SET_NAGS, i, nodeId, nags),
    setShapes: (
      i: number,
      nodeId: string,
      shapes: { orig: string; dest?: string; brush: string }[],
    ) => bridge.invoke(IPC_DOC.SET_SHAPES, i, nodeId, shapes),
    addMove: (i: number, parentId: string, uci: string) =>
      bridge.invoke(IPC_DOC.ADD_MOVE, i, parentId, uci),
    deleteFromHere: (i: number, nodeId: string) =>
      bridge.invoke(IPC_DOC.DELETE_FROM_HERE, i, nodeId),
    promoteVariation: (i: number, nodeId: string) =>
      bridge.invoke(IPC_DOC.PROMOTE_VARIATION, i, nodeId),
    setTag: (i: number, name: string, value: string) =>
      bridge.invoke(IPC_DOC.SET_TAG, i, name, value),
    deleteTag: (i: number, name: string) => bridge.invoke(IPC_DOC.DELETE_TAG, i, name),
    setResult: (i: number, result: string) => bridge.invoke(IPC_DOC.SET_RESULT, i, result),
    undo: () => bridge.invoke(IPC_DOC.UNDO),
    redo: () => bridge.invoke(IPC_DOC.REDO),
    save: () => bridge.invoke(IPC_DOC.SAVE),
    saveAs: () => bridge.invoke(IPC_DOC.SAVE_AS),
    getUiState: () => bridge.invoke(IPC_DOC.GET_UI_STATE),
    setUiState: (state: Record<string, unknown>) => bridge.invoke(IPC_DOC.SET_UI_STATE, state),
    openAnyway: () => bridge.invoke(IPC_DOC.OPEN_ANYWAY),

    onExternalChange: sub(IPC_DOC_EVENT.EXTERNAL_CHANGE),
    onDirtyChanged: sub(IPC_DOC_EVENT.DIRTY_CHANGED),
    onMenuAction: sub(IPC_DOC_EVENT.MENU_ACTION),

    listEngines: () => bridge.invoke(IPC_ENGINE.LIST),
    /** Initial options are UCI name/value pairs ({MultiPV, Hash}; Threads is
     *  applied after the session reports whether the build is threaded). */
    createEngineSession: (engineId: string, initialOptions: Record<string, string | number | boolean>) =>
      bridge.invoke(IPC_ENGINE.CREATE_SESSION, engineId, initialOptions),
    disposeEngineSession: (sessionId: string) =>
      bridge.invoke(IPC_ENGINE.DISPOSE_SESSION, sessionId),
    setEngineOptions: (sessionId: string, values: Record<string, string | number | boolean>) =>
      bridge.invoke(IPC_ENGINE.SET_OPTIONS, sessionId, values),
    engineAnalyze: (sessionId: string, fen: string, go: { mode: string; value?: number }) =>
      bridge.invoke(IPC_ENGINE.ANALYZE, sessionId, fen, go),
    engineStop: (sessionId: string) => bridge.invoke(IPC_ENGINE.STOP, sessionId),
    enginePressButton: (sessionId: string, name: string) =>
      bridge.invoke(IPC_ENGINE.PRESS_BUTTON, sessionId, name),
    enginePrewarm: () => bridge.invoke(IPC_ENGINE.PREWARM),
    onEngineInfo: sub(IPC_ENGINE.INFO),
    onEngineBestmove: sub(IPC_ENGINE.BESTMOVE),
    onEngineError: sub(IPC_ENGINE.ERROR),
    onEngineState: sub(IPC_ENGINE.STATE),
  };
}

export type ElectronApi = ReturnType<typeof createElectronApi>;
