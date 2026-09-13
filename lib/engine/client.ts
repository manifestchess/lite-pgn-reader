/**
 * Renderer-side handle on a main-process engine session. The renderer owns
 * no Worker: it asks the main process for a session and receives coalesced
 * batches over IPC, which is what lets the engine run in the
 * cross-origin-isolated host window and therefore multi-threaded.
 */
import type {
  EngineInfo,
  EngineState,
  GoParams,
  UciOption,
} from "../../types/engine";
import { GO_MODE } from "../../types/engine";
import { uciToSan } from "../chess/uci-to-san";
import { api } from "../renderer/api";

/** One principal variation, ready for display. */
export interface EngineLine {
  depth: number;
  /** Centipawns, white's perspective. Mates are encoded near +/-10000. */
  score: number;
  /** Moves to mate, white's perspective, or null. */
  mate: number | null;
  pv: string[];
  pvSan: string[];
  multipv: number;
}

/** The four controls the UI exposes directly. Everything else is a UCI option. */
export interface EngineOptions {
  multiPV: number;
  threads: number;
  hash: number;
  /** Seconds, or null for an unbounded search. */
  searchTime: number | null;
}

/**
 * One set of defaults, shared with the preferences store. 128 MB is the
 * single hash default and the one source of truth; keep it modest.
 */
export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  multiPV: 1,
  threads: 1,
  hash: 128,
  searchTime: null,
};

/**
 * Encode a mate as a centipawn score. The eval bar reads this scale: mate in
 * N beats any centipawn score and nearer mates rank higher.
 */
export function scoreFromInfo(info: EngineInfo): number {
  if (info.mate !== null && info.mate !== undefined) {
    return info.mate > 0 ? 10000 - info.mate : -10000 - info.mate;
  }

  return info.cp ?? 0;
}

/** Turn a main-process info batch into displayable lines. */
export function toEngineLines(fen: string, batch: EngineInfo[]): EngineLine[] {
  return batch.map((info) => ({
    depth: info.depth,
    score: scoreFromInfo(info),
    mate: info.mate ?? null,
    pv: info.pv,
    pvSan: uciToSan(fen, info.pv),
    multipv: info.multipv,
  }));
}

/** Translate the curated options into the UCI names engines actually use. */
export function toUciValues(
  options: EngineOptions,
  multiThreaded: boolean,
): Record<string, number> {
  const values: Record<string, number> = {
    MultiPV: options.multiPV,
    Hash: options.hash,
  };

  // A single-threaded build rejects the Threads option outright.
  if (multiThreaded) values.Threads = options.threads;

  return values;
}

/**
 * UCI option names the curated controls already own. Excluded from the
 * advanced list so one value never ends up behind two controls with
 * different widgets and different ranges.
 */
export const CURATED_UCI_OPTIONS = new Set(["MultiPV", "Threads", "Hash"]);

/**
 * Every advertised option the curated controls do not own, using the user's
 * override where present and the engine's own default otherwise.
 *
 * Defaults are sent explicitly because that is what makes "reset" work
 * without restarting: merely dropping an override leaves the previously-set
 * value live in the engine until the next session. Buttons are excluded,
 * being actions rather than values.
 */
export function resolvedAdvancedValues(
  capabilities: UciOption[],
  overrides: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};

  for (const option of capabilities) {
    if (option.type === "button") continue;
    if (CURATED_UCI_OPTIONS.has(option.name)) continue;

    const override = overrides?.[option.name];

    if (override !== undefined) {
      values[option.name] = override;
    } else if (option.default !== undefined) {
      values[option.name] = option.default;
    }
  }

  return values;
}

/** Search bounds from the user's search-time preference. */
export function toGoParams(searchTime: number | null): GoParams {
  return searchTime === null
    ? { mode: GO_MODE.INFINITE }
    : { mode: GO_MODE.MOVETIME, value: Math.round(searchTime * 1000) };
}

/**
 * Search-wide counters, as opposed to per-variation data. Engines repeat
 * these on every info line, and the highest-depth line in a batch carries the
 * freshest values.
 */
export interface SearchStats {
  nps: number;
  nodes: number;
  timeMs: number;
  /** Transposition table occupancy in permille, as UCI reports it. */
  hashfull: number;
}

export const EMPTY_SEARCH_STATS: SearchStats = {
  nps: 0,
  nodes: 0,
  timeMs: 0,
  hashfull: 0,
};

/** Take the counters from the deepest line in a batch. */
export function statsFromBatch(batch: EngineInfo[]): SearchStats {
  const deepest = batch.reduce<EngineInfo | null>(
    (best, info) => (best === null || info.depth > best.depth ? info : best),
    null,
  );

  if (!deepest) return EMPTY_SEARCH_STATS;

  return {
    nps: deepest.nps ?? 0,
    nodes: deepest.nodes ?? 0,
    timeMs: deepest.timeMs ?? 0,
    hashfull: deepest.hashfull ?? 0,
  };
}

