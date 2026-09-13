/**
 * Chessground binding. Reads the board-preferences store directly:
 * theme/piece CSS is generated at runtime and injected into <head>, visual
 * preference changes rebuild the board, position changes go through
 * api.set() so the move animation survives.
 *
 * Promotion is intercepted here (chessground has already moved the pawn
 * when events.after fires): a pending promotion shows the PromotionPicker;
 * choosing replays the move with the promotion role, cancelling restores
 * the previous fen.
 */

import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Config } from "chessground/config";
import type { DrawShape } from "chessground/draw";
import type { Key } from "chessground/types";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  useBoardPreferencesStore,
  getAnimationMs,
  getBoardThemeUrl,
  getPieceUrl,
  type BoardTheme,
  type PieceSet,
} from "../../store/board-preferences-store";
import { isPromotionMove, type PromotionRole } from "../../lib/chess/promotion";
import { PromotionPicker } from "./PromotionPicker";

export interface BoardShape {
  orig: string;
  dest?: string;
  brush: string;
}

interface Props {
  fen: string;
  orientation: "white" | "black";
  turnColor: "white" | "black";
  lastMove: [string, string] | null;
  check: boolean;
  dests: Record<string, string[]>;
  /** Overlay shapes never persisted (engine arrows). */
  autoShapes?: BoardShape[];
  /** The node's drawn shapes ([%csl]/[%cal]); editable when drawing is allowed. */
  userShapes: BoardShape[];
  /** No move input (read-only game or refused document). */
  viewOnly: boolean;
  /** Drawing writes [%cal]/[%csl] into the document, so read-only games disable it. */
  allowDrawing: boolean;
  onMove?: (orig: string, dest: string, promotion?: PromotionRole) => void;
  onUserShapesChange?: (shapes: BoardShape[]) => void;
}

/** Width of the outside coordinate gutter BoardPanel draws (px). */
export const OUTSIDE_COORD_GUTTER = 18;

const STYLE_TAG = "data-pgnreader-board";

function getThemeStyles(theme: BoardTheme): string {
  return `cg-board { background-image: url("${getBoardThemeUrl(theme)}"); background-size: cover; }`;
}

const PIECES = [
  "wK",
  "wQ",
  "wR",
  "wB",
  "wN",
  "wP",
  "bK",
  "bQ",
  "bR",
  "bB",
  "bN",
  "bP",
] as const;

const ROLE_MAP: Record<string, string> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight",
  P: "pawn",
};

function getPieceStyles(pieceSet: PieceSet): string {
  return PIECES.map((p) => {
    const color = p[0] === "w" ? "white" : "black";
    const role = ROLE_MAP[p[1]!]!;

    // Two selectors, one sprite: the board renders a `piece` element and
    // the promotion picker a plain span, and both must follow the user's
    // chosen piece set.
    return (
      `.cg-wrap piece.${role}.${color},\n` +
      `.promotion-piece.${role}.${color} { background-image: url('${getPieceUrl(pieceSet, p)}'); }`
    );
  }).join("\n");
}

function toDests(rec: Record<string, string[]>): Map<Key, Key[]> {
  const m = new Map<Key, Key[]>();

  for (const [k, v] of Object.entries(rec)) m.set(k as Key, v as Key[]);

  return m;
}

function toDrawShapes(shapes: BoardShape[]): DrawShape[] {
  return shapes.map((s) => ({
    orig: s.orig as Key,
    dest: s.dest as Key | undefined,
    brush: s.brush,
  }));
}

