/**
 * Promotion detection and picker constants. Works over square names rather
 * than chessops Square numbers: the renderer sees positions as FEN +
 * chessground state, and pulling chessops into the bundle for two rank
 * comparisons buys nothing.
 */

/**
 * Pieces a pawn may promote to, in the order the picker shows them: queen
 * first because it is chosen overwhelmingly most often, then descending by
 * value. Knight underpromotion decides real games, so it stays reachable.
 */
export const PROMOTION_ROLES = ["queen", "rook", "bishop", "knight"] as const;
export type PromotionRole = (typeof PROMOTION_ROLES)[number];

/**
 * SAN letter to piece, for keyboard selection. Spelled out rather than
 * derived from the role name: a knight is "N" in SAN but its name starts
 * with K, and K is the king, so deriving from the first letter binds knight
 * to the wrong key.
 */
export const PROMOTION_KEYS: Record<string, PromotionRole> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
};

/** UCI promotion suffix for a role ("q", "r", "b", "n"). */
export const PROMOTION_UCI: Record<PromotionRole, string> = {
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
};

/**
 * Would moving a piece of `role` from `orig` to `dest` promote?
 *
 * The mover's colour decides, not the back rank alone: only a white pawn
 * promotes on rank 8 and only a black pawn on rank 1. The origin is checked
 * too so a malformed call cannot report a phantom promotion for a pawn that
 * was already on the promotion rank.
 */
export function isPromotionMove(
  role: string | undefined,
  color: "white" | "black" | undefined,
  orig: string,
  dest: string,
): boolean {
  if (role !== "pawn" || !color) return false;

  const targetRank = color === "white" ? "8" : "1";

  return dest[1] === targetRank && orig[1] !== targetRank;
}
