/**
 * Canonical PGN Result tokens.
 * Never re-spell them at a call site: drift between callers ("½-½" vs
 * "1/2-1/2") silently breaks the cycle and the write path.
 */

export const GAME_RESULT = {
  WHITE_WIN: "1-0",
  BLACK_WIN: "0-1",
  DRAW: "1/2-1/2",
  ONGOING: "*",
} as const;

export type GameResult = (typeof GAME_RESULT)[keyof typeof GAME_RESULT];

/** Order used by the result-row click cycle. */
export const ALL_RESULTS: readonly GameResult[] = [
  GAME_RESULT.ONGOING,
  GAME_RESULT.WHITE_WIN,
  GAME_RESULT.BLACK_WIN,
  GAME_RESULT.DRAW,
] as const;

/**
 * Fold display variants of a result down to the canonical token, so a file
 * that spells its terminator "½-½" still cycles from DRAW rather than from
 * nowhere. Unknown spellings return themselves (and cycle from ONGOING).
 */
export function normalizeResult(s: string): string {
  const t = s.trim();
  if (t === "1-0" || t === "1–0") return GAME_RESULT.WHITE_WIN;
  if (t === "0-1" || t === "0–1") return GAME_RESULT.BLACK_WIN;
  if (t === "1/2-1/2" || t === "½-½" || t === "½–½" || t === "1/2") return GAME_RESULT.DRAW;
  return t;
}

/** The next result in the click cycle: * → 1-0 → 0-1 → ½-½ → *. */
export function nextResult(current: string | null | undefined): GameResult {
  const norm = normalizeResult(current ?? GAME_RESULT.ONGOING);
  const idx = ALL_RESULTS.indexOf(norm as GameResult);
  const next = ALL_RESULTS[(idx + 1) % ALL_RESULTS.length];
  return next ?? GAME_RESULT.ONGOING;
}

/** Display form of a result token: "1/2-1/2" → "½–½", "1-0" → "1–0". */
export function formatResult(result: string | null | undefined): string {
  if (!result || result === GAME_RESULT.ONGOING) return "—";
  if (normalizeResult(result) === GAME_RESULT.DRAW) return "½–½";
  return result.replace("-", "–");
}
