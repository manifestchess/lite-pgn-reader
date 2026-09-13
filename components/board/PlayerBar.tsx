/**
 * Name, rating, title, clock and result for one player. Which player is
 * decided by board orientation, not by colour: the bottom bar is always the
 * side being viewed from.
 */

import { useMemo } from "react";

import {
  useDocumentStore,
  type WireGame,
  type WireNode,
} from "../../store/document-store";

/**
 * Which of the two bars this is. Named rather than spelled at the call
 * site: the value decides which player is read, and a typo in it would
 * silently show the wrong one.
 */
export const PLAYER_BAR_POSITION = {
  TOP: "top",
  BOTTOM: "bottom",
} as const;
export type PlayerBarPosition =
  (typeof PLAYER_BAR_POSITION)[keyof typeof PLAYER_BAR_POSITION];

interface PlayerBarProps {
  position: PlayerBarPosition;
}

function tagMap(game: WireGame | null): Map<string, string> {
  const m = new Map<string, string>();

  if (!game) return m;
  // First occurrence wins for duplicate tags (lenient display).
  for (const [k, v] of game.tags) if (!m.has(k)) m.set(k, v);

  return m;
}

/** Parse a TimeControl header ("300+3", "180", "600+0") to initial seconds. */
function parseTimeControl(tc: string): number | null {
  const match = tc.match(/^(\d+)/);

  if (!match) return null;
  const secs = parseInt(match[1]!, 10);

  return isNaN(secs) || secs === 0 ? null : secs;
}

/** Format total seconds to a clock string like "5:00" or "1:30:00". */
function formatSeconds(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The player's half of a decisive Result tag, or null when not stated. */
function resultHalf(result: string | undefined, color: "white" | "black"): string | null {
  switch (result) {
    case "1-0":
      return color === "white" ? "1" : "0";
    case "0-1":
      return color === "white" ? "0" : "1";
    case "1/2-1/2":
      return "½";
    default:
      return null;
  }
}

export function PlayerBar({ position }: PlayerBarProps): React.ReactElement | null {
  const game = useDocumentStore((s) => s.game);
  const currentId = useDocumentStore((s) => s.currentId);
  const orientation = useDocumentStore((s) => s.orientation);

  const headers = useMemo(() => tagMap(game), [game]);

  const player = useMemo(() => {
    if (!game) return null;

    // Bottom is the side being viewed from, top is its opponent.
    const color =
      position === PLAYER_BAR_POSITION.BOTTOM
        ? orientation
        : orientation === "white"
          ? "black"
          : "white";

    const isWhite = color === "white";
    const name = headers.get(isWhite ? "White" : "Black");
    const elo = headers.get(isWhite ? "WhiteElo" : "BlackElo");
    const title = headers.get(isWhite ? "WhiteTitle" : "BlackTitle");

    if (!name || name === "?") return null;

    return {
      color,
      name,
      elo: elo && elo !== "?" && elo !== "0" ? elo : null,
      title: title && title !== "-" && title !== "?" ? title : null,
      result: resultHalf(headers.get("Result"), color),
    };
  }, [game, headers, orientation, position]);

  // Seconds. The clock lives on the move that consumed it, so this walks
  // the current line for this player's most recent [%clk].
  const clockSeconds = useMemo(() => {
    if (!player || !game) return null;

    let last: number | null = null;
    let children: WireNode[] = game.children;

    for (let i = 0; i < currentId.length; i += 2) {
      const idx =
        parseInt(currentId[i]!, 36) * 36 + parseInt(currentId[i + 1]!, 36);
      const child = children[idx];

      if (!child) break;

      const isPlayerMove =
        player.color === "white" ? child.ply % 2 === 1 : child.ply % 2 === 0;

      if (isPlayerMove) {
        for (const c of child.comments) {
          if (c.clockSeconds !== undefined) last = c.clockSeconds;
        }
      }

      children = child.children;
    }

    // Before this player's first move there is no clock to read, so show
    // the starting time instead of nothing.
    if (last === null) {
      const tc = headers.get("TimeControl");

      if (tc && tc !== "-" && tc !== "?") {
        last = parseTimeControl(tc);
      }
    }

    return last;
  }, [player, game, currentId, headers]);

  if (!player) return null;

  return (
    <div className="flex min-h-[20px] items-center gap-1.5 px-0.5 py-0.5 text-[12px] leading-tight">
      <span className="inline-flex min-w-0 items-baseline gap-1.5 truncate">
        {player.title && (
          <span className="shrink-0 font-bold text-primary-ink">
            {player.title}
          </span>
        )}
        <span
          className="truncate text-txt"
          data-testid={`player-name-${player.color}`}
        >
          {player.name}
          {player.elo && (
            <span className="ml-0.5 text-txt-dimmer">({player.elo})</span>
          )}
        </span>
      </span>
      {player.result !== null && (
        <span
          aria-label={`Result for ${player.color}: ${player.result}`}
          className="ml-1 shrink-0 rounded bg-low px-1 text-[11px] font-semibold tabular-nums text-txt-dim"
        >
          {player.result}
        </span>
      )}
      {clockSeconds !== null && (
        <span className="ml-auto shrink-0 rounded bg-default px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-txt">
          {formatSeconds(clockSeconds)}
        </span>
      )}
    </div>
  );
}
