/**
 * The single UCI parser and command builder for the whole application:
 * pure text-to-data and deliberately free of chess logic — it converts
 * protocol text to structured data and nothing else. PVs stay in UCI, and
 * the renderer turns them into SAN via lib/chess/uci-to-san.ts, so there is
 * one SAN implementation too.
 *
 * Two behaviours worth noting:
 *   - `info` lines carrying `lowerbound`/`upperbound` are skipped. They are
 *     fail-high/low probes whose score is a bound, not an evaluation;
 *     rendering them makes the eval bar jump during re-searches.
 *   - Index accesses are guarded for noUncheckedIndexedAccess.
 */
import {
  UCI_OPTION_TYPE,
  type EngineInfo,
  type UciOption,
  type UciOptionType,
  type GoParams,
} from "../../types/engine";
import { GO_MODE } from "../../types/engine";

/** Side to move, as it appears in field 2 of a FEN. */
export type SideToMove = "w" | "b";

/** A UCI move: from-square, to-square, optional promotion piece. */
const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/;

// ── Commands ──────────────────────────────────────────────────────────

/**
 * Commands sent to an engine. Builders rather than bare constants because
 * most carry arguments, and a builder cannot be mistyped at a call site.
 */
export const UCI_CMD = {
  /** Begin the handshake. The engine answers with `id`, `option`, `uciok`. */
  UCI: "uci",
  /** Ask whether the engine has finished digesting what it was sent. */
  IS_READY: "isready",
  /** Clear hash and any other inter-search state. */
  NEW_GAME: "ucinewgame",
  /** Halt the current search. The engine still emits `bestmove`. */
  STOP: "stop",
  /** Ask the engine to exit. */
  QUIT: "quit",

  setOption(name: string, value: string | number | boolean): string {
    return `setoption name ${name} value ${String(value)}`;
  },

  /** Press a `button`-type option, which takes no value. */
  pressButton(name: string): string {
    return `setoption name ${name}`;
  },

  position(fen: string): string {
    return `position fen ${fen}`;
  },

  go(params: GoParams): string {
    switch (params.mode) {
      case GO_MODE.DEPTH:
        return `go depth ${params.value}`;
      case GO_MODE.MOVETIME:
        return `go movetime ${params.value}`;
      case GO_MODE.NODES:
        return `go nodes ${params.value}`;
      case GO_MODE.INFINITE:
      default:
        return "go infinite";
    }
  },
} as const;

// ── Parsing ───────────────────────────────────────────────────────────

/** `id name Stockfish 18` → `Stockfish 18`. */
export function parseIdName(line: string): string | null {
  const m = /^id\s+name\s+(.+)$/.exec(line.trim());
  const name = m?.[1];

  return name ? name.trim() : null;
}

/** `bestmove e2e4 ponder e7e5` → `e2e4`. Handles `bestmove (none)`. */
export function parseBestMove(line: string): string | null {
  const m = /^bestmove\s+(\S+)/.exec(line.trim());
  const move = m?.[1];

  if (!move) return null;

  return move === "(none)" || move === "0000" ? null : move;
}

const OPTION_TYPES = new Set<string>(Object.values(UCI_OPTION_TYPE));

/**
 * Parse one `option name ... type ...` line. Keywords are located
 * positionally rather than by splitting on whitespace, because option names
 * and combo/string values may themselves contain spaces:
 * `option name Skill Level type spin default 20 min 0 max 20` and
 * `option name Analysis Contempt type combo default Both var Off var White`
 * both have to work.
 */
export function parseOptionLine(line: string): UciOption | null {
  const trimmed = line.trim();

  if (!trimmed.startsWith("option ")) return null;

  const tokens = trimmed.split(/\s+/);
  // Keyword positions, in order, so each field can take the span up to the next.
  const KEYWORDS = new Set(["name", "type", "default", "min", "max", "var"]);
  const marks: { key: string; at: number }[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (token !== undefined && KEYWORDS.has(token)) {
      marks.push({ key: token, at: i });
    }
  }

  const spanAfter = (idx: number): string => {
    const mark = marks[idx];

    if (!mark) return "";
    const start = mark.at + 1;
    const next = marks[idx + 1];
    const end = next ? next.at : tokens.length;

    return tokens.slice(start, end).join(" ");
  };

  let name: string | undefined;
  let type: UciOptionType | undefined;
  let dflt: string | undefined;
  let min: number | undefined;
  let max: number | undefined;
  const vars: string[] = [];

  for (let i = 0; i < marks.length; i++) {
    const value = spanAfter(i);

    switch (marks[i]?.key) {
      case "name":
        name = value;
        break;
      case "type":
        if (OPTION_TYPES.has(value)) type = value as UciOptionType;
        break;
      case "default":
        dflt = value;
        break;
      case "min":
        min = Number(value);
        break;
      case "max":
        max = Number(value);
        break;
      case "var":
        vars.push(value);
        break;
    }
  }

  if (!name || !type) return null;

  const option: UciOption = { name, type };

  if (dflt !== undefined && type !== UCI_OPTION_TYPE.BUTTON) {
    if (type === UCI_OPTION_TYPE.CHECK) option.default = dflt === "true";
    else if (type === UCI_OPTION_TYPE.SPIN) option.default = Number(dflt);
    else option.default = dflt;
  }
  if (min !== undefined && Number.isFinite(min)) option.min = min;
  if (max !== undefined && Number.isFinite(max)) option.max = max;
  if (vars.length) option.vars = vars;

  return option;
}

