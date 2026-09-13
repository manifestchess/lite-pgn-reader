/**
 * React binding for the live analysis engine: create a session, mirror its
 * events into React state, tear it down. The UCI state machine itself lives
 * in the main process (electron/engine/session.ts), where the host window is
 * cross-origin isolated and the engine can therefore use threads.
 *
 * The session is created only while the user has analysis enabled
 * (engine-store `analysisEnabled`, default off). Nothing engine-shaped
 * exists before the first toggle, which keeps the engine off the launch
 * path; disabling disposes the session, and the main process tears the idle
 * host window down with it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  EngineClient,
  DEFAULT_ENGINE_OPTIONS,
  toGoParams,
  resolvedAdvancedValues,
  setActiveEngineClient,
  type EngineClientHandlers,
  EMPTY_SEARCH_STATS,
  type EngineLine,
  type EngineOptions,
  type SearchStats,
} from "../engine/client";
import { ENGINE_STATE, FALLBACK_ENGINE_ID } from "../../types/engine";
import type { EngineDescriptor } from "../../types/engine";
import { useEngineStore } from "../../store/engine-store";
import { api } from "../renderer/api";

export type {
  EngineLine,
  EngineOptions,
  SearchStats,
} from "../engine/client";
export { DEFAULT_ENGINE_OPTIONS } from "../engine/client";
export { pvFirstMove } from "../chess/uci-to-san";

export interface UseLiveEngineState {
  isReady: boolean;
  isAnalyzing: boolean;
  error: string | null;
  lines: EngineLine[];
  depth: number;
  options: EngineOptions;
  /** Search-wide counters for the readout in the analysis panel header. */
  stats: SearchStats;
}

export interface UseLiveEngineReturn {
  state: UseLiveEngineState;
  startAnalysis: (fen: string) => void;
  stopAnalysis: () => void;
  setOptions: (
    options: Partial<EngineOptions>,
    restartWithFen?: string,
  ) => void;
  isSupported: boolean;
  /** True when the host window is isolated, so the Threads control applies. */
  isMultiThreaded: boolean;
  maxThreads: number;
  /** Name the engine reports for itself, for display. */
  engineName: string | null;
  reinitialize: () => void;
}

export function getMaxThreads(): number {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return navigator.hardwareConcurrency;
  }

  return 4;
}

/**
 * Boot the hidden engine host ahead of the first analysis toggle. For the
 * integration layer to call once the window is interactive, on idle. Never
 * call this on the launch path.
 */
export function prewarmEngine(): void {
  void api().enginePrewarm();
}

