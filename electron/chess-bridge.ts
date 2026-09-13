/**
 * Small chessops bridge for main-process move handling. Castling arrives
 * from chessground as king-to-square uci; chessops' normalizeMove converts
 * to its king-captures-rook internal form before the legality check.
 */

import { Chess, normalizeMove } from "chessops/variant";
import { parseUci } from "chessops/util";
import type { Move, Position, Setup } from "chessops";

export function chessFromSetup(setup: Setup): Position {
  return Chess.fromSetup(setup).unwrap();
}

export function parseUciMove(pos: Position, uci: string): Move | null {
  const raw = parseUci(uci);
  if (!raw) return null;
  const move = normalizeMove(pos, raw);
  return pos.isLegal(move as Move) ? (move as Move) : null;
}
