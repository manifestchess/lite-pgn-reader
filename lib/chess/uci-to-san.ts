/**
 * The single UCI-to-SAN conversion in the application. The main process
 * deliberately keeps principal variations in UCI and carries no chess logic,
 * so this is where they become readable. Import it, never re-copy it.
 */
import { Chess, parseUci, makeSquare } from "chessops";
import { makeSan, makeSanAndPlay } from "chessops/san";
import { parseFen } from "chessops/fen";

/**
 * Converts a UCI principal variation to SAN, starting from `fen`. Stops at the
 * first unparseable token and returns what it has: half a variation beats none.
 * Legality is not checked, deliberately, since engines do not emit illegal
 * lines and re-validating every line on every info flush is not free.
 */
export function uciToSan(fen: string, uciMoves: string[]): string[] {
  const san: string[] = [];
  const setup = parseFen(fen);

  if (!setup.isOk) return san;

  const pos = Chess.fromSetup(setup.value);

  if (!pos.isOk) return san;

  const chess = pos.value;

  for (const uci of uciMoves) {
    const move = parseUci(uci);

    if (!move) break;
    try {
      san.push(makeSanAndPlay(chess, move));
    } catch {
      break;
    }
  }

  return san;
}

/** The first move of a variation as [from, to] square keys, for board arrows. */
export function pvFirstMove(pv: string[]): [string, string] | undefined {
  const first = pv[0];

  if (first === undefined) return undefined;

  const move = parseUci(first);

  if (!move) return undefined;

  // Both NormalMove and DropMove carry `to`; only NormalMove has `from`.
  if ("from" in move && move.from !== undefined) {
    return [makeSquare(move.from), makeSquare(move.to)];
  }

  return undefined;
}

/**
 * Names a single UCI move in SAN without playing it, so `fen` is unchanged.
 * Returns null rather than throwing for anything the position cannot make
 * sense of.
 */
export function uciToSanSingle(fen: string, uci: string): string | null {
  const setup = parseFen(fen);

  if (!setup.isOk) return null;

  const pos = Chess.fromSetup(setup.value);

  if (!pos.isOk) return null;

  const move = parseUci(uci);

  if (!move) return null;

  try {
    return makeSan(pos.value, move);
  } catch {
    return null;
  }
}
