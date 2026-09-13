/**
 * The board pane: player bars, outside coordinates (chessground only draws
 * inside ones), square sizing with the draggable corner resizer, the
 * controls strip, and the empty-document state.
 *
 * Self-contained: reads the document store and talks to the main process
 * itself, so mounting it is a one-line integration. Drawn arrows/circles
 * are DOCUMENT EDITS: a drawable change goes to api().setShapes and the
 * node's own [%csl]/[%cal] shapes come back as the drawable state.
 * Read-only games disable moving and drawing; navigation still works.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, type EditResult } from "../../lib/renderer/api";
import { nodeById, useDocumentStore } from "../../store/document-store";
import { useBoardPreferencesStore } from "../../store/board-preferences-store";
import { useToastStore } from "../../store/toast-store";
import {
  playMoveSoundForCursor,
  preloadSoundTheme,
} from "../../lib/sound/play-sound";
import { PROMOTION_UCI, type PromotionRole } from "../../lib/chess/promotion";
import { destsFromFen } from "../../lib/chess/dests";
import { pathStep as stepOf } from "../../lib/shared/path";
import { useLiveAnalysisStore } from "../../store/live-analysis-store";
import { BoardControls } from "./BoardControls";
import { BoardView, OUTSIDE_COORD_GUTTER, type BoardShape } from "./BoardView";
import { EvaluationBar } from "./EvaluationBar";
import { PlayerBar, PLAYER_BAR_POSITION } from "./PlayerBar";

const CONTROLS_HEIGHT = 40;
const PLAYER_BAR_HEIGHT = 24;

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function BoardSkeleton({ size }: { size: number }): React.ReactElement {
  const sq = size / 8;

  return (
    <div className="overflow-hidden rounded" style={{ width: size, height: size }}>
      {Array.from({ length: 8 }, (_, r) => (
        <div key={r} className="flex">
          {Array.from({ length: 8 }, (_, f) => (
            <div
              key={f}
              className={(r + f) % 2 === 0 ? "bg-[#b0b0b0]/20" : "bg-[#808080]/20"}
              style={{ width: sq, height: sq }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

interface BoardPanelProps {
  /** Overlay arrows from the engine, drawn but never persisted. */
  engineShapes?: BoardShape[];
}



