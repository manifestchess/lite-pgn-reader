/**
 * Engine vocabulary shared by the main process and the renderer. Bundled
 * WebAssembly engines only; no external engines.
 */

/**
 * Stable ids for the engines shipped in the bundle. The renderer stores the
 * user's choice by id and the main process resolves it to a worker script.
 */
export const BUNDLED_ENGINE = {
  STOCKFISH_18: "stockfish-18",
  STOCKFISH_18_LITE: "stockfish-18-lite",
} as const;
export type BundledEngineId =
  (typeof BUNDLED_ENGINE)[keyof typeof BUNDLED_ENGINE];

/**
 * Lite rather than full NNUE: the lite build cold-starts in well under a
 * second. The full build stays in the catalog as an explicit opt-in.
 */
export const DEFAULT_ENGINE_ID: BundledEngineId =
  BUNDLED_ENGINE.STOCKFISH_18_LITE;

/** Used when the chosen engine cannot run on this system. */
export const FALLBACK_ENGINE_ID: BundledEngineId =
  BUNDLED_ENGINE.STOCKFISH_18_LITE;

/** How an engine executes. WebAssembly engines only. */
export const ENGINE_KIND = {
  /** WebAssembly, run in a Worker inside the cross-origin-isolated host window. */
  WASM: "wasm",
} as const;
export type EngineKind = (typeof ENGINE_KIND)[keyof typeof ENGINE_KIND];

/** Where an engine came from. Every runnable engine is bundled. */
export const ENGINE_SOURCE = {
  BUNDLED: "bundled",
} as const;
export type EngineSource = (typeof ENGINE_SOURCE)[keyof typeof ENGINE_SOURCE];

/** Session lifecycle, owned by the main process. */
export const ENGINE_STATE = {
  IDLE: "idle",
  INITIALIZING: "initializing",
  READY: "ready",
  ANALYZING: "analyzing",
  STOPPING: "stopping",
  TERMINATED: "terminated",
} as const;
export type EngineState = (typeof ENGINE_STATE)[keyof typeof ENGINE_STATE];

/** UCI option types, exactly as the protocol spells them. */
export const UCI_OPTION_TYPE = {
  CHECK: "check",
  SPIN: "spin",
  COMBO: "combo",
  BUTTON: "button",
  STRING: "string",
} as const;
export type UciOptionType =
  (typeof UCI_OPTION_TYPE)[keyof typeof UCI_OPTION_TYPE];

/** A single option as advertised by an engine between `uci` and `uciok`. */
export interface UciOption {
  name: string;
  type: UciOptionType;
  /** Present for every type except button. Strings for combo and string. */
  default?: string | number | boolean;
  /** spin only. */
  min?: number;
  /** spin only. */
  max?: number;
  /** combo only: the permitted values. */
  vars?: string[];
}

/** Values the user has set, keyed by UCI option name. */
export type UciOptionValues = Record<string, string | number | boolean>;

/** How a search is bounded. */
export const GO_MODE = {
  INFINITE: "infinite",
  DEPTH: "depth",
  MOVETIME: "movetime",
  NODES: "nodes",
} as const;
export type GoMode = (typeof GO_MODE)[keyof typeof GO_MODE];

/** A search request. `value` is ignored when mode is infinite. */
export interface GoParams {
  mode: GoMode;
  value?: number;
}

/**
 * One principal variation at one point in the search. Scores are already
 * flipped out of the side-to-move perspective the protocol uses. `pv` stays
 * UCI: SAN conversion happens renderer-side via lib/chess/uci-to-san.ts, so
 * the main process carries no chess logic.
 */
export interface EngineInfo {
  depth: number;
  selDepth?: number;
  multipv: number;
  /** Centipawns, white's perspective. Absent when the line is a forced mate. */
  cp?: number;
  /** Mate in N, white's perspective. Positive means white mates. */
  mate?: number;
  pv: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
  hashfull?: number;
  tbhits?: number;
}

export interface EngineDescriptor {
  /**
   * Never a display name and never an array index: keying on those means
   * deleting one of two same-named engines deletes both.
   */
  id: string;
  displayName: string;
  /** One line explaining the tradeoff, shown wherever engines are listed. */
  description?: string;
  kind: EngineKind;
  source: EngineSource;
  /** Reported by the engine via `id name`, once it has been probed. */
  version?: string;
  /** Populated from the engine's own option block after `uci`. */
  capabilities?: UciOption[];
  /** False when a bundled engine cannot currently be run (no isolation). */
  available: boolean;
  unavailableReason?: string;
}