export function useLiveEngine(): UseLiveEngineReturn {
  const [state, setState] = useState<UseLiveEngineState>({
    isReady: false,
    isAnalyzing: false,
    error: null,
    lines: [],
    depth: 0,
    options: DEFAULT_ENGINE_OPTIONS,
    stats: EMPTY_SEARCH_STATS,
  });
  const [isSupported, setIsSupported] = useState(true);
  const [isMultiThreaded, setIsMultiThreaded] = useState(false);
  const [engineName, setEngineName] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const activeEngineId = useEngineStore((s) => s.activeEngineId);
  const analysisEnabled = useEngineStore((s) => s.analysisEnabled);

  const clientRef = useRef<EngineClient | null>(null);
  const optionsRef = useRef<EngineOptions>(DEFAULT_ENGINE_OPTIONS);
  /** Position awaiting a session that is still booting. */
  const pendingFenRef = useRef<string | null>(null);
  /** Wall-clock of the last automatic restart after a worker death — one
   *  free recovery per 30s window; a second failure inside it surfaces the
   *  error UI. A burst of option changes can kill the WASM worker, so
   *  recovery is automatic rather than a manual toggle. */
  const autoRecoveredAtRef = useRef(0);
  /** Last position handed to any session — retry resumes it, so after an
   *  engine crash Retry reboots the host and analyzes the current position
   *  rather than waiting for the user to navigate. */
  const lastFenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let client: EngineClient | null = null;

    setState((prev) => ({
      ...prev,
      isReady: false,
      isAnalyzing: false,
      error: null,
      lines: [],
      depth: 0,
      stats: EMPTY_SEARCH_STATS,
    }));

    // Everything below exists only while analysis is on. The previous
    // render's cleanup already disposed any session, so an early return
    // leaves nothing engine-shaped alive.
    if (!analysisEnabled) return;

    // Session options start from the persisted preferences, not the module
    // defaults, so a returning user gets their MultiPV and hash back.
    const prefs = useEngineStore.getState();

    optionsRef.current = {
      multiPV: prefs.multiPV,
      threads: prefs.threads,
      hash: prefs.hash,
      searchTime: prefs.searchTime,
    };
    setState((prev) => ({ ...prev, options: optionsRef.current }));

    // Load the catalog so an engine that cannot run here shows as
    // unavailable rather than failing when selected. First called here, on
    // the first enable, so nothing engine-shaped touches the launch path.
    void api()
      .listEngines()
      .then((engines) => {
        if (!cancelled) {
          useEngineStore
            .getState()
            .setAvailableEngines(engines as EngineDescriptor[]);
        }
      })
      .catch(() => {
        /* The UI falls back to showing only the running engine. */
      });

    const handlers: EngineClientHandlers = {
      onLines: (lines, depth, stats) =>
        setState((prev) => ({ ...prev, lines, depth, stats })),
      onBestMove: () => {
        // State transitions are driven by onState; bestmove alone does not
        // mean idle, because a queued search starts immediately after it.
      },
      onError: (message) => {
        const now = Date.now();
        if (now - autoRecoveredAtRef.current > 30_000) {
          // First failure in a while: restart the session silently and
          // resume the position (reinitialize seeds lastFenRef as pending).
          autoRecoveredAtRef.current = now;
          setState((prev) => ({
            ...prev,
            lines: [],
            depth: 0,
            stats: EMPTY_SEARCH_STATS,
            isAnalyzing: false,
          }));
          reinitializeRef.current?.();
          return;
        }
        setState((prev) => ({ ...prev, error: message, isAnalyzing: false }));
      },
      onState: (engineState) =>
        setState((prev) => ({
          ...prev,
          isAnalyzing: engineState === ENGINE_STATE.ANALYZING,
        })),
    };

    // The full build cannot start when the host is not isolated, so fall
    // back to the lite one: quietly weaker analysis beats no analysis.
    EngineClient.create(activeEngineId, optionsRef.current, handlers)
      .catch((err: unknown) => {
        if (cancelled || activeEngineId === FALLBACK_ENGINE_ID) throw err;

        return EngineClient.create(
          FALLBACK_ENGINE_ID,
          optionsRef.current,
          handlers,
        );
      })
      .then(
        (created) => {
          if (cancelled) {
            // Strict-mode double invoke, or unmount mid-boot. Either way
            // this session is orphaned and would leak a worker.
            created.dispose();

            return;
          }
          client = created;
          clientRef.current = created;
          setActiveEngineClient(created);
          setIsMultiThreaded(created.info.multiThreaded);
          setEngineName(created.info.engineName);
          // Published to the store so settings surfaces can offer only the
          // controls this engine actually supports.
          useEngineStore.getState().setEngineRuntime({
            multiThreaded: created.info.multiThreaded,
            maxThreads: getMaxThreads(),
            engineName: created.info.engineName,
            capabilities: created.info.capabilities,
          });

          // A fresh session starts on the engine's own defaults, so the
          // user's advanced overrides have to be sent again.
          const overrides =
            useEngineStore.getState().advancedOptions[created.info.engineId];

          if (overrides && Object.keys(overrides).length > 0) {
            created.setUciValues(
              resolvedAdvancedValues(created.info.capabilities, overrides),
            );
          }
          setState((prev) => ({ ...prev, isReady: true, error: null }));

          const pending = pendingFenRef.current;

          if (pending !== null) {
            pendingFenRef.current = null;
            created.analyze(pending, toGoParams(optionsRef.current.searchTime));
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          setIsSupported(false);
          setState((prev) => ({
            ...prev,
            isReady: false,
            isAnalyzing: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        },
      );

    return () => {
      cancelled = true;
      client?.dispose();
      if (clientRef.current === client) clientRef.current = null;
      setActiveEngineClient(null);
    };
  }, [generation, activeEngineId, analysisEnabled]);

  const advancedOverrides = useEngineStore(
    (s) => s.advancedOptions[s.activeEngineId],
  );

  useEffect(() => {
    const client = clientRef.current;

    if (!client) return;
    // Every advertised option is sent, not just the overridden ones, so
    // clearing an override restores the default now, not at the next restart.
    client.setUciValues(
      resolvedAdvancedValues(client.info.capabilities, advancedOverrides),
    );
  }, [advancedOverrides]);

  const startAnalysis = useCallback((fen: string) => {
    lastFenRef.current = fen;
    const client = clientRef.current;

    if (!client) {
      // Held rather than dropped, so navigating while the engine is still
      // booting still analyses the position you landed on.
      pendingFenRef.current = fen;

      return;
    }
    client.analyze(fen, toGoParams(optionsRef.current.searchTime));
  }, []);

  const stopAnalysis = useCallback(() => {
    pendingFenRef.current = null;
    clientRef.current?.stop();
    setState((prev) => ({ ...prev, isAnalyzing: false }));
  }, []);

  const setOptions = useCallback(
    (partial: Partial<EngineOptions>, restartWithFen?: string) => {
      const merged = { ...optionsRef.current, ...partial };

      optionsRef.current = merged;
      setState((prev) => ({
        ...prev,
        options: merged,
        lines: [],
        depth: 0,
        stats: EMPTY_SEARCH_STATS,
      }));

      const client = clientRef.current;

      if (!client) return;
      client.setOptions(merged);
      if (restartWithFen)
        client.analyze(restartWithFen, toGoParams(merged.searchTime));
    },
    [],
  );

  const reinitializeRef = useRef<(() => void) | null>(null);
  const reinitialize = useCallback(() => {
    setIsSupported(true);
    setState((prev) => ({
      ...prev,
      error: null,
      lines: [],
      depth: 0,
      stats: EMPTY_SEARCH_STATS,
    }));
    // Resume the position the dead session was on: the fresh client picks
    // this up the moment its handshake lands.
    pendingFenRef.current = lastFenRef.current;
    setGeneration((n) => n + 1);
  }, []);
  reinitializeRef.current = reinitialize;

  return {
    state,
    startAnalysis,
    stopAnalysis,
    setOptions,
    isSupported,
    isMultiThreaded,
    maxThreads: getMaxThreads(),
    engineName,
    reinitialize,
  };
}
