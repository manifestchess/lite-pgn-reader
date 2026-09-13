/**
 * Engine settings: the knobs the app exposes — lines, threads, memory,
 * search time, arrows. Reads and writes store/engine-store.ts; the engine
 * session client consumes the same store, and until it reports a
 * multi-threaded runtime the thread slider stays hidden.
 */

import { Slider } from "@heroui/react";

import { ToggleSetting } from "./ToggleSetting";

import { useEngineStore } from "../../store/engine-store";

/** `null` is "no limit", drawn as the infinity sign. */
const UNLIMITED_LABEL = "∞";

const SEARCH_TIME_OPTIONS: { value: number | null }[] = [
  { value: 1 },
  { value: 2 },
  { value: 4 },
  { value: 8 },
  { value: 16 },
  { value: 32 },
  { value: null },
];

const MEMORY_OPTIONS = [16, 32, 64, 128, 256, 512, 1024];

function one(v: number | number[]): number {
  return Array.isArray(v) ? (v[0] ?? 0) : v;
}

export function EngineSettings(): React.ReactElement {
  const multiPV = useEngineStore((s) => s.multiPV);
  const threads = useEngineStore((s) => s.threads);
  const hash = useEngineStore((s) => s.hash);
  const searchTime = useEngineStore((s) => s.searchTime);
  const showArrows = useEngineStore((s) => s.showArrows);
  const setEngineOptions = useEngineStore((s) => s.setEngineOptions);
  const setShowArrows = useEngineStore((s) => s.setShowArrows);

  // Never feature-detect this locally: the renderer document is not
  // cross-origin isolated, so a local check would say no even while the
  // engine runs multi-threaded in its host window.
  const isMultiThreaded = useEngineStore((s) => s.engineRuntime.multiThreaded);
  const maxThreads = Math.max(
    1,
    useEngineStore((s) => s.engineRuntime.maxThreads),
  );

  const searchTimeIndex = SEARCH_TIME_OPTIONS.findIndex(
    (opt) => opt.value === searchTime,
  );
  const currentSearchTimeIndex =
    searchTimeIndex >= 0 ? searchTimeIndex : SEARCH_TIME_OPTIONS.length - 1;
  const currentSearchTime =
    SEARCH_TIME_OPTIONS[currentSearchTimeIndex]?.value ?? null;

  const memoryIndex = MEMORY_OPTIONS.indexOf(hash);
  const currentMemoryIndex = memoryIndex >= 0 ? memoryIndex : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-txt-clear">Lines</h3>
            <p className="mt-0.5 text-xs text-txt-dimmer">
              How many best lines the engine reports.
            </p>
          </div>
          <span className="ml-4 shrink-0 text-xs font-medium text-txt-dim">
            {multiPV}
          </span>
        </div>
        <Slider
          aria-label="Engine lines"
          maxValue={5}
          minValue={1}
          step={1}
          value={multiPV}
          onChange={(v: number | number[]) => setEngineOptions({ multiPV: one(v) })}
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      {isMultiThreaded && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-txt-clear">Threads</h3>
              <p className="mt-0.5 text-xs text-txt-dimmer">
                CPU cores the engine may use.
              </p>
            </div>
            <span className="ml-4 shrink-0 text-xs font-medium text-txt-dim">
              {threads} of {maxThreads}
            </span>
          </div>
          <Slider
            aria-label="Engine threads"
            maxValue={maxThreads}
            minValue={1}
            step={1}
            value={Math.min(threads, maxThreads)}
            onChange={(v: number | number[]) => setEngineOptions({ threads: one(v) })}
          >
            <Slider.Track>
              <Slider.Fill />
              <Slider.Thumb />
            </Slider.Track>
          </Slider>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-txt-clear">Memory</h3>
            <p className="mt-0.5 text-xs text-txt-dimmer">
              Hash table size for the search.
            </p>
          </div>
          <span className="ml-4 shrink-0 text-xs font-medium text-txt-dim">
            {hash} MB
          </span>
        </div>
        <Slider
          aria-label="Engine memory"
          maxValue={MEMORY_OPTIONS.length - 1}
          minValue={0}
          step={1}
          value={currentMemoryIndex}
          onChange={(v: number | number[]) => {
            const mb = MEMORY_OPTIONS[one(v)];

            if (mb !== undefined) setEngineOptions({ hash: mb });
          }}
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-txt-clear">Search time</h3>
            <p className="mt-0.5 text-xs text-txt-dimmer">
              Seconds spent per position before the engine rests.
            </p>
          </div>
          <span className="ml-4 shrink-0 text-xs font-medium text-txt-dim">
            {currentSearchTime === null ? UNLIMITED_LABEL : `${currentSearchTime} s`}
          </span>
        </div>
        <Slider
          aria-label="Engine search time"
          maxValue={SEARCH_TIME_OPTIONS.length - 1}
          minValue={0}
          step={1}
          value={currentSearchTimeIndex}
          onChange={(v: number | number[]) => {
            const opt = SEARCH_TIME_OPTIONS[one(v)];

            if (opt) setEngineOptions({ searchTime: opt.value });
          }}
        >
          <Slider.Track>
            <Slider.Fill />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>
      </div>

      <ToggleSetting
        description="Draw the engine's best move on the board while analysis runs."
        label="Engine arrows"
        value={showArrows}
        onChange={setShowArrows}
      />
    </div>
  );
}
