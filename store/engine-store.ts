/**
 * Engine preferences. Persisted to localStorage; runtime facts about the live
 * session are kept separately and never persisted.
 *
 * Defaults: lite engine, MultiPV 1, Threads 1, Hash 128 MB, unbounded search,
 * analysis OFF until the user asks for it, arrows on.
 */

import { create } from "zustand";

import type { EngineOptions } from "../lib/engine/client";
import type {
  EngineDescriptor,
  UciOption,
  UciOptionValues,
} from "../types/engine";
import { DEFAULT_ENGINE_ID } from "../types/engine";
import { BUNDLED_ENGINE } from "../types/engine";

const STORAGE_KEY = "pgnreader-engine-settings";

export interface EnginePreferences {
  /** The engine the user has chosen for live analysis. */
  activeEngineId: string;
  advancedOptions: AdvancedOptionsByEngine;
  multiPV: number;
  threads: number;
  hash: number;
  searchTime: number | null;
  analysisEnabled: boolean;
  showArrows: boolean;
}

export const DEFAULT_MULTI_PV = 1;
export const DEFAULT_THREADS = 1;
export const DEFAULT_HASH = 128;
export const DEFAULT_SEARCH_TIME: number | null = null;
export const DEFAULT_SHOW_ARROWS = true;

const DEFAULT_PREFS: EnginePreferences = {
  activeEngineId: DEFAULT_ENGINE_ID,
  advancedOptions: {},
  multiPV: DEFAULT_MULTI_PV,
  threads: DEFAULT_THREADS,
  hash: DEFAULT_HASH,
  searchTime: DEFAULT_SEARCH_TIME,
  // Analysis stays off until asked; opening a file never starts the engine.
  analysisEnabled: false,
  showArrows: DEFAULT_SHOW_ARROWS,
};

const KNOWN_ENGINE_IDS = new Set<string>(Object.values(BUNDLED_ENGINE));

function loadPrefs(): EnginePreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const stored = {
        ...DEFAULT_PREFS,
        ...(JSON.parse(raw) as Partial<EnginePreferences>),
      };

      // A stored id for an engine this build does not ship must not wedge
      // analysis.
      if (!KNOWN_ENGINE_IDS.has(stored.activeEngineId)) {
        stored.activeEngineId = DEFAULT_ENGINE_ID;
      }

      return stored;
    }
  } catch {
    // ignore
  }

  return DEFAULT_PREFS;
}

function savePrefs(prefs: EnginePreferences) {
  try {
    // Written key by key: callers pass the whole store, and transient
    // runtime fields must never reach localStorage.
    const persisted: EnginePreferences = {
      activeEngineId: prefs.activeEngineId,
      advancedOptions: prefs.advancedOptions,
      multiPV: prefs.multiPV,
      threads: prefs.threads,
      hash: prefs.hash,
      searchTime: prefs.searchTime,
      analysisEnabled: prefs.analysisEnabled,
      showArrows: prefs.showArrows,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // ignore
  }
}

/**
 * Facts about the running engine, as opposed to the user's preferences. Never
 * persisted: they describe whichever session happens to be live, and let a
 * settings surface show only controls that engine actually supports.
 */
export interface EngineRuntime {
  multiThreaded: boolean;
  maxThreads: number;
  engineName: string | null;
  /** Parsed from the engine's own UCI `option name` block. */
  capabilities: UciOption[];
}

/**
 * UCI options the user has changed, keyed by engine id then option name. Per
 * engine because engines share option names but not their meanings or ranges.
 * Anything absent is left at that engine's own default.
 */
export type AdvancedOptionsByEngine = Record<string, UciOptionValues>;

function detectMaxThreads(): number {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return navigator.hardwareConcurrency;
  }

  return 4;
}

export interface EngineStoreState extends EnginePreferences {
  engineRuntime: EngineRuntime;
  setEngineRuntime: (runtime: EngineRuntime) => void;
  /** Engines this build can run, as reported by the main process. */
  availableEngines: EngineDescriptor[];
  setAvailableEngines: (engines: EngineDescriptor[]) => void;
  /** Choose the engine for live analysis. */
  setActiveEngine: (engineId: string) => void;
  /** Set one advanced UCI option for one engine. */
  setAdvancedOption: (
    engineId: string,
    name: string,
    value: string | number | boolean,
  ) => void;
  /** Drop an override so the engine's own default applies again. */
  resetAdvancedOption: (engineId: string, name: string) => void;
  /** Drop every override for one engine. */
  resetAdvancedOptions: (engineId: string) => void;
  setAnalysisEnabled: (enabled: boolean) => void;
  toggleAnalysis: () => void;
  setShowArrows: (show: boolean) => void;
  setEngineOptions: (opts: Partial<EngineOptions>) => void;
  resetEngineOptions: () => void;
}

export const useEngineStore = create<EngineStoreState>((set, get) => {
  const initial = loadPrefs();

  return {
    ...initial,
    engineRuntime: {
      multiThreaded: false,
      maxThreads: detectMaxThreads(),
      engineName: null,
      capabilities: [],
    },

    setEngineRuntime: (runtime) => set({ engineRuntime: runtime }),

    availableEngines: [],
    setAvailableEngines: (engines) => set({ availableEngines: engines }),

    setActiveEngine: (engineId) => {
      if (get().activeEngineId === engineId) return;
      set({ activeEngineId: engineId });
      savePrefs({ ...get(), activeEngineId: engineId });
    },

    setAdvancedOption: (engineId, name, value) => {
      const current = get().advancedOptions;
      const updated = {
        ...current,
        [engineId]: { ...(current[engineId] ?? {}), [name]: value },
      };

      set({ advancedOptions: updated });
      savePrefs({ ...get(), advancedOptions: updated });
    },

    resetAdvancedOption: (engineId, name) => {
      const current = get().advancedOptions;
      const forEngine = { ...(current[engineId] ?? {}) };

      delete forEngine[name];
      const updated = { ...current, [engineId]: forEngine };

      set({ advancedOptions: updated });
      savePrefs({ ...get(), advancedOptions: updated });
    },

    resetAdvancedOptions: (engineId) => {
      const updated = { ...get().advancedOptions, [engineId]: {} };

      set({ advancedOptions: updated });
      savePrefs({ ...get(), advancedOptions: updated });
    },

    setAnalysisEnabled: (enabled) => {
      set({ analysisEnabled: enabled });
      savePrefs({ ...get(), analysisEnabled: enabled });
    },

    toggleAnalysis: () => {
      get().setAnalysisEnabled(!get().analysisEnabled);
    },

    setShowArrows: (show) => {
      set({ showArrows: show });
      savePrefs({ ...get(), showArrows: show });
    },

    setEngineOptions: (opts) => {
      const updated = {
        ...get(),
        ...(opts.multiPV !== undefined && { multiPV: opts.multiPV }),
        ...(opts.threads !== undefined && { threads: opts.threads }),
        ...(opts.hash !== undefined && { hash: opts.hash }),
        ...(opts.searchTime !== undefined && { searchTime: opts.searchTime }),
      };

      set(updated);
      savePrefs(updated);
    },

    resetEngineOptions: () => {
      const reset = {
        multiPV: DEFAULT_MULTI_PV,
        threads: DEFAULT_THREADS,
        hash: DEFAULT_HASH,
        searchTime: DEFAULT_SEARCH_TIME,
        showArrows: DEFAULT_SHOW_ARROWS,
      };

      set(reset);
      savePrefs({ ...get(), ...reset });
    },
  };
});
