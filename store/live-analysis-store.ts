/**
 * Ephemeral output of the live engine, published by AnalysisDock for
 * consumers that live in other parts of the tree (the evaluation bar beside
 * the board, engine arrows on it). Never persisted: it describes the search
 * in flight and empties the moment analysis turns off.
 */

import { create } from "zustand";

/** Chessground-shaped arrow, matching BoardView's BoardShape. */
export interface EngineArrow {
  orig: string;
  dest?: string;
  brush: string;
}

interface LiveAnalysisState {
  /** Mirrors the analysis toggle so consumers need one subscription. */
  enabled: boolean;
  /** Top line's score (white-positive centipawns), or null when idle. */
  score: number | null;
  /** Top line's mate distance (white-positive), or null. */
  mate: number | null;
  depth: number;
  /** Best line paleBlue, other PV first-moves paleGrey. */
  arrows: EngineArrow[];
  publish(next: Omit<LiveAnalysisState, "publish" | "clear">): void;
  clear(): void;
}

const EMPTY = {
  enabled: false,
  score: null,
  mate: null,
  depth: 0,
  arrows: [] as EngineArrow[],
};

export const useLiveAnalysisStore = create<LiveAnalysisState>((set) => ({
  ...EMPTY,
  publish: (next) => set(next),
  clear: () => set(EMPTY),
}));
