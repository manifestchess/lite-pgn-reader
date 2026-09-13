/**
 * Engines shipped inside the application bundle: two Stockfish builds from
 * nmrugg/stockfish.js (GPLv3). The lite NNUE build is the default because it
 * cold-starts in well under a second; the full build is an explicit opt-in
 * and only runs when the host window is cross-origin isolated, because it
 * ships no single-threaded variant.
 */
import {
  BUNDLED_ENGINE,
  ENGINE_KIND,
  ENGINE_SOURCE,
  type BundledEngineId,
  type EngineDescriptor,
} from "../../types/engine";

export {
  BUNDLED_ENGINE,
  DEFAULT_ENGINE_ID,
  FALLBACK_ENGINE_ID,
} from "../../types/engine";
export type { BundledEngineId } from "../../types/engine";

interface BundledEngineSpec {
  descriptor: Omit<EngineDescriptor, "available">;
  /** Worker script for the multi-threaded build, relative to the app origin. */
  multiThreaded: string;
  /**
   * Single-threaded fallback, or null when no such build is shipped. The
   * multi-threaded builds need SharedArrayBuffer and fail to load without
   * it, so null means unavailable on a host that is not isolated.
   */
  singleThreaded: string | null;
}

export const BUNDLED_ENGINES: Record<BundledEngineId, BundledEngineSpec> = {
  [BUNDLED_ENGINE.STOCKFISH_18_LITE]: {
    descriptor: {
      id: BUNDLED_ENGINE.STOCKFISH_18_LITE,
      displayName: "Stockfish 18",
      description: "Smaller network. Starts fast, slightly weaker.",
      kind: ENGINE_KIND.WASM,
      source: ENGINE_SOURCE.BUNDLED,
    },
    multiThreaded: "/stockfish/stockfish-18-lite.js",
    singleThreaded: "/stockfish/stockfish-18-lite-single.js",
  },
  [BUNDLED_ENGINE.STOCKFISH_18]: {
    descriptor: {
      id: BUNDLED_ENGINE.STOCKFISH_18,
      displayName: "Stockfish 18 (full strength)",
      description: "Full neural network. Strongest analysis.",
      kind: ENGINE_KIND.WASM,
      source: ENGINE_SOURCE.BUNDLED,
    },
    multiThreaded: "/stockfish/stockfish-18.js",
    // The single-threaded full build would add 108 MB for the case where
    // isolation is unavailable, which the lite build already covers.
    singleThreaded: null,
  },
};

export function isBundledEngine(id: string): id is BundledEngineId {
  return id in BUNDLED_ENGINES;
}

/** Worker script for an engine, or null when it cannot run on this host. */
export function scriptFor(
  id: BundledEngineId,
  isolated: boolean,
): string | null {
  const spec = BUNDLED_ENGINES[id];

  return isolated ? spec.multiThreaded : spec.singleThreaded;
}

/** Every bundled engine, with availability resolved against the host. */
export function bundledDescriptors(isolated: boolean): EngineDescriptor[] {
  return Object.values(BUNDLED_ENGINES).map((spec) => {
    const runnable = scriptFor(spec.descriptor.id as BundledEngineId, isolated);

    return {
      ...spec.descriptor,
      available: runnable !== null,
      ...(runnable === null
        ? {
            unavailableReason:
              "Needs multi-threading, which is unavailable on this system.",
          }
        : {}),
    };
  });
}
