/**
 * One move (over WireNode). Two shapes: the mainline is a cell in the column
 * grid, a variation an inline run of text.
 *
 * Rendering behavior:
 * - renders `node.text` (the display token — fused move-number prefixes are stripped on the wire: O-O vs 0-0, e8Q...)
 *   rather than a normalized SAN — byte fidelity extends to the eye;
 * - white/black comes from `node.turn`, not ply parity, so games starting
 *   from a black-to-move FEN lay out correctly;
 * - a suffix fused into the token ("e4!") is not re-rendered as a glyph
 *   (displayNags drops the duplicate).
 */

import { useCallback } from "react";

import type { WireNode } from "../../electron/wire";
import { displayNags, nagColor, nagSymbols } from "../../lib/chess/nag";

export const MOVE_NODE_MODE = {
  MAINLINE: "mainline",
  VARIATION: "variation",
} as const;
export type MoveNodeMode = (typeof MOVE_NODE_MODE)[keyof typeof MOVE_NODE_MODE];

interface MoveNodeProps {
  node: WireNode;
  currentId: string;
  onNavigate: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
  mode: MoveNodeMode;
  showIndex?: boolean;
  depth?: number;
  /** When set, moves at or after this id are marked for deletion. */
  deleteFromId?: string | null;
}

const VARIATION_SIZE: Record<number, string> = {
  0: "text-sm",
  1: "text-sm",
  2: "text-[13px]",
};
const DEEP_VARIATION_SIZE = "text-xs";

export function MoveNode({
  node,
  currentId,
  onNavigate,
  onContextMenu,
  mode,
  showIndex,
  depth = 1,
  deleteFromId,
}: MoveNodeProps): React.ReactElement {
  const isCurrent = node.id === currentId;
  const isWhite = node.turn === "white";
  const isMarkedForDelete = deleteFromId ? node.id.startsWith(deleteFromId) : false;

  const handleClick = useCallback(() => {
    onNavigate(node.id);
  }, [node.id, onNavigate]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu?.(e, node.id);
    },
    [node.id, onContextMenu],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") handleClick();
    },
    [handleClick],
  );

  const shownNags = displayNags(node.text, node.nags);
  const annotationColor = node.nags.length ? nagColor(node.nags) : undefined;

  if (mode === MOVE_NODE_MODE.MAINLINE) {
    return (
      <span
        className={`mv flex flex-[0_0_43.5%] cursor-pointer select-none items-center overflow-hidden text-ellipsis whitespace-nowrap px-1 pl-2 font-chess text-[15px] font-medium leading-7 transition-[background] duration-[80ms] ${
          isMarkedForDelete
            ? "bg-danger/10 text-danger"
            : isCurrent
              ? "active bg-[color-mix(in_srgb,var(--color-primary)_85%,transparent)] font-bold text-accent-foreground"
              : "text-txt hover:bg-[color-mix(in_srgb,var(--color-txt)_15%,transparent)] hover:text-txt-clear"
        }`}
        data-node-id={node.id}
        role="button"
        style={!isCurrent && annotationColor ? { color: annotationColor } : undefined}
        tabIndex={0}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        {node.text}
        {shownNags.length > 0 && (
          <span className="ml-0.5 font-sans text-[13px] font-normal">
            {nagSymbols(shownNags)}
          </span>
        )}
      </span>
    );
  }

  const indexStr = showIndex
    ? isWhite
      ? `${node.moveNumber}.`
      : `${node.moveNumber}...`
    : undefined;

  const fontSize = VARIATION_SIZE[depth] ?? DEEP_VARIATION_SIZE;

  return (
    <span
      className={`vmv inline cursor-pointer select-none rounded-md px-[3px] py-px font-chess ${fontSize} font-medium transition-[background] duration-[80ms] ${
        isMarkedForDelete
          ? "bg-danger/10 text-danger"
          : isCurrent
            ? "active bg-[color-mix(in_srgb,var(--color-primary)_85%,transparent)] text-accent-foreground"
            : "text-txt hover:bg-[color-mix(in_srgb,var(--color-txt)_15%,transparent)] hover:text-txt-clear"
      }`}
      data-node-id={node.id}
      role="button"
      style={!isCurrent && annotationColor ? { color: annotationColor } : undefined}
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
    >
      {indexStr && (
        <span
          className={`mr-px text-[90%] ${isCurrent ? "text-accent-foreground" : "text-txt-dim"}`}
        >
          {indexStr}
        </span>
      )}
      {node.text}
      {shownNags.length > 0 && (
        <span className="ml-0.5 font-sans text-xs font-normal">
          {nagSymbols(shownNags)}
        </span>
      )}
    </span>
  );
}
