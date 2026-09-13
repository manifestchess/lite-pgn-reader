/**
 * NAG glyph selector. Two mutually exclusive groups: move quality and
 * position evaluation. Toggling a glyph clears the other members of its
 * group rather than accumulating; NAGs outside either group (e.g. $22) are
 * preserved untouched.
 */

import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import {
  MOVE_NAGS,
  NAG_LABELS,
  POSITION_NAGS,
  nagColor,
  nagToSymbol,
  toggleGroupNag,
} from "../../lib/chess/nag";

interface GlyphSelectorProps {
  x: number;
  y: number;
  currentNags: number[];
  onSetNags: (nags: number[]) => void;
  onClose: () => void;
}

export function GlyphSelector({
  x,
  y,
  currentNags,
  onSetNags,
  onClose,
}: GlyphSelectorProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Viewport clamping
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, []);

  const handleToggle = useCallback(
    (nag: number) => {
      onSetNags(toggleGroupNag(currentNags, nag));
    },
    [currentNags, onSetNags],
  );

  const renderRow = (nags: readonly number[], label: string): React.ReactElement => (
    <div>
      <div className="mb-0.5 px-0.5 text-[10px] text-txt-dimmer">{label}</div>
      <div className="flex flex-wrap gap-0.5">
        {nags.map((nag) => {
          const isActive = currentNags.includes(nag);
          const color = nagColor([nag]);
          return (
            <button
              key={nag}
              className={`h-[28px] w-[32px] cursor-pointer rounded-md font-chess text-sm font-medium transition-colors duration-75 ${
                isActive
                  ? "bg-primary text-accent-foreground"
                  : "bg-default text-txt hover:bg-default-hover"
              }`}
              data-testid={`glyph-${nag}`}
              style={!isActive && color ? { color } : undefined}
              // The fallback is the NAG's own number, which is what a PGN
              // calls a glyph nobody has named.
              title={NAG_LABELS[nag] ?? `$${nag}`}
              onClick={() => handleToggle(nag)}
            >
              {nagToSymbol(nag)}
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[100] flex flex-col gap-1.5 overflow-hidden rounded-lg border border-transp bg-overlay p-2 shadow-lg"
      style={{ left: x, top: y }}
    >
      {renderRow(MOVE_NAGS, "Move")}
      {renderRow(POSITION_NAGS, "Position")}
    </div>,
    document.body,
  );
}
