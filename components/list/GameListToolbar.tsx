/**
 * Game-list toolbar: debounced search over players/event, a filter-panel
 * toggle with an active-filters dot, and a columns menu holding the
 * game-number toggle (hidden by default — it eats row width).
 */

import { useEffect, useRef, useState } from "react";

import {
  filtersActive,
  useDocumentStore,
} from "../../store/document-store";

const ICON_BTN =
  "shrink-0 w-7 h-7 rounded flex items-center justify-center cursor-pointer border-none transition-colors";
const ICON_BTN_OFF = "bg-transparent text-txt-dimmer hover:text-txt-clear hover:bg-low";

function SearchIcon(): React.ReactElement {
  return (
    <svg fill="none" height="13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="13">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function XIcon(): React.ReactElement {
  return (
    <svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function FilterIcon(): React.ReactElement {
  return (
    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function ColumnsIcon(): React.ReactElement {
  return (
    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M9 3v18M15 3v18" />
    </svg>
  );
}

export function GameListToolbar(): React.ReactElement {
  const searchQuery = useDocumentStore((s) => s.searchQuery);
  const setSearchQuery = useDocumentStore((s) => s.setSearchQuery);
  const filters = useDocumentStore((s) => s.filters);
  const showFilters = useDocumentStore((s) => s.showFilters);
  const setShowFilters = useDocumentStore((s) => s.setShowFilters);
  const showGameNumber = useDocumentStore((s) => s.showGameNumber);
  const setShowGameNumber = useDocumentStore((s) => s.setShowGameNumber);
  const newGame = useDocumentStore((s) => s.newGame);
  const readOnlyDoc = useDocumentStore((s) => s.summary?.readOnlyDocument ?? false);
  const showEvent = useDocumentStore((s) => s.showEvent);
  const showDate = useDocumentStore((s) => s.showDate);
  const showResult = useDocumentStore((s) => s.showResult);
  const setColumn = useDocumentStore((s) => s.setColumn);

  // Local state is authoritative while typing: adopt the store value only
  // when it changed externally (Reset), commit on a 350ms trailing
  // debounce, clear immediately.
  const [text, setText] = useState(searchQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitted = useRef(searchQuery);
  useEffect(() => {
    if (searchQuery !== lastCommitted.current) {
      // External change (Reset) also cancels any in-flight commit — a
      // pending 350ms timer would silently reinstate the cleared query.
      if (timer.current) clearTimeout(timer.current);
      lastCommitted.current = searchQuery;
      setText(searchQuery);
    }
  }, [searchQuery]);
  const commit = (value: string): void => {
    lastCommitted.current = value;
    setSearchQuery(value);
  };
  const onChange = (value: string): void => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(value), 350);
  };
  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    setText("");
    commit("");
  };

  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!columnsOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!columnsRef.current?.contains(e.target as Node)) setColumnsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [columnsOpen]);

  const active = filtersActive(filters, searchQuery);

  return (
    <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-transp">
      <div className="flex-1 min-w-0 relative flex items-center">
        <span className="absolute left-2 text-txt-dimmer pointer-events-none">
          <SearchIcon />
        </span>
        <input
          aria-label="Search games"
          className="input w-full h-7 pl-7 pr-7 text-xs rounded-md bg-page border border-transp text-txt-clear placeholder:text-txt-dimmer/50 outline-none focus:border-primary/50"
          data-testid="game-list-search"
          placeholder="Search players…"
          spellCheck={false}
          type="text"
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
        {text !== "" && (
          <button
            aria-label="Clear search"
            className="absolute right-2 text-txt-dimmer hover:text-txt-clear cursor-pointer border-none bg-transparent p-0"
            tabIndex={-1}
            onClick={clear}
          >
            <XIcon />
          </button>
        )}
      </div>
      <button
        aria-label="Toggle filters"
        aria-pressed={showFilters}
        className={`${ICON_BTN} relative ${showFilters ? "chip-active" : ICON_BTN_OFF}`}
        data-testid="game-list-filter-toggle"
        onClick={() => setShowFilters(!showFilters)}
      >
        <FilterIcon />
        {active && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary" />}
      </button>
      {!readOnlyDoc && (
        <button
          aria-label="New game"
          className={`${ICON_BTN} ${ICON_BTN_OFF}`}
          data-testid="game-list-new"
          title="New game (Cmd+N)"
          onClick={() => void newGame()}
        >
          <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      <div ref={columnsRef} className="relative">
        <button
          aria-label="List columns"
          aria-pressed={columnsOpen}
          className={`${ICON_BTN} ${columnsOpen ? "chip-active" : ICON_BTN_OFF}`}
          data-testid="game-list-columns"
          onClick={() => setColumnsOpen(!columnsOpen)}
        >
          <ColumnsIcon />
        </button>
        {columnsOpen && (
          <div className="absolute right-0 top-8 z-20 min-w-40 rounded-md border border-line bg-box p-1 shadow-lg">
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-txt-clear hover:bg-low">
              <input
                checked={showGameNumber}
                data-testid="toggle-game-number"
                type="checkbox"
                onChange={(e) => setShowGameNumber(e.target.checked)}
              />
              Game number (#)
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-txt-clear hover:bg-low">
              <input
                checked={showEvent}
                data-testid="toggle-event"
                type="checkbox"
                onChange={(e) => setColumn("showEvent", e.target.checked)}
              />
              Event
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-txt-clear hover:bg-low">
              <input
                checked={showDate}
                data-testid="toggle-date"
                type="checkbox"
                onChange={(e) => setColumn("showDate", e.target.checked)}
              />
              Date
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs text-txt-clear hover:bg-low">
              <input
                checked={showResult}
                data-testid="toggle-result"
                type="checkbox"
                onChange={(e) => setColumn("showResult", e.target.checked)}
              />
              Result
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
