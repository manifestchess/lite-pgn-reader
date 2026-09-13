/**
 * Analysis panel header + engine lines. The catalog name renders as a plain
 * label, with the full self-reported name in its tooltip. The toggle is the
 * single switch that turns live analysis on.
 */

import type {
  EngineLine,
  EngineOptions,
  SearchStats,
} from "../../lib/engine/client";

import { Switch } from "@heroui/react";

import {
  SETTINGS_SECTION,
  useSettingsModalStore,
} from "../../store/settings-modal-store";

import { EngineLines } from "./EngineLines";

import { formatCount } from "../../lib/format/count";

interface AnalysisPanelProps {
  lines: EngineLine[];
  depth: number;
  isAnalyzing: boolean;
  analysisEnabled: boolean;
  onToggleAnalysis: (enabled: boolean) => void;
  options: EngineOptions;
  boardOrientation: "white" | "black";
  currentFen: string;
  error: string | null;
  /** Search-wide counters. Rendered quietly for users who want them. */
  stats: SearchStats;
  /** Threads the engine is actually using, for the hover detail. */
  threads: number;
  /** Catalog display name; the engine's own name goes in the tooltip. */
  engineLabel: string;
  engineName: string | null;
  onRetry?: () => void;
  onLineClick?: (pvSan: string[]) => void;
}

export function AnalysisPanel({
  lines,
  depth,
  isAnalyzing,
  analysisEnabled,
  onToggleAnalysis,
  options,
  boardOrientation,
  currentFen,
  error,
  stats,
  threads,
  engineLabel,
  engineName,
  onRetry,
  onLineClick,
}: AnalysisPanelProps) {
  const threadWord = threads === 1 ? "thread" : "threads";
  const engineDetail =
    stats.hashfull > 0
      ? `${formatCount(stats.nodes)} nodes, ${threads} ${threadWord}, hash ${(stats.hashfull / 10).toFixed(0)}% full`
      : `${formatCount(stats.nodes)} nodes, ${threads} ${threadWord}`;

  return (
    <div
      className={`${analysisEnabled || error ? "border-b border-line" : ""}`}
      data-testid="analysis-panel"
    >
      <div
        className={`drag-region flex h-10 items-center justify-between px-2.5 border-b border-line ${analysisEnabled ? "bg-primary/8" : ""}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-[13px] font-semibold whitespace-nowrap ${analysisEnabled ? "text-primary-ink" : "text-txt-dim"}`}
            title={engineName ?? undefined}
          >
            {engineLabel}
          </span>
          <button
            aria-label="Engine settings"
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent text-txt-dimmer transition-colors hover:bg-low hover:text-txt-clear"
            data-testid="engine-settings-cog"
            title="Engine settings"
            onClick={() => useSettingsModalStore.getState().open(SETTINGS_SECTION.ENGINE)}
          >
            <svg aria-hidden="true" fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="13">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          {analysisEnabled && isAnalyzing && (
            <span
              className="text-[11px] text-txt-dimmer tabular-nums"
              data-testid="analysis-depth"
              title={engineDetail}
            >
              {`Depth ${depth}`}
              {stats.nps > 0 && (
                <span className="text-txt-dimmer">
                  {" · "}
                  {`${formatCount(stats.nps)} n/s`}
                </span>
              )}
            </span>
          )}
        </div>
        <Switch
          aria-label="Toggle engine analysis"
          data-testid="analysis-toggle"
          isSelected={analysisEnabled}
          size="sm"
          onChange={onToggleAnalysis}
        >
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch>
      </div>

      {error ? (
        <button
          className="w-full px-2 py-2 text-xs text-danger hover:bg-low transition-colors text-left cursor-pointer"
          data-testid="analysis-error"
          onClick={onRetry}
        >
          {error}
        </button>
      ) : analysisEnabled ? (
        <EngineLines
          boardOrientation={boardOrientation}
          currentFen={currentFen}
          depth={depth}
          isAnalyzing={isAnalyzing}
          lines={lines}
          multiPV={options.multiPV}
          onLineClick={onLineClick}
        />
      ) : null}
    </div>
  );
}
