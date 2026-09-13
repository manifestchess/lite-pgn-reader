import { Chess, parseUci } from "chessops";
import { makeFen, parseFen } from "chessops/fen";

/**
 * Compute the FEN after playing `count` UCI moves from a starting position.
 * Returns undefined if the FEN or any move is invalid.
 */
export function fenAfterUciMoves(
  startFen: string,
  uciMoves: string[],
  count: number,
): string | undefined {
  const setup = parseFen(startFen);

  if (!setup.isOk) return undefined;

  const pos = Chess.fromSetup(setup.value);

  if (!pos.isOk) return undefined;

  const chess = pos.value;

  for (let i = 0; i < count && i < uciMoves.length; i++) {
    const uci = uciMoves[i];
    const move = uci === undefined ? undefined : parseUci(uci);

    if (!move) return undefined;

    try {
      chess.play(move);
    } catch {
      return undefined;
    }
  }

  return makeFen(chess.toSetup());
}
