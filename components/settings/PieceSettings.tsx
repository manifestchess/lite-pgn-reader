/**
 * Piece set picker. Previews render a 4x4 corner of the current board
 * theme with real sprites, so the choice is judged in context. Every set
 * in ALL_PIECE_SETS corresponds to sprites under
 * public/chess-assets/pieces/.
 */

import {
  useBoardPreferencesStore,
  PIECE_SETS,
  getBoardThemeUrl,
  getPieceUrl,
  type PieceSet,
  type BoardTheme,
} from "../../store/board-preferences-store";

export const ALL_PIECE_SETS = Object.keys(PIECE_SETS) as PieceSet[];

const PREVIEW_POSITIONS = [
  { row: 0, col: 0, piece: "bR" },
  { row: 0, col: 1, piece: "bN" },
  { row: 0, col: 2, piece: "bB" },
  { row: 0, col: 3, piece: "bQ" },
  { row: 1, col: 0, piece: "bP" },
  { row: 1, col: 1, piece: "bK" },
  { row: 2, col: 2, piece: "wK" },
  { row: 2, col: 3, piece: "wP" },
  { row: 3, col: 0, piece: "wQ" },
  { row: 3, col: 1, piece: "wB" },
  { row: 3, col: 2, piece: "wN" },
  { row: 3, col: 3, piece: "wR" },
];

export function PieceSetPreview({
  pieceSet,
  theme,
  isSelected,
  onClick,
  size,
}: {
  pieceSet: PieceSet;
  theme: BoardTheme;
  isSelected: boolean;
  onClick: () => void;
  size?: number;
}): React.ReactElement {
  const px = size ?? 72;

  return (
    <button
      aria-label={`Piece set ${PIECE_SETS[pieceSet].name}`}
      aria-pressed={isSelected}
      className={`relative cursor-pointer overflow-visible transition-all duration-150 ${
        isSelected ? "scale-105" : "hover:scale-[1.02]"
      }`}
      data-testid={`piece-set-${pieceSet}`}
      onClick={onClick}
    >
      <div
        className={`relative overflow-hidden rounded-lg transition-all duration-150 ${
          isSelected
            ? "ring-2 ring-primary ring-offset-1 ring-offset-page"
            : "ring-1 ring-line hover:ring-txt-dim"
        }`}
        style={{
          width: px,
          height: px,
          backgroundImage: `url(${getBoardThemeUrl(theme)})`,
          backgroundSize: "200%",
        }}
      >
        {PREVIEW_POSITIONS.map(({ row, col, piece }) => (
          <div
            key={`${row}-${col}`}
            className="pointer-events-none absolute"
            style={{
              width: "25%",
              height: "25%",
              left: `${col * 25}%`,
              top: `${row * 25}%`,
              backgroundImage: `url(${getPieceUrl(pieceSet, piece)})`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "center",
            }}
          />
        ))}
      </div>
      {isSelected && (
        <div className="absolute -right-1 -top-1 rounded-full bg-primary p-[1px] text-accent-foreground">
          <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
            <path d="M6.5 12l-4-4 1.4-1.4 2.6 2.6 5.6-5.6L13.5 5z" />
          </svg>
        </div>
      )}
    </button>
  );
}

export function PieceSettings(): React.ReactElement {
  const theme = useBoardPreferencesStore((s) => s.theme);
  const pieceSet = useBoardPreferencesStore((s) => s.pieceSet);
  const setPieceSet = useBoardPreferencesStore((s) => s.setPieceSet);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-txt-clear">Pieces</h3>
        <p className="mt-0.5 text-xs text-txt-dimmer">
          The set the board and the promotion picker draw.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-x-4 gap-y-5">
        {ALL_PIECE_SETS.map((ps) => (
          <div key={ps} className="flex flex-col items-center gap-2">
            <PieceSetPreview
              isSelected={pieceSet === ps}
              pieceSet={ps}
              size={104}
              theme={theme}
              onClick={() => setPieceSet(ps)}
            />
            <span
              className={`text-center text-[11px] leading-tight ${
                pieceSet === ps ? "text-primary-ink" : "text-txt-dim"
              }`}
            >
              {PIECE_SETS[ps].name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