export interface EngineClientHandlers {
  onLines(lines: EngineLine[], depth: number, stats: SearchStats): void;
  onBestMove(bestMove: string | null): void;
  onError(message: string): void;
  /** Authoritative lifecycle, owned by the main process. */
  onState(state: EngineState): void;
}

export interface EngineClientInfo {
  /** The catalog id this session was created from. */
  engineId: string;
  sessionId: string;
  engineName: string | null;
  capabilities: UciOption[];
  multiThreaded: boolean;
}

/** What IPC_ENGINE.CREATE_SESSION resolves to. */
type CreateSessionResult =
  | {
      ok: true;
      session: {
        sessionId: string;
        engineName: string | null;
        capabilities: UciOption[];
        multiThreaded: boolean;
      };
    }
  | { ok: false; message: string };

/**
 * A live engine session. Created via `EngineClient.create`, which resolves
 * only once the engine has completed its handshake, so callers never have to
 * guess whether it is ready.
 */
export class EngineClient {
  private disposed = false;
  private unsubscribes: Array<() => void> = [];
  /** The position the current search is for, needed to render SAN. */
  private currentFen = "";

  private constructor(
    readonly info: EngineClientInfo,
    private readonly handlers: EngineClientHandlers,
  ) {
    const bridge = api();

    this.unsubscribes.push(
      bridge.onEngineInfo((payload) => {
        const { sessionId, batch } = payload as {
          sessionId: string;
          batch: EngineInfo[];
        };

        if (sessionId !== this.info.sessionId || this.disposed) return;
        const lines = toEngineLines(this.currentFen, batch);
        const depth = lines.reduce((max, l) => Math.max(max, l.depth), 0);

        this.handlers.onLines(lines, depth, statsFromBatch(batch));
      }),
      bridge.onEngineBestmove((payload) => {
        const { sessionId, bestMove } = payload as {
          sessionId: string;
          bestMove: string | null;
        };

        if (sessionId !== this.info.sessionId || this.disposed) return;
        this.handlers.onBestMove(bestMove);
      }),
      bridge.onEngineError((payload) => {
        const { sessionId, message } = payload as {
          sessionId: string;
          message: string;
        };

        if (sessionId !== this.info.sessionId || this.disposed) return;
        this.handlers.onError(message);
      }),
      bridge.onEngineState((payload) => {
        const { sessionId, state } = payload as {
          sessionId: string;
          state: EngineState;
        };

        if (sessionId !== this.info.sessionId || this.disposed) return;
        this.handlers.onState(state);
      }),
    );
  }

  static async create(
    engineId: string,
    options: EngineOptions,
    handlers: EngineClientHandlers,
  ): Promise<EngineClient> {
    // Threads is applied only after the session reports whether the build is
    // multi-threaded, since a single-threaded one rejects the option.
    const result = (await api().createEngineSession(engineId, {
      MultiPV: options.multiPV,
      Hash: options.hash,
    })) as CreateSessionResult;

    if (!result.ok) throw new Error(result.message);

    const client = new EngineClient({ ...result.session, engineId }, handlers);

    if (result.session.multiThreaded) {
      await api().setEngineOptions(result.session.sessionId, {
        Threads: options.threads,
      });
    }

    return client;
  }

  /**
   * Start a search, replacing any already running. Takes GoParams rather
   * than a search time so callers can bound searches however they need.
   */
  analyze(fen: string, go: GoParams): void {
    if (this.disposed) return;
    this.currentFen = fen;
    void api().engineAnalyze(this.info.sessionId, fen, go);
  }

  /** Press a button-type option, which is an action rather than a value. */
  pressButton(name: string): void {
    if (this.disposed) return;
    void api().enginePressButton(this.info.sessionId, name);
  }

  /** Apply arbitrary UCI values, for options outside the curated four. */
  setUciValues(values: Record<string, string | number | boolean>): void {
    if (this.disposed) return;
    void api().setEngineOptions(this.info.sessionId, values);
  }

  stop(): void {
    if (this.disposed) return;
    void api().engineStop(this.info.sessionId);
  }

  setOptions(options: EngineOptions): void {
    if (this.disposed) return;
    void api().setEngineOptions(
      this.info.sessionId,
      toUciValues(options, this.info.multiThreaded),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    void api().disposeEngineSession(this.info.sessionId);
  }
}

/**
 * The live analysis session, if one exists. Null whenever none is running.
 *
 * Registered by use-live-engine and read by whatever settings surface needs
 * to press `button`-type UCI options such as "Clear Hash". Those are actions
 * rather than values, so they cannot go through the preferences store.
 */
let activeClient: EngineClient | null = null;

export function setActiveEngineClient(client: EngineClient | null): void {
  activeClient = client;
}

export function getActiveEngineClient(): EngineClient | null {
  return activeClient;
}
