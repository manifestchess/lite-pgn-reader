/**
 * Piece picker shown when a pawn reaches the last rank: a vertical strip
 * over the promotion square, queen nearest it, growing away from the edge
 * so it stays on the board.
 *
 * Dismissing cancels the move rather than silently promoting to a queen,
 * so an accidental open gives the pawn back. Keyboard: q/r/b/n select,
 * Escape cancels, arrow keys cycle focus.
 */

import { useEffect, useRef } from "react";

import {
  PROMOTION_KEYS,
  PROMOTION_ROLES,
  type PromotionRole,
} from "../../lib/chess/promotion";

interface PromotionPickerProps {
  /** Square the pawn is promoting on, e.g. "b8". */
  square: string;
  /** Colour of the promoting side, so the right pieces are shown. */
  color: "white" | "black";
  /** Board orientation, which decides whether the list grows up or down. */
  orientation: "white" | "black";
  onSelect: (role: PromotionRole) => void;
  /** Dismissed without choosing, which cancels the move. */
  onCancel: () => void;
}

const ROLE_LABEL: Record<PromotionRole, string> = {
  queen: "Promote to queen",
  rook: "Promote to rook",
  bishop: "Promote to bishop",
  knight: "Promote to knight",
};

export function PromotionPicker({
  square,
  color,
  orientation,
  onSelect,
  onCancel,
}: PromotionPickerProps): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const flipped = orientation === "black";

  // Columns count from the viewer's left, not from file a.
  const col = flipped ? 7 - file : file;
  // Hang the strip off whichever edge the pawn promoted on so it never
  // runs off the board.
  const fromTop = flipped ? rank === 0 : rank === 7;

  /**
   * Capture phase throughout, because the app binds arrow keys to move
   * navigation and would otherwise walk the game while the player is
   * still choosing. Letters match the SAN a player would type.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const stop = (): void => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (e.key === "Escape") {
        stop();
        onCancel();

        return;
      }

      const byLetter = PROMOTION_KEYS[e.key.toLowerCase()];

      if (byLetter) {
        stop();
        onSelect(byLetter);

        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        stop();

        const buttons = [
          ...(ref.current?.querySelectorAll("button") ?? []),
        ] as HTMLButtonElement[];
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        // The strip renders bottom-up off the lower edge, so "up" must
        // mean up on screen, not up the array.
        const forward = e.key === "ArrowDown" ? 1 : -1;
        const step = fromTop ? forward : -forward;
        const next = (at + step + buttons.length) % buttons.length;

        buttons[next]?.focus();
      }
    };

    window.addEventListener("keydown", onKey, { capture: true });

    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel, onSelect, fromTop]);

  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
  }, []);

  return (
    <>
      {/* Click-away layer, so a stray click cancels instead of landing on
          another square. */}
      <div
        aria-hidden
        className="promotion-fade absolute inset-0 z-20 bg-black/50"
        data-testid="promotion-backdrop"
        onClick={onCancel}
      />
      <div
        ref={ref}
        aria-label="Choose promotion piece"
        className="promotion-fade absolute z-30 flex flex-col overflow-hidden rounded-md shadow-2xl ring-1 ring-black/30"
        data-testid="promotion-picker"
        role="dialog"
        style={{
          left: `${col * 12.5}%`,
          width: "12.5%",
          ...(fromTop ? { top: 0 } : { bottom: 0 }),
          flexDirection: fromTop ? "column" : "column-reverse",
        }}
      >
        {PROMOTION_ROLES.map((role) => (
          <button
            key={role}
            aria-label={ROLE_LABEL[role]}
            /* Backdrop and ring key off the PIECE colour, never the app
               theme. The sprites are fixed colours, so a theme-following
               panel would hide black pieces in dark mode. */
            className={`group relative w-full cursor-pointer border-none p-0 outline-none transition-colors duration-100 hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:ring-2 focus-visible:ring-inset ${
              color === "black"
                ? "bg-neutral-200/95 focus-visible:ring-[var(--promotion-ring-on-light)]"
                : "bg-neutral-800/95 focus-visible:ring-[var(--promotion-ring-on-dark)]"
            }`}
            data-testid={`promotion-${role}`}
            style={{ aspectRatio: "1 / 1" }}
            title={ROLE_LABEL[role]}
            type="button"
            onClick={() => onSelect(role)}
          >
            {/* BoardView's generated stylesheet points .promotion-piece at
                the board's own sprites, so the picker follows the user's
                chosen piece set. */}
            <span
              className={`promotion-piece ${role} ${color} absolute inset-0 bg-contain bg-center bg-no-repeat transition-transform duration-100 group-hover:scale-110 group-focus-visible:scale-110`}
            />
          </button>
        ))}
      </div>
    </>
  );
}
