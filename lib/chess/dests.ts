/**
 * Legal-move destinations computed renderer-side from the node's FEN.
 *
 * Sending dests in every WireNode would make the wire tree several times
 * larger than the moves themselves and tax the launch path's one bootstrap
 * IPC. chessops is already in the renderer bundle (uci-to-san), so ~1ms of
 * local compute replaces all of it. Memoized on the last FEN — navigation
 * only ever needs one.
 */

import { Chess } from "chessops/chess";
import { parseFen } from "chessops/fen";
import { chessgroundDests } from "chessops/compat";

let lastFen: string | null = null;
let lastDests: Record<string, string[]> = {};

export function destsFromFen(fen: string): Record<string, string[]> {
  if (fen === lastFen) return lastDests;
  let out: Record<string, string[]> = {};
  try {
    const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
    const map = chessgroundDests(pos);
    for (const [k, v] of map) out[k] = v as string[];
  } catch {
    out = {}; // unplayable position: no move input, navigation still works
  }
  lastFen = fen;
  lastDests = out;
  return out;
}
