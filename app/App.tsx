/**
 * Window root: refusal screen, or the three-pane document view
 * (list | board | moves) plus the window chrome: settings panel, tag
 * editor, toast. Keyboard-first: arrows navigate, f flips, backquote
 * toggles settings, ⌘S saves.
 */

import { lazy, Suspense, useCallback, useEffect } from "react";

import { api } from "../lib/renderer/api";
import { nodeById, useDocumentStore } from "../store/document-store";
import { AnalysisDock } from "../components/analysis/AnalysisDock";
import { BoardPanel } from "../components/board/BoardPanel";

import { PaneDivider } from "../components/chrome/PaneDivider";
import { BrandHeader } from "../components/chrome/BrandHeader";
import { DocumentNotice } from "../components/chrome/DocumentNotice";
import { GameList } from "../components/list/GameList";
import { GameListFilterPanel } from "../components/list/GameListFilterPanel";
import { GameListToolbar } from "../components/list/GameListToolbar";

import { MoveTreePanel } from "../components/tree/MoveTreePanel";

// Closed-by-default chrome stays out of the launch bundle's parse/execute
// cost: loaded on idle after first paint.
const SettingsPanel = lazy(() =>
  import("../components/settings/SettingsPanel").then((m) => ({ default: m.SettingsPanel })),
);
const TagEditorModal = lazy(() =>
  import("../components/board/TagEditorModal").then((m) => ({ default: m.TagEditorModal })),
);
import { ActionToast } from "../components/ui/ActionToast";
import { useKeyboardNav } from "../lib/hooks/use-keyboard-nav";
import { useToastStore } from "../store/toast-store";
import { prewarmEngine } from "../lib/hooks/use-live-engine";
import { useEngineStore } from "../store/engine-store";
import { useLiveAnalysisStore } from "../store/live-analysis-store";
import { exportCurrentGame } from "../lib/renderer/export";
import {
  SETTINGS_SECTION,
  useSettingsModalStore,
} from "../store/settings-modal-store";
import { LIMITS, MENU_ACTION } from "../electron/constants";
import { useLayoutStore } from "../store/layout-store";

function RefusalScreen(): React.ReactElement | null {
  const summary = useDocumentStore((s) => s.summary);
  const canOpenAnyway =
    summary?.refusal?.kind === "tooLarge" || summary?.refusal?.kind === "tooManyGames";
  // Keyboard-operable: Return closes, Cmd+Return opens read-only.
  useEffect(() => {
    if (!summary?.refusal) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && canOpenAnyway) void api().openAnyway();
      else window.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [summary?.refusal, canOpenAnyway]);
  if (!summary?.refusal) return null;
  const r = summary.refusal;
  const mb = (n: number): string => `${Math.max(1, Math.round(n / 1048576)).toLocaleString()} MB`;
  const headline =
    r.kind === "tooLarge"
      ? "This file is too large to open normally"
      : r.kind === "tooManyGames"
        ? "This file has too many games to open normally"
        : "This file couldn't be opened";
  const body =
    r.kind === "tooLarge"
      ? `${summary.fileName} is ${mb(r.byteSize)}. Manifest Chess Lite opens files up to ${mb(LIMITS.HARD_BYTES)}.`
      : r.kind === "tooManyGames"
        ? `${summary.fileName} has ${(r.gameCount ?? 0).toLocaleString()} games. Manifest Chess Lite opens files with up to ${LIMITS.HARD_GAMES.toLocaleString()} games.`
        : r.message;
  return (
    <div className="drag-region flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div aria-label="Manifest Chess" className="brand-logo w-64 max-w-full" role="img" />
      <div className="mt-2 max-w-md text-lg font-semibold text-txt-clear">{headline}</div>
      <div className="max-w-md text-sm leading-relaxed text-txt-dim">
        {body}
        {canOpenAnyway &&
          " You can still open it read-only to browse and analyze every game."}
      </div>
      <div className="max-w-md text-xs text-txt-dimmer">
        Nothing in your file is ever changed or truncated.
      </div>
      <div className="no-drag mt-2 flex items-center gap-3">
        {canOpenAnyway && (
          <button
            className="cursor-pointer rounded-lg bg-primary px-5 py-2 text-sm font-medium text-page transition-colors hover:opacity-90"
            onClick={() => void api().openAnyway()}
          >
            Open read-only
          </button>
        )}
        <button
          className="cursor-pointer rounded-lg border border-line bg-transparent px-5 py-2 text-sm text-txt-dim transition-colors hover:bg-low hover:text-txt-clear"
          onClick={() => window.close()}
        >
          Close
        </button>
      </div>
      <div className="no-drag mt-4 max-w-md text-xs text-txt-dimmer">
        Working with big databases?{" "}
        <button
          className="cursor-pointer border-none bg-transparent p-0 text-xs text-primary-ink underline-offset-2 hover:underline"
          data-testid="upsell-link"
          onClick={() => void api().openExternal("https://www.manifestchess.com")}
        >
          Manifest Chess
        </button>{" "}
        is built for them.
      </div>
    </div>
  );
}