export function BoardView(props: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);
  const propsRef = useRef(props);

  propsRef.current = props;

  const theme = useBoardPreferencesStore((s) => s.theme);
  const pieceSet = useBoardPreferencesStore((s) => s.pieceSet);
  const coordinatePosition = useBoardPreferencesStore((s) => s.coordinatePosition);
  const animationSpeed = useBoardPreferencesStore((s) => s.animationSpeed);
  const customAnimationMs = useBoardPreferencesStore((s) => s.customAnimationMs);
  const moveInput = useBoardPreferencesStore((s) => s.moveInput);
  const showMoveHints = useBoardPreferencesStore((s) => s.showMoveHints);
  const showGhostPiece = useBoardPreferencesStore((s) => s.showGhostPiece);
  const highlightLastMove = useBoardPreferencesStore((s) => s.highlightLastMove);
  const animationDuration = getAnimationMs(animationSpeed, customAnimationMs);

  // Last position we were given, used to undo an abandoned promotion.
  const fenRef = useRef(props.fen);

  fenRef.current = props.fen;

  /**
   * A promotion started but not yet chosen. chessground has already moved
   * the pawn onto the last rank, so while this is set the board shows a
   * position that is not real. Both exits put it back: choosing replays
   * the move, cancelling restores the fen.
   */
  const [pending, setPending] = useState<{
    orig: string;
    dest: string;
    color: "white" | "black";
  } | null>(null);

  const handleMove = useCallback((orig: Key, dest: Key) => {
    // Read `dest`, not `orig`: chessground fires this AFTER moving the
    // piece, so the origin square is already empty.
    const piece = apiRef.current?.state.pieces.get(dest);

    if (isPromotionMove(piece?.role, piece?.color, orig, dest)) {
      setPending({ orig, dest, color: piece!.color });

      return;
    }

    propsRef.current.onMove?.(orig, dest);
  }, []);

  const choosePromotion = useCallback((role: PromotionRole) => {
    setPending((p) => {
      if (p) propsRef.current.onMove?.(p.orig, p.dest, role);

      return null;
    });
  }, []);

  /**
   * The board is mid-move visually, so restoring the last fen is what
   * undoes it. Without this a pawn sits on the last rank as a pawn, a
   * position that does not exist.
   */
  const cancelPromotion = useCallback(() => {
    setPending(null);
    apiRef.current?.set({ fen: fenRef.current });
  }, []);

  const handleShapesChange = useCallback((shapes: DrawShape[]) => {
    propsRef.current.onUserShapesChange?.(
      shapes.map((s) => ({
        orig: s.orig,
        dest: s.dest ?? undefined,
        brush: s.brush ?? "green",
      })),
    );
  }, []);

  // Injected into <head> at runtime: the persisted preference is only
  // known client-side, and external chessground DOM cannot use Tailwind.
  useEffect(() => {
    let el = document.querySelector<HTMLStyleElement>(`style[${STYLE_TAG}]`);

    if (!el) {
      el = document.createElement("style");
      el.setAttribute(STYLE_TAG, "");
      document.head.appendChild(el);
    }
    el.textContent = getThemeStyles(theme) + "\n" + getPieceStyles(pieceSet);
  }, [theme, pieceSet]);

  useEffect(() => {
    if (!hostRef.current) return;

    const p = propsRef.current;
    const config: Config = {
      fen: p.fen,
      orientation: p.orientation,
      turnColor: p.turnColor,
      coordinates: coordinatePosition === "inside",
      check: p.check ? p.turnColor : false,
      lastMove: p.lastMove ? (p.lastMove as Key[]) : undefined,
      movable: {
        free: false,
        color: p.viewOnly ? undefined : "both",
        dests: toDests(p.dests),
        showDests: showMoveHints,
        rookCastle: false,
        events: {
          after: handleMove,
        },
      },
      draggable: {
        enabled: !p.viewOnly && (moveInput === "both" || moveInput === "drag"),
        showGhost: showGhostPiece,
      },
      selectable: {
        enabled: !p.viewOnly && (moveInput === "both" || moveInput === "click"),
      },
      highlight: {
        lastMove: highlightLastMove,
        check: true,
      },
      animation: {
        enabled: animationDuration > 0,
        duration: animationDuration,
      },
      drawable: {
        enabled: p.allowDrawing,
        visible: true,
        eraseOnClick: true,
        shapes: toDrawShapes(p.userShapes),
        autoShapes: toDrawShapes(p.autoShapes ?? []),
        onChange: handleShapesChange,
      },
      disableContextMenu: true,
    };

    apiRef.current = Chessground(hostRef.current, config);

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // Visual preferences only. Position props are pushed through
    // api.set() below instead, which keeps the move animation.
  }, [
    theme,
    pieceSet,
    coordinatePosition,
    animationDuration,
    moveInput,
    showMoveHints,
    showGhostPiece,
    highlightLastMove,
    handleMove,
    handleShapesChange,
  ]);

  useEffect(() => {
    if (!apiRef.current) return;

    apiRef.current.set({
      fen: props.fen,
      orientation: props.orientation,
      turnColor: props.turnColor,
      check: props.check ? props.turnColor : false,
      lastMove: props.lastMove ? (props.lastMove as Key[]) : undefined,
      selected: undefined, // Clear piece selection on position change.
      movable: {
        color: props.viewOnly ? undefined : "both",
        dests: toDests(props.dests),
        rookCastle: false,
      },
      drawable: {
        enabled: props.allowDrawing,
      },
    });
    // A position change also invalidates a pending promotion.
    setPending(null);
  }, [
    props.fen,
    props.orientation,
    props.turnColor,
    props.dests,
    props.lastMove,
    props.check,
    props.viewOnly,
    props.allowDrawing,
  ]);

  useEffect(() => {
    apiRef.current?.setAutoShapes(toDrawShapes(props.autoShapes ?? []));
  }, [props.autoShapes]);

  useEffect(() => {
    apiRef.current?.setShapes(toDrawShapes(props.userShapes));
  }, [props.userShapes]);

  // chessground's ResizeObserver only fires on size changes, so a pane
  // or window resize that moves the board leaves bounds.left/top stale and
  // drags land on the wrong square. Drop them before each interaction.
  useEffect(() => {
    const el = hostRef.current;

    if (!el) return;
    const clearBounds = (): void => {
      apiRef.current?.state.dom.bounds.clear();
    };

    el.addEventListener("pointerdown", clearBounds, { capture: true });
    el.addEventListener("touchstart", clearBounds, { capture: true });

    return () => {
      el.removeEventListener("pointerdown", clearBounds, { capture: true });
      el.removeEventListener("touchstart", clearBounds, { capture: true });
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {pending && (
        <PromotionPicker
          color={pending.color}
          orientation={props.orientation}
          square={pending.dest}
          onCancel={cancelPromotion}
          onSelect={choosePromotion}
        />
      )}
    </div>
  );
}
