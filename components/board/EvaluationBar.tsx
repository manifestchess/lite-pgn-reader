/**
 * Vertical evaluation bar. Scores arrive white-positive; the bar tracks
 * board orientation so the white half always sits on white's side of the
 * board.
 */

interface EvaluationBarProps {
  score: number; // Centipawns from white's perspective
  mate: number | null;
  height: number;
  boardOrientation: "white" | "black";
}

/** Sigmoid scaling: +/-5 pawns approaches 95%/5% */
function scoreToPercentage(score: number): number {
  const pawns = score / 100;
  const sigmoid = 1 / (1 + Math.exp(-pawns * 0.4));

  return sigmoid * 100;
}

function formatScore(score: number, mate: number | null): string {
  if (mate !== null) return `#${Math.abs(mate)}`;
  const pawns = Math.abs(score) / 100;

  return pawns.toFixed(1);
}

export function EvaluationBar({
  score,
  mate,
  height,
  boardOrientation,
}: EvaluationBarProps) {
  let whitePercent: number;

  if (mate !== null) {
    if (mate === 0) {
      whitePercent = score > 0 ? 100 : 0;
    } else {
      whitePercent = mate > 0 ? 100 : 0;
    }
  } else {
    whitePercent = scoreToPercentage(score);
  }

  const blackPercent = 100 - whitePercent;
  const displayScore = formatScore(score, mate);
  const isWhiteAdvantage =
    mate !== null ? (mate === 0 ? score > 0 : mate > 0) : score >= 0;
  const isFlipped = boardOrientation === "black";

  const topPercent = isFlipped ? whitePercent : blackPercent;
  const bottomPercent = isFlipped ? blackPercent : whitePercent;
  const topIsWhite = isFlipped;

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-sm shrink-0"
      data-testid="evaluation-bar"
      style={{ width: 26, height }}
    >
      <div
        className={`relative flex items-start justify-center transition-all duration-300 ${
          topIsWhite ? "bg-[#e8e8e8]" : "bg-[#3a3a3a]"
        }`}
        style={{ height: `${topPercent}%` }}
      >
        {((topIsWhite && isWhiteAdvantage) ||
          (!topIsWhite && !isWhiteAdvantage)) &&
          topPercent >= 15 && (
            <span
              className={`mt-1 text-[9px] font-bold leading-none ${topIsWhite ? "text-neutral-800" : "text-neutral-100"}`}
            >
              {displayScore}
            </span>
          )}
      </div>

      <div
        className={`relative flex items-end justify-center transition-all duration-300 ${
          topIsWhite ? "bg-[#3a3a3a]" : "bg-[#e8e8e8]"
        }`}
        style={{ height: `${bottomPercent}%` }}
      >
        {((topIsWhite && !isWhiteAdvantage) ||
          (!topIsWhite && isWhiteAdvantage)) &&
          bottomPercent >= 15 && (
            <span
              className={`mb-1 text-[9px] font-bold leading-none ${topIsWhite ? "text-neutral-100" : "text-neutral-800"}`}
            >
              {displayScore}
            </span>
          )}
      </div>
    </div>
  );
}