/**
 * Timing marks (silent unless PGNREADER_T0 is set in main):
 * "interactive" fires on the presented frame after the first game's board
 * state and the first list rows hold real data; a synthetic ArrowRight then
 * round-trips through the real keydown path to a board repaint and fires
 * "keystroke-echo". These mark the cold-launch endpoint.
 */
function reportInteractive(): void {
  // Single rAF: the readiness predicate is true and state committed, so the
  // NEXT frame paints it — that is the presented frame. A double rAF would
  // wait one extra vsync per mark by construction.
  const framesAfterPaint = (fn: () => void): void => {
    requestAnimationFrame(() => fn());
  };
  const waitFor = (pred: () => boolean, then: () => void): void => {
    if (pred()) then();
    else requestAnimationFrame(() => waitFor(pred, then));
  };
  waitFor(
    () => {
      const st = useDocumentStore.getState();
      if (!st.summary) return false;
      if (st.summary.refusal) return true;
      const rowsReady = st.summary.gameCount === 0 || st.rows.has(0);
      const gameReady = st.summary.gameCount === 0 || st.game !== null;
      const boardReady = document.querySelector(".cg-wrap") !== null;
      return rowsReady && gameReady && boardReady;
    },
    () =>
      framesAfterPaint(() => {
        void api()
          .perfMark("interactive")
          .then((timingActive) => {
            // The keystroke round-trip only runs under timing instrumentation;
            // without the gate every real launch would advance one ply.
            if (timingActive !== true) return;
            const before = useDocumentStore.getState().currentId;
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
            );
            waitFor(
              () => useDocumentStore.getState().currentId !== before ||
                (useDocumentStore.getState().game?.plyCount ?? 0) === 0,
              () => framesAfterPaint(() => void api().perfMark("keystroke-echo")),
            );
          });
      }),
  );
}