export function BoardPanel({ engineShapes }: BoardPanelProps = {}): React.ReactElement {
  const summary = useDocumentStore((s) => s.summary);
  const game = useDocumentStore((s) => s.game);
  const gameIndex = useDocumentStore((s) => s.gameIndex);
  const currentId = useDocumentStore((s) => s.currentId);
  const orientation = useDocumentStore((s) => s.orientation);
  const evalScore = useLiveAnalysisStore((s) => s.score);
  const evalMate = useLiveAnalysisStore((s) => s.mate);
  const refreshGame = useDocumentStore((s) => s.refreshGame);
  const showToast = useToastStore((s) => s.show);

  const coordinatePosition = useBoardPreferencesStore((s) => s.coordinatePosition);
  const boardSizeScale = useBoardPreferencesStore((s) => s.boardSizeScale);
  const setBoardSizeScale = useBoardPreferencesStore((s) => s.setBoardSizeScale);
  const soundTheme = useBoardPreferencesStore((s) => s.soundTheme);

  // Warmed here so the first move of a session does not wait on a file
  // read before it sounds.
  useEffect(() => {
    preloadSoundTheme(soundTheme);
  }, [soundTheme]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState(400);
  const maxBoardSizeRef = useRef(400);
  const showOutsideCoords = coordinatePosition === "outside";
  const emptyDocument = summary !== null && summary.gameCount === 0;

  // The board must stay square, so both axes are measured and the
  // smaller one wins.
  useEffect(() => {
    const el = containerRef.current?.parentElement;

    if (!el) return;

    const measure = (): void => {
      const rect = el.getBoundingClientRect();
      const coordSpace = showOutsideCoords ? OUTSIDE_COORD_GUTTER : 0;
      const maxW = rect.width - 32 - coordSpace;
      const maxH =
        rect.height - CONTROLS_HEIGHT - 32 - coordSpace - PLAYER_BAR_HEIGHT * 2;
      const maxSize = Math.max(200, Math.floor(Math.min(maxW, maxH)));

      maxBoardSizeRef.current = maxSize;

      setBoardSize(Math.max(200, Math.floor(maxSize * boardSizeScale)));
    };

    measure();

    const ro = new ResizeObserver(measure);

    ro.observe(el);

    return () => ro.disconnect();
  }, [showOutsideCoords, boardSizeScale]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSize = boardSize;

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        // Larger axis wins, so a diagonal drag resizes by intent rather
        // than by whichever axis is read first.
        const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
        const newSize = Math.max(200, startSize + delta);
        const newScale = Math.min(1.0, newSize / maxBoardSizeRef.current);

        setBoardSizeScale(newScale);
      };

      const onUp = (): void => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [boardSize, setBoardSizeScale],
  );

  const node = useMemo(
    () => (game && currentId !== "" ? nodeById(game, currentId) : null),
    [game, currentId],
  );

  const fen = node?.fen ?? game?.initialFen ?? INITIAL_FEN;
  const dests = useMemo(() => destsFromFen(fen), [fen]);
  const check = node?.check ?? false;
  const turnColor: "white" | "black" = fen.split(" ")[1] === "b" ? "black" : "white";
  const lastMove: [string, string] | null = node?.uci
    ? [node.uci.slice(0, 2), node.uci.slice(2, 4)]
    : null;

  /**
   * The node's persisted [%csl]/[%cal] shapes, which double as the editable
   * drawable state. At the root there is no node to hang a comment on, so
   * root comments contribute a read-only overlay instead and drawing is off.
   */
  const userShapes = useMemo<BoardShape[]>(() => {
    if (node) {
      return [
        ...node.startingComments.flatMap((c) => c.shapes),
        ...node.comments.flatMap((c) => c.shapes),
      ];
    }

    return [];
  }, [node]);

  const rootShapes = useMemo<BoardShape[]>(
    () => (node ? [] : (game?.rootComments.flatMap((c) => c.shapes) ?? [])),
    [node, game],
  );

  const autoShapes = useMemo<BoardShape[]>(
    () => [...rootShapes, ...(engineShapes ?? [])],
    [rootShapes, engineShapes],
  );

  const readOnly = game?.readOnly ?? false;
  const viewOnly = readOnly || (game === null && !emptyDocument);
  // Drawing serializes into the node's comment, so it needs a node and an
  // editable game.
  const allowDrawing = !readOnly && node !== null;

  const handleMove = useCallback(
    async (orig: string, dest: string, promotion?: PromotionRole) => {
      const st = useDocumentStore.getState();

      if (st.game?.readOnly) return;
      const uci = `${orig}${dest}${promotion ? PROMOTION_UCI[promotion] : ""}`;

      try {
        const res = (await api().addMove(st.gameIndex, st.currentId, uci)) as EditResult;

        if (!res.ok) {
          showToast(res.message);

          return;
        }
        const game = refreshGame(res.game);
        // Advance onto the newly played (or already existing) child.
        const cur = st.currentId === "" ? null : nodeById(game, st.currentId);
        const children = cur ? cur.children : game.children;
        const idx = children.findIndex((c) => c.uci === uci);

        if (idx >= 0) {
          useDocumentStore.getState().navigateTo(st.currentId + stepOf(idx));
          playMoveSoundForCursor();
        }
      } catch {
        // An empty file has no game 0 to play into, so the gesture gets an
        // honest answer rather than a silent failure.
        showToast(
          st.game
            ? "Could not play that move"
            : "This file has no game to play into",
        );
      }
    },
    [refreshGame, showToast],
  );

  const handleShapesChange = useCallback(
    async (shapes: BoardShape[]) => {
      const st = useDocumentStore.getState();

      if (!st.game || st.game.readOnly || st.currentId === "") return;
      const res = (await api().setShapes(st.gameIndex, st.currentId, shapes)) as EditResult;

      if (!res.ok) {
        showToast(res.message);

        return;
      }
      refreshGame(res.game);
    },
    [refreshGame, showToast],
  );

  // chessground needs a real DOM node, so the first paint is a skeleton.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const files =
    orientation === "white"
      ? ["a", "b", "c", "d", "e", "f", "g", "h"]
      : ["h", "g", "f", "e", "d", "c", "b", "a"];
  const ranks =
    orientation === "white"
      ? ["8", "7", "6", "5", "4", "3", "2", "1"]
      : ["1", "2", "3", "4", "5", "6", "7", "8"];

  const boardElement = (
    <div
      className="board-container relative shrink-0"
      style={{ width: boardSize, height: boardSize }}
    >
      {!mounted ? (
        <BoardSkeleton size={boardSize} />
      ) : (
        <BoardView
          allowDrawing={allowDrawing}
          autoShapes={autoShapes}
          check={check}
          dests={dests}
          fen={fen}
          lastMove={lastMove}
          orientation={orientation}
          turnColor={turnColor}
          userShapes={userShapes}
          viewOnly={viewOnly}
          onMove={(o, d, p) => void handleMove(o, d, p)}
          onUserShapesChange={(s) => void handleShapesChange(s)}
        />
      )}
      <div
        aria-label="Resize board"
        aria-valuemax={100}
        aria-valuemin={30}
        aria-valuenow={Math.round(boardSizeScale * 100)}
        className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize opacity-0 transition-opacity hover:opacity-100"
        role="slider"
        tabIndex={-1}
        onMouseDown={handleResizeStart}
      >
        <svg aria-hidden="true" className="text-black/60" height="16" viewBox="0 0 16 16" width="16">
          <path d="M14 16L16 14M9 16L16 9M4 16L16 4" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ display: "contents" }}>
      <div className="no-drag shrink-0">
        {/* Indented past the coordinate gutter so the name lines up with
            the board's left edge. */}
        <div
          style={{
            height: PLAYER_BAR_HEIGHT,
            width: boardSize,
            paddingLeft: showOutsideCoords ? OUTSIDE_COORD_GUTTER : 0,
            marginLeft: showOutsideCoords ? OUTSIDE_COORD_GUTTER : 0,
            boxSizing: "content-box",
          }}
        >
          <PlayerBar position={PLAYER_BAR_POSITION.TOP} />
        </div>
        <div className="flex items-start gap-1">
          {evalScore !== null && (
            <EvaluationBar
              boardOrientation={orientation}
              height={boardSize}
              mate={evalMate}
              score={evalScore}
            />
          )}
          {showOutsideCoords ? (
            <div
              style={{
                width: boardSize + OUTSIDE_COORD_GUTTER,
                height: boardSize + OUTSIDE_COORD_GUTTER,
              }}
            >
              <div style={{ display: "flex", height: boardSize }}>
                <div
                  aria-hidden
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-around",
                    alignItems: "center",
                    width: OUTSIDE_COORD_GUTTER,
                    paddingRight: 3,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--color-txt-dim)",
                  }}
                >
                  {ranks.map((r) => (
                    <span key={r}>{r}</span>
                  ))}
                </div>
                {boardElement}
              </div>
              <div
                aria-hidden
                style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "space-around",
                  alignItems: "center",
                  height: OUTSIDE_COORD_GUTTER,
                  paddingTop: 2,
                  paddingLeft: OUTSIDE_COORD_GUTTER,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--color-txt-dim)",
                }}
              >
                {files.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            </div>
          ) : (
            boardElement
          )}
        </div>
        <div
          style={{
            height: PLAYER_BAR_HEIGHT,
            width: boardSize,
            paddingLeft: showOutsideCoords ? OUTSIDE_COORD_GUTTER : 0,
            marginLeft: showOutsideCoords ? OUTSIDE_COORD_GUTTER : 0,
            boxSizing: "content-box",
          }}
        >
          <PlayerBar position={PLAYER_BAR_POSITION.BOTTOM} />
        </div>
        {emptyDocument && (
          <p
            className="pt-1 text-center text-xs text-txt-dim"
            style={{ width: boardSize + (showOutsideCoords ? OUTSIDE_COORD_GUTTER : 0) }}
          >
            An empty file. Play moves to begin, then press ⌘S to save the game
            into it.
          </p>
        )}
      </div>
      <BoardControls />
    </div>
  );
}
