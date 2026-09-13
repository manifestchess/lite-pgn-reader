/**
 * Read-only preview board for hovering engine-line moves. Piece and board
 * images come from the style tag BoardView injects, so this stays a bare
 * chessground mount.
 */

import type { Api } from "chessground/api";

import { useRef, useEffect } from "react";
import { Chessground } from "chessground";

interface MiniBoardProps {
  fen: string;
  orientation: "white" | "black";
  size?: number;
}

export function MiniBoard({ fen, orientation, size = 180 }: MiniBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<Api | null>(null);

  useEffect(() => {
    if (!boardRef.current) return;

    apiRef.current = Chessground(boardRef.current, {
      fen,
      orientation,
      viewOnly: true,
      coordinates: false,
      animation: { enabled: false },
      drawable: { enabled: false, visible: false },
      highlight: { lastMove: false, check: false },
    });

    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // Only create once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRef.current?.set({ fen, orientation });
  }, [fen, orientation]);

  return (
    <div
      ref={boardRef}
      className="cg-wrap"
      style={{ width: size, height: size }}
    />
  );
}