/**
 * Parse one `info` line into an EngineInfo, or null when the line carries no
 * principal variation (`currmove` progress reports, the bare `info depth N`
 * some engines emit on startup) or only a bound rather than a score.
 *
 * Scores arrive from the side-to-move's perspective and are flipped here so
 * everything downstream is white-positive, which is what the eval bar and
 * the engine lines both assume.
 */
export function parseInfoLine(
  line: string,
  sideToMove: SideToMove,
): EngineInfo | null {
  const trimmed = line.trim();

  if (!trimmed.startsWith("info") || !/\spv\s/.test(trimmed)) return null;

  const parts = trimmed.split(/\s+/);
  const info: EngineInfo = { depth: 0, multipv: 1, pv: [] };
  let sawScore = false;

  let i = 0;

  while (i < parts.length) {
    const key = parts[i];

    switch (key) {
      case "depth":
        info.depth = Number(parts[++i]);
        i++;
        break;
      case "seldepth":
        info.selDepth = Number(parts[++i]);
        i++;
        break;
      case "multipv":
        info.multipv = Number(parts[++i]);
        i++;
        break;
      case "nodes":
        info.nodes = Number(parts[++i]);
        i++;
        break;
      case "nps":
        info.nps = Number(parts[++i]);
        i++;
        break;
      case "time":
        info.timeMs = Number(parts[++i]);
        i++;
        break;
      case "hashfull":
        info.hashfull = Number(parts[++i]);
        i++;
        break;
      case "tbhits":
        info.tbhits = Number(parts[++i]);
        i++;
        break;
      case "lowerbound":
      case "upperbound":
        // A fail-high/low probe: the score is a bound, not an evaluation.
        // Showing it makes the eval jump during re-searches, so skip the
        // whole line and wait for the exact score that follows.
        return null;
      case "score": {
        const kind = parts[i + 1];

        if (kind === "cp") {
          info.cp = Number(parts[i + 2]);
          sawScore = true;
          i += 3;
        } else if (kind === "mate") {
          info.mate = Number(parts[i + 2]);
          sawScore = true;
          i += 3;
        } else {
          i++;
        }
        break;
      }
      case "pv":
        i++;
        // The PV runs to the end of the line by definition.
        while (i < parts.length) {
          const move = parts[i];

          if (move !== undefined && UCI_MOVE.test(move)) info.pv.push(move);
          i++;
        }
        break;
      default:
        i++;
    }
  }

  if (!info.depth || info.pv.length === 0 || !sawScore) return null;

  if (sideToMove === "b") {
    if (info.cp !== undefined) info.cp = -info.cp;
    if (info.mate !== undefined) info.mate = -info.mate;
  }

  return info;
}

/** Field 2 of a FEN, defaulting to white when the FEN is malformed. */
export function sideToMoveFromFen(fen: string): SideToMove {
  return fen.split(/\s+/)[1] === "b" ? "b" : "w";
}

/**
 * Split engine output into complete lines, returning the trailing partial
 * one so the caller can prepend it to the next chunk. The worker can deliver
 * chunks that ignore line boundaries, so a naive split corrupts whatever
 * straddles one; routing all output through here keeps line handling in one
 * place.
 */
export function splitLines(
  chunk: string,
  carry: string,
): { lines: string[]; carry: string } {
  const combined = carry + chunk;
  const parts = combined.split("\n");
  const rest = parts.pop() ?? "";
  const lines: string[] = [];

  for (const part of parts) {
    const line = part.endsWith("\r") ? part.slice(0, -1) : part;

    if (line.trim()) lines.push(line);
  }

  return { lines, carry: rest };
}
