/**
 * The engine's principal variations. Fixed number of slots so the panel
 * never jumps when the engine drops or adds a line; hovering a move shows a
 * MiniBoard preview of the position after it.
 */

import type { EngineLine } from "../../lib/engine/client";

import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

import { MiniBoard } from "./MiniBoard";

import { fenAfterUciMoves } from "../../lib/chess/fen-from-uci";

interface EngineLinesProps {
  lines: EngineLine[];
  depth: number;
  isAnalyzing: boolean;
  onLineClick?: (pvSan: string[]) => void;
  boardOrientation: "white" | "black";
  multiPV: number;
  currentFen: string;
}

function formatScore(score: number, mate: number | null): string {
  if (mate !== null) return `#${Math.abs(mate)}`;
  const pawns = score / 100;

  return pawns >= 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
}

function getScoreColor(
  score: number,
  mate: number | null,
  boardOrientation: "white" | "black",
): string {
  const whiteIsBetter =
    mate !== null ? (mate === 0 ? score > 0 : mate > 0) : score > 0;
  const blackIsBetter =
    mate !== null ? (mate === 0 ? score < 0 : mate < 0) : score < 0;

  if (boardOrientation === "white") {
    if (whiteIsBetter) return "text-positive";
    if (blackIsBetter) return "text-danger";
  } else {
    if (blackIsBetter) return "text-positive";
    if (whiteIsBetter) return "text-danger";
  }

  return "text-txt-dim";
}

const PREVIEW_SIZE = 180;

function parseFenTurn(fen: string): { whiteToMove: boolean; fullmove: number } {
  const parts = fen.split(" ");

  return {
    whiteToMove: parts[1] !== "b",
    fullmove: parseInt(parts[5] || "1", 10) || 1,
  };
}

function movePrefix(
  moveIdx: number,
  whiteToMove: boolean,
  fullmove: number,
): string {
  // The first PV move is by the side to move in the FEN
  const isWhite = moveIdx % 2 === 0 ? whiteToMove : !whiteToMove;
  const moveNum = fullmove + Math.floor((moveIdx + (whiteToMove ? 0 : 1)) / 2);

  if (isWhite) return `${moveNum}. `;
  if (moveIdx === 0) return `${moveNum}... `;

  return "";
}

export function EngineLines({
  lines,
  depth: _depth,
  isAnalyzing,
  onLineClick,
  boardOrientation,
  multiPV,
  currentFen,
}: EngineLinesProps) {
  const [hoveredMove, setHoveredMove] = useState<{
    lineIdx: number;
    moveIdx: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    return () => {
      clearTimeout(enterTimerRef.current);
      clearTimeout(leaveTimerRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback((lineIdx: number, moveIdx: number) => {
    clearTimeout(leaveTimerRef.current);
    enterTimerRef.current = setTimeout(() => {
      setHoveredMove({ lineIdx, moveIdx });
    }, 16);
  }, []);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(enterTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      setHoveredMove(null);
    }, 100);
  }, []);

  // Fixed number of slots, always rendered: a variable row count would make
  // the panel jump every time the engine drops or adds a line.
  const visibleLines = lines.filter((l) => l.pvSan.length > 0);
  const lineBySlot = useMemo(() => {
    const map = new Map<number, EngineLine>();

    for (const l of visibleLines) map.set(l.multipv, l);

    return map;
  }, [visibleLines]);

  const previewFen = useMemo(() => {
    if (!hoveredMove) return undefined;
    const line = visibleLines[hoveredMove.lineIdx];

    if (!line) return undefined;

    return fenAfterUciMoves(currentFen, line.pv, hoveredMove.moveIdx + 1);
  }, [hoveredMove, visibleLines, currentFen]);

  // Positioned to the left of the container, since the panel is already
  // against the right edge of the window.
  const [portalPos, setPortalPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  useEffect(() => {
    if (!hoveredMove || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    setPortalPos({
      top: rect.top,
      left: rect.left - PREVIEW_SIZE - 8,
    });
  }, [hoveredMove]);

  if (lines.length === 0 && !isAnalyzing) {
    return (
      <div className="px-2 py-2 text-xs text-txt-dimmer">
        Engine is idle. Navigate to a position to analyze it.
      </div>
    );
  }

  return (
    <div ref={containerRef} data-testid="engine-lines">
      <div className="flex flex-col">
        {Array.from({ length: multiPV }, (_, i) => {
          const slot = i + 1;
          const line = lineBySlot.get(slot);

          return (
            <div
              key={slot}
              className={`h-[3rem] overflow-hidden ${
                i < multiPV - 1 ? "border-b border-transp" : ""
              }`}
            >
              {line && (
                <button
                  className="w-full h-full flex items-start gap-1.5 py-1 px-2 hover:bg-low transition-colors text-left cursor-pointer"
                  data-testid={`engine-line-${slot}`}
                  onClick={() => onLineClick?.(line.pvSan)}
                >
                  <span
                    className={`w-12 shrink-0 font-mono text-xs font-bold text-center self-center ${getScoreColor(
                      line.score,
                      line.mate,
                      boardOrientation,
                    )}`}
                  >
                    {formatScore(line.score, line.mate)}
                  </span>
                  <span className="flex-1 text-xs text-txt-dim font-chess leading-relaxed break-words">
                    {line.pvSan.slice(0, 12).map((san, moveIdx) => {
                      const { whiteToMove, fullmove } =
                        parseFenTurn(currentFen);
                      const prefix = movePrefix(moveIdx, whiteToMove, fullmove);

                      return (
                        <span
                          key={moveIdx}
                          className="hover:text-txt rounded-sm px-[1px] transition-colors"
                          onMouseEnter={() => handleMouseEnter(i, moveIdx)}
                          onMouseLeave={handleMouseLeave}
                        >
                          {moveIdx > 0 ? " " : ""}
                          {prefix && (
                            <span className="text-txt-dimmer">{prefix}</span>
                          )}
                          {san}
                        </span>
                      );
                    })}
                    {line.pvSan.length > 12 && " ..."}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {previewFen &&
        hoveredMove &&
        createPortal(
          <div
            className="rounded-md overflow-hidden shadow-xl border border-white/30"
            style={{
              position: "fixed",
              top: portalPos.top,
              left: portalPos.left,
              zIndex: 9999,
              pointerEvents: "none",
              width: PREVIEW_SIZE,
              height: PREVIEW_SIZE,
            }}
          >
            <MiniBoard
              fen={previewFen}
              orientation={boardOrientation}
              size={PREVIEW_SIZE}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
