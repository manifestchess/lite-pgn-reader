/**
 * The one place the live engine hook is mounted, keeping App.tsx a two-line
 * mount. Owns useLiveEngine, follows the document cursor, renders
 * AnalysisPanel, and publishes the top line + arrow shapes to
 * live-analysis-store for the evaluation bar and board arrows to consume
 * from elsewhere in the tree.
 *
 * View-only by construction: analysis never touches the document model, so
 * it can never dirty the file, and it works on read-only games.
 */

import { useEffect, useMemo, useRef } from "react";

import { AnalysisPanel } from "./AnalysisPanel";

import { useLiveEngine, pvFirstMove } from "../../lib/hooks/use-live-engine";
import { useEngineStore } from "../../store/engine-store";
import {
  useLiveAnalysisStore,
  type EngineArrow,
} from "../../store/live-analysis-store";
import { nodeById, useDocumentStore } from "../../store/document-store";
import { BUNDLED_ENGINES, isBundledEngine } from "../../electron/engine/bundled";
import type { EngineLine } from "../../lib/engine/client";

/** Arrow brushes: best line pale blue, alternatives pale grey. */
function arrowsFor(lines: EngineLine[], showArrows: boolean): EngineArrow[] {
  if (!showArrows) return [];
  const arrows: EngineArrow[] = [];

  for (const line of lines) {
    const move = pvFirstMove(line.pv);

    if (!move) continue;
    arrows.push({
      orig: move[0],
      dest: move[1],
      brush: line.multipv === 1 ? "paleBlue" : "paleGrey",
    });
  }

  return arrows;
}

export function AnalysisDock(): React.ReactElement | null {
  const engine = useLiveEngine();

  const game = useDocumentStore((s) => s.game);
  const currentId = useDocumentStore((s) => s.currentId);
  const orientation = useDocumentStore((s) => s.orientation);

  const analysisEnabled = useEngineStore((s) => s.analysisEnabled);
  const setAnalysisEnabled = useEngineStore((s) => s.setAnalysisEnabled);
  const activeEngineId = useEngineStore((s) => s.activeEngineId);
  const showArrows = useEngineStore((s) => s.showArrows);
  const multiPV = useEngineStore((s) => s.multiPV);
  const threads = useEngineStore((s) => s.threads);
  const hash = useEngineStore((s) => s.hash);
  const searchTime = useEngineStore((s) => s.searchTime);

  const fen = useMemo(() => {
    if (!game) return null;
    const node = currentId === "" ? null : nodeById(game, currentId);

    return node ? node.fen : game.initialFen;
  }, [game, currentId]);

  const { startAnalysis, setOptions } = engine;

  // Fresh-read refs for the debounced preference apply below: a stale
  // closure could fire setOptions with restartWithFen=undefined, which
  // STOPS the live search without restarting it. Reading current values
  // guarantees a restart whenever analysis is on.
  const fenRef = useRef(fen);
  fenRef.current = fen;
  const enabledRef = useRef(analysisEnabled);
  enabledRef.current = analysisEnabled;

  // Follow the cursor. startAnalysis holds the FEN while the session boots,
  // and the session collapses rapid navigation to the last position.
  useEffect(() => {
    if (!analysisEnabled || !fen) return;
    startAnalysis(fen);
  }, [analysisEnabled, fen, startAnalysis]);

  // Preference changes reach the live session, restarting the search on the
  // current position. DEBOUNCED: a slider drag emits a value per tick, and
  // each apply is a stop/setoption/go cycle — resizing a 1GB hash table per
  // tick could kill the WASM worker outright. One settle, one restart.
  useEffect(() => {
    const t = setTimeout(() => {
      setOptions(
        { multiPV, threads, hash, searchTime },
        enabledRef.current && fenRef.current ? fenRef.current : undefined,
      );
    }, 350);
    return () => clearTimeout(t);
    // Deliberately not keyed on fen/analysisEnabled: this effect exists for
    // preference changes only; navigation is handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiPV, threads, hash, searchTime, setOptions]);

  // Publish for the evaluation bar and board arrows.
  const { lines, depth } = engine.state;

  useEffect(() => {
    if (!analysisEnabled) {
      useLiveAnalysisStore.getState().clear();

      return;
    }
    const top = lines.find((l) => l.multipv === 1) ?? lines[0] ?? null;

    useLiveAnalysisStore.getState().publish({
      enabled: true,
      score: top ? top.score : null,
      mate: top ? top.mate : null,
      depth,
      arrows: arrowsFor(lines, showArrows),
    });
  }, [analysisEnabled, lines, depth, showArrows]);

  const engineLabel = isBundledEngine(activeEngineId)
    ? BUNDLED_ENGINES[activeEngineId].descriptor.displayName
    : "Stockfish";

  return (
    <AnalysisPanel
      analysisEnabled={analysisEnabled}
      boardOrientation={orientation}
      currentFen={fen ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}
      depth={engine.state.depth}
      engineLabel={engineLabel}
      engineName={engine.engineName}
      error={engine.state.error}
      isAnalyzing={engine.state.isAnalyzing}
      lines={engine.state.lines}
      options={engine.state.options}
      stats={engine.state.stats}
      threads={engine.isMultiThreaded ? engine.state.options.threads : 1}
      onRetry={engine.reinitialize}
      onToggleAnalysis={setAnalysisEnabled}
    />
  );
}