export function App(): React.ReactElement {
  const engineArrows = useLiveAnalysisStore((s) => s.arrows);
  const summary = useDocumentStore((s) => s.summary);
  const showFilters = useDocumentStore((s) => s.showFilters);
  const leftWidth = useLayoutStore((s) => s.leftWidth);
  const rightWidth = useLayoutStore((s) => s.rightWidth);
  const resizing = useLayoutStore((s) => s.resizing);
  const filtered = useDocumentStore((s) => s.filtered);
  const game = useDocumentStore((s) => s.game);
  const gameIndex = useDocumentStore((s) => s.gameIndex);
  const setDirty = useDocumentStore((s) => s.setDirty);

  useEffect(() => {
    void (async () => {
      await api().appReady();
      await useDocumentStore.getState().bootstrap();
      reportInteractive();
      // State restoration: same game, ply and orientation as the last
      // session with this file. Applied after the interactive frame so it
      // never taxes the launch budget; invalid saved state is ignored.
      try {
        const saved = (await api().getUiState()) as {
          gameIndex?: number;
          currentId?: string;
          orientation?: "white" | "black";
          showGameNumber?: boolean;
          showEvent?: boolean;
          showDate?: boolean;
          showResult?: boolean;
        };
        if (saved.showGameNumber === true) {
          useDocumentStore.getState().setShowGameNumber(true);
        }
        const st0 = useDocumentStore.getState();
        if (saved.showEvent === true) st0.setColumn("showEvent", true);
        if (saved.showDate === true) st0.setColumn("showDate", true);
        if (saved.showResult === false) st0.setColumn("showResult", false);
        const st = useDocumentStore.getState();
        if (
          typeof saved.gameIndex === "number" &&
          saved.gameIndex > 0 &&
          saved.gameIndex < (st.summary?.gameCount ?? 0)
        ) {
          await st.openGame(saved.gameIndex);
        }
        if (typeof saved.currentId === "string" && saved.currentId.length > 0) {
          const g = useDocumentStore.getState().game;
          if (g && nodeById(g, saved.currentId)) {
            useDocumentStore.getState().navigateTo(saved.currentId);
          }
        }
        if (saved.orientation === "black") {
          useDocumentStore.getState().toggleOrientation();
        }
      } catch {
        /* fresh document */
      }
    })();
  }, []);

  // Persist view state (debounced) for restoration; view-only — never dirties
  // the document.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useDocumentStore.subscribe((s) => {
      if (!s.summary || s.summary.refusal) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void api().setUiState({
          gameIndex: s.gameIndex,
          currentId: s.currentId,
          showGameNumber: s.showGameNumber,
          showEvent: s.showEvent,
          showDate: s.showDate,
          showResult: s.showResult,
          orientation: s.orientation,
        });
      }, 400);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  // Read-only introspection hook for the e2e suite: board state assertions
  // reduce to state, bytes, or the process table.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__pgnreaderNewGame = () =>
      void useDocumentStore.getState().newGame();
    (window as unknown as Record<string, unknown>).__pgnreaderState = () => {
      const s = useDocumentStore.getState();
      const node = s.game && s.currentId !== "" ? nodeById(s.game, s.currentId) : null;
      return {
        fen: node?.fen ?? s.game?.initialFen ?? null,
        currentId: s.currentId,
        gameIndex: s.gameIndex,
        orientation: s.orientation,
        dirty: s.summary?.dirty ?? false,
        gameCount: s.summary?.gameCount ?? 0,
        readOnly: s.game?.readOnly ?? false,
        readOnlyDocument: s.summary?.readOnlyDocument ?? false,
      };
    };
  }, []);

  useEffect(() => {
    return api().onDirtyChanged((payload) => {
      setDirty((payload as { dirty: boolean }).dirty);
    });
  }, [setDirty]);

  const save = useCallback(async () => {
    const res = (await api().save()) as { ok?: boolean; message?: string } | undefined;
    if (res && res.ok === false && res.message) {
      useToastStore.getState().show(res.message);
    }
  }, []);

  useEffect(() => {
    return api().onMenuAction((action) => {
      if (action === MENU_ACTION.SAVE) void save();
      if (action === MENU_ACTION.NEW_GAME) void useDocumentStore.getState().newGame();

      if (action === MENU_ACTION.FLIP_BOARD) useDocumentStore.getState().toggleOrientation();
      if (action === MENU_ACTION.SETTINGS) useSettingsModalStore.getState().open();
      if (action === MENU_ACTION.ABOUT)
        useSettingsModalStore.getState().open(SETTINGS_SECTION.ABOUT);
      if (action === MENU_ACTION.EXPORT_GAME) void exportCurrentGame();
      if (action === MENU_ACTION.TOGGLE_ENGINE)
        useEngineStore.getState().toggleAnalysis();
      if (action === MENU_ACTION.UNDO || action === MENU_ACTION.REDO) {
        // The custom Edit menu routes ⌘Z here. In a text field, native undo;
        // otherwise the document's CST-snapshot undo.
        const el = document.activeElement;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          document.execCommand(action === MENU_ACTION.UNDO ? "undo" : "redo");
        } else {
          void (action === MENU_ACTION.UNDO ? api().undo() : api().redo()).then(
            (res) => {
              const r = res as { index: number; game: never } | null;
              if (r) useDocumentStore.getState().refreshGame(r.game);
            },
          );
        }
      }
    });
  }, [save]);

  // Pre-warm the engine host once the window is interactive (never on the
  // launch path). Purely a latency optimization for the first toggle.
  // Gated on a real document: a refusal screen must not boot an engine.
  const docReady = summary !== null && !summary.refusal;
  useEffect(() => {
    if (!docReady) return;
    const id = window.requestIdleCallback?.(() => prewarmEngine(), { timeout: 5000 });
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
  }, [docReady]);

  // Keyboard-first: the full map (navigation, editing shortcuts, single-key
  // NAG entry) lives in lib/hooks/use-keyboard-nav.
  useKeyboardNav();

  // Backquote toggles settings: matched on e.code, no modifiers, works even
  // while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== "Backquote" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
        return;
      e.preventDefault();
      useSettingsModalStore.getState().toggle();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!summary) return <div className="h-full bg-page" />;
  if (summary.refusal) return <RefusalScreen />;

  return (
    <div className="flex h-full bg-page text-txt">
      <aside
        className="flex shrink-0 flex-col border-r border-line"
        style={{ width: leftWidth, transition: resizing ? undefined : "width 150ms ease" }}
      >
        <div className="drag-region h-10 shrink-0" />
        <BrandHeader />
        <GameListToolbar />
        {showFilters && <GameListFilterPanel />}
        <GameList />
      </aside>
      <PaneDivider side="left" />
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-2 p-4">
        <div className="drag-region absolute inset-x-0 top-0 flex h-10 items-center px-4 text-xs text-txt-dim">
          <span className="mx-auto min-w-0 max-w-[70%] truncate" data-testid="game-count">
            {summary.fileName}
            {summary.dirty ? " — edited" : ""}
            {" "}
            {filtered !== null
              ? `(${filtered.length.toLocaleString()} of ${summary.gameCount.toLocaleString()} games)`
              : `(${summary.gameCount.toLocaleString()} games)`}
          </span>
          {summary.readOnlyDocument && (
            <span
              className="absolute right-4 rounded border border-line px-1.5 py-0.5 text-[11px] text-txt-dimmer"
              data-testid="read-only-chip"
            >
              Read-only
            </span>
          )}
        </div>
        <DocumentNotice />
        <BoardPanel engineShapes={engineArrows} />
      </main>
      <PaneDivider side="right" />
      <section
        className="flex shrink-0 flex-col border-l border-line"
        style={{ width: rightWidth, transition: resizing ? undefined : "width 150ms ease" }}
      >
        <AnalysisDock />
        <div className="min-h-0 flex-1">
          <MoveTreePanel />
        </div>
      </section>
      <Suspense fallback={null}>
        <SettingsPanel />
        <TagEditorModal />
      </Suspense>
      <ActionToast />
    </div>
  );
}
