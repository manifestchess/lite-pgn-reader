/**
 * Virtualized game list: absolute-positioned window over up to 120k rows.
 * Hand-rolled (no new dependencies); the DOM holds viewport+overscan rows
 * only, never the full list.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { GameListMenu, type ListMenuState } from "./GameListMenu";
import { NewGameFromFenModal } from "./NewGameFromFenModal";

import { useDocumentStore } from "../../store/document-store";
import { GFLAG } from "../../electron/wire";

const ROW_H = 28;
const OVERSCAN = 12;

export function GameList(): React.ReactElement {
  const summary = useDocumentStore((s) => s.summary);
  const rows = useDocumentStore((s) => s.rows);
  const rowsVersion = useDocumentStore((s) => s.rowsVersion); // stable Map identity; version drives renders AND refetch
  const ensureRows = useDocumentStore((s) => s.ensureRows);
  const ensureRowsAt = useDocumentStore((s) => s.ensureRowsAt);
  const openGame = useDocumentStore((s) => s.openGame);
  const gameIndex = useDocumentStore((s) => s.gameIndex);
  const filtered = useDocumentStore((s) => s.filtered);
  const showGameNumber = useDocumentStore((s) => s.showGameNumber);
  const sortColumn = useDocumentStore((s) => s.sortColumn);
  const sortDir = useDocumentStore((s) => s.sortDir);
  const setSort = useDocumentStore((s) => s.setSort);
  const showEvent = useDocumentStore((s) => s.showEvent);
  const showDate = useDocumentStore((s) => s.showDate);
  const showResult = useDocumentStore((s) => s.showResult);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 60]);
  const [menu, setMenu] = useState<ListMenuState | null>(null);
  const [fenModal, setFenModal] = useState(false);

  // The list virtualizes over the filtered view when a filter is active;
  // slot i then maps to real game index filtered[i].
  const total = filtered !== null ? filtered.length : (summary?.gameCount ?? 0);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN);
    const count = Math.ceil(el.clientHeight / ROW_H) + OVERSCAN * 2;
    setRange([start, Math.min(total, start + count)]);
  }, [total]);

  useEffect(() => {
    onScroll();
  }, [onScroll, total]);

  useEffect(() => {
    const [start, end] = range;
    if (end <= start) return;
    if (filtered !== null) void ensureRowsAt(filtered.slice(start, end));
    else void ensureRows(start, end - start);
    // rowsVersion is a dep ON PURPOSE: refreshGame drops an edited game's
    // cached row, and without re-running this ensure pass the row renders
    // as the "…" loading placeholder until the next scroll.
  }, [range, ensureRows, ensureRowsAt, filtered, rowsVersion]);

  // A shrinking filter can strand the scroll window past the end.
  useEffect(() => {
    onScroll();
  }, [filtered, onScroll]);

  // Keyboard game-stepping: keep the selected row in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const slot = filtered !== null ? filtered.indexOf(gameIndex) : gameIndex;
    if (slot < 0) return;
    const top = slot * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight)
      el.scrollTop = top + ROW_H - el.clientHeight;
  }, [gameIndex, filtered]);

  const [start, end] = range;
  const visible: React.ReactElement[] = [];
  for (let slot = start; slot < Math.min(end, total); slot++) {
    const i = filtered !== null ? filtered[slot]! : slot;
    const r = rows.get(i);
    const selected = i === gameIndex;
    visible.push(
      <div
        key={i}
        role="row"
        aria-selected={selected}
        data-index={i}
        className={`absolute left-0 right-0 flex cursor-default items-center gap-2 truncate px-3 text-sm ${
          selected ? "bg-[color-mix(in_srgb,var(--color-primary)_22%,transparent)]" : i % 2 ? "bg-zebra2" : ""
        }`}
        style={{ top: slot * ROW_H, height: ROW_H }}
        onClick={() => void openGame(i)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, gameIndex: i });
        }}
      >
        {r ? (
          <>
            {showGameNumber && (
              <span className="w-10 shrink-0 text-right tabular-nums text-txt-dimmer">{i + 1}</span>
            )}
            <span className="truncate">
              {(() => {
                // "?" (what many exporters, including chessops, write for an
                // unknown player) counts as no name. Show "White – Black" ONLY
                // when BOTH sides are real names; otherwise this is a study
                // chapter or repertoire line, so show its title instead of a
                // lone "?" (which is never useful to the reader).
                const w = r.white && r.white !== "?" ? r.white : null;
                const b = r.black && r.black !== "?" ? r.black : null;
                // "?" is unknown here too — a new game (NEW_GAME_TEXT) and many
                // exporters write [Event "?"], which must not surface as a
                // lone "?" nor mask a real player name.
                const ev = r.event && r.event !== "?" ? r.event : null;
                if (!w || !b) return ev || w || b || "—";
                return (
                  <>
                    {w}
                    {r.whiteElo && (
                      <span className="text-txt-dimmer">{` (${r.whiteElo})`}</span>
                    )}
                    {` – ${b}`}
                    {r.blackElo && (
                      <span className="text-txt-dimmer">{` (${r.blackElo})`}</span>
                    )}
                    {showEvent && r.event && (
                      <span className="text-txt-dimmer">{` · ${r.event}`}</span>
                    )}
                  </>
                );
              })()}
            </span>
            {r.flags !== 0 && (
              <span title={flagTitle(r.flags)} className="shrink-0 text-warning">
                ⚠︎
              </span>
            )}
            {showDate && r.date && (
              <span className="ml-auto shrink-0 tabular-nums text-[11px] text-txt-dimmer">
                {r.date.slice(0, 4)}
              </span>
            )}
            {showResult && (
              <span
                className={`${showDate && r.date ? "" : "ml-auto "}shrink-0 tabular-nums text-txt-dim`}
              >
                {r.result}
              </span>
            )}
          </>
        ) : (
          <span className="text-txt-dimmer">…</span>
        )}
      </div>,
    );
  }

  const header = (
    label: string,
    column: "white" | "black" | "event" | "date" | "result",
    extra = "",
  ): React.ReactElement => (
    <button
      key={column}
      className={`cursor-pointer border-none bg-transparent px-0 text-left text-[11px] font-semibold transition-colors ${
        sortColumn === column ? "text-txt-clear" : "text-txt-dimmer hover:text-txt-clear"
      } ${extra}`}
      data-testid={`sort-${column}`}
      onClick={() => setSort(column)}
    >
      {label}
      {sortColumn === column ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-box px-3 py-1">
        {showGameNumber && (
          <button
            className={`w-10 cursor-pointer border-none bg-transparent px-0 text-right text-[11px] font-semibold ${
              sortColumn === null ? "text-txt-clear" : "text-txt-dimmer hover:text-txt-clear"
            }`}
            data-testid="sort-file-order"
            title="File order"
            onClick={() => setSort(null)}
          >
            #
          </button>
        )}
        {header("Players", "white", "flex-1 truncate")}
        {showEvent && header("Event", "event", "shrink-0")}
        {showDate && header("Date", "date", "shrink-0")}
        {showResult && header("Result", "result", "ml-auto shrink-0")}
      </div>
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Games"
      aria-rowcount={total}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={onScroll}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('[role="row"]')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, gameIndex: null });
      }}
    >
      <div className="relative" style={{ height: total * ROW_H }}>
        {visible}
        {filtered !== null && filtered.length === 0 && (
          <div className="px-3 py-2 text-xs text-txt-dimmer">No games match.</div>
        )}
      </div>
    </div>
    {menu && (
      <GameListMenu
        state={menu}
        onClose={() => setMenu(null)}
        onNewFromPosition={() => setFenModal(true)}
      />
    )}
    <NewGameFromFenModal open={fenModal} onClose={() => setFenModal(false)} />
    </div>
  );
}

function flagTitle(flags: number): string {
  const parts: string[] = [];
  if (flags & GFLAG.MISSING_TERMINATOR) parts.push("no termination marker");
  if (flags & GFLAG.UNTERMINATED_COMMENT) parts.push("unterminated comment");
  if (flags & GFLAG.UNCLOSED_RAV) parts.push("unclosed variation");
  if (flags & GFLAG.NONSTANDARD_RESULT) parts.push("nonstandard result spelling");
  if (flags & GFLAG.CONTENT_AFTER_TERMINATOR) parts.push("content after the result");
  if (flags & GFLAG.MALFORMED_TAGS) parts.push("malformed tag line");
  if (flags & GFLAG.ORPHAN_RAV_CLOSE) parts.push("stray close paren");
  if (flags & GFLAG.RESYNCED) parts.push("recovered game boundary");
  return parts.join("; ");
}
