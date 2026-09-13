/**
 * Expanded filter panel: Elo and year ranges, a color narrower for the
 * search box, result chips, and a reset link. Presence of the panel IS the
 * open state — no animation.
 */

import { useDocumentStore } from "../../store/document-store";

const RANGE_INPUT =
  "w-full h-6 px-1.5 text-[11px] bg-page border border-transp rounded text-txt-clear placeholder:text-txt-dimmer/50 outline-none focus:border-primary/50 tabular-nums";

const chip = (active: boolean): string =>
  `h-6 px-2 rounded text-[11px] font-medium cursor-pointer transition-colors ${
    active
      ? "chip-active border border-primary/40"
      : "bg-transparent text-txt-dim border border-transp hover:text-txt-clear hover:border-txt-dimmer/30"
  }`;

const RESULTS = ["1-0", "0-1", "1/2-1/2", "*"] as const;
const RESULT_LABEL: Record<string, string> = { "1/2-1/2": "½–½" };

function numOrNull(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function GameListFilterPanel(): React.ReactElement {
  const filters = useDocumentStore((s) => s.filters);
  const setFilters = useDocumentStore((s) => s.setFilters);
  const resetFilters = useDocumentStore((s) => s.resetFilters);
  const searchQuery = useDocumentStore((s) => s.searchQuery);
  const filtered = useDocumentStore((s) => s.filtered);

  const canReset =
    searchQuery !== "" ||
    filters.eloMin !== null ||
    filters.eloMax !== null ||
    filters.yearMin !== null ||
    filters.yearMax !== null ||
    filters.results.length > 0 ||
    filters.color !== "any";

  const toggleResult = (r: string): void => {
    const has = filters.results.includes(r);
    setFilters({ results: has ? filters.results.filter((x) => x !== r) : [...filters.results, r] });
  };

  return (
    <div className="shrink-0 px-3 py-2 border-b border-transp flex flex-col gap-2" data-testid="game-list-filters">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-txt-dimmer w-[34px] shrink-0">Elo</span>
        <input
          className={RANGE_INPUT}
          inputMode="numeric"
          placeholder="min"
          value={filters.eloMin ?? ""}
          onChange={(e) => setFilters({ eloMin: numOrNull(e.target.value) })}
        />
        <span className="text-txt-dimmer text-[10px]">–</span>
        <input
          className={RANGE_INPUT}
          inputMode="numeric"
          placeholder="max"
          value={filters.eloMax ?? ""}
          onChange={(e) => setFilters({ eloMax: numOrNull(e.target.value) })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-txt-dimmer w-[34px] shrink-0">Year</span>
        <input
          className={RANGE_INPUT}
          inputMode="numeric"
          placeholder="from"
          value={filters.yearMin ?? ""}
          onChange={(e) => setFilters({ yearMin: numOrNull(e.target.value) })}
        />
        <span className="text-txt-dimmer text-[10px]">–</span>
        <input
          className={RANGE_INPUT}
          inputMode="numeric"
          placeholder="to"
          value={filters.yearMax ?? ""}
          onChange={(e) => setFilters({ yearMax: numOrNull(e.target.value) })}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-txt-dimmer w-[34px] shrink-0">Color</span>
        {(["white", "black"] as const).map((c) => (
          <button
            key={c}
            className={chip(filters.color === c)}
            onClick={() => setFilters({ color: filters.color === c ? "any" : c })}
          >
            {c === "white" ? "White" : "Black"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-txt-dimmer w-[34px] shrink-0">Result</span>
        {RESULTS.map((r) => (
          <button key={r} className={chip(filters.results.includes(r))} onClick={() => toggleResult(r)}>
            {RESULT_LABEL[r] ?? r}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-txt-dimmer">
          {filtered !== null ? `${filtered.length.toLocaleString()} match${filtered.length === 1 ? "" : "es"}` : ""}
        </span>
        {canReset && (
          <button
            className="self-end text-[11px] text-txt-dimmer hover:text-primary-ink cursor-pointer border-none bg-transparent transition-colors"
            data-testid="game-list-filters-reset"
            onClick={resetFilters}
          >
            Reset filters
          </button>
        )}
      </div>
    </div>
  );
}
