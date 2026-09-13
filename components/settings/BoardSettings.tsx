/**
 * Board theme picker with live swatches. Every entry in ALL_THEMES
 * corresponds to a board image under public/chess-assets/boards/.
 */

import {
  useBoardPreferencesStore,
  BOARD_THEMES,
  getBoardThemeUrl,
  type BoardTheme,
} from "../../store/board-preferences-store";

export const ALL_THEMES: BoardTheme[] = [
  "brown",
  "disco",
  "blue",
  "purple",
  "ic",
  "green-plastic",
  "grey",
  "wood",
  "wood2",
  "wood3",
  "wood4",
  "maple",
  "maple2",
  "olive",
  "leather",
  "blue2",
  "blue3",
  "blue-marble",
  "canvas",
  "marble",
  "metal",
  "pink",
  "purple-diag",
  "newspaper",
];

export function MiniChessBoard({
  theme,
  isSelected,
  onClick,
  size,
}: {
  theme: BoardTheme;
  isSelected: boolean;
  onClick: () => void;
  size?: number;
}): React.ReactElement {
  const px = size ?? 72;

  return (
    <button
      aria-label={`Board theme ${BOARD_THEMES[theme].name}`}
      aria-pressed={isSelected}
      className={`relative cursor-pointer overflow-visible transition-all duration-150 ${
        isSelected ? "scale-105" : "hover:scale-[1.02]"
      }`}
      data-testid={`board-theme-${theme}`}
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
      />
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

export function BoardThemeSettings(): React.ReactElement {
  const theme = useBoardPreferencesStore((s) => s.theme);
  const setTheme = useBoardPreferencesStore((s) => s.setTheme);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-txt-clear">Board theme</h3>
        <p className="mt-0.5 text-xs text-txt-dimmer">
          The board behind the pieces.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-x-4 gap-y-5">
        {ALL_THEMES.map((option) => (
          <div key={option} className="flex flex-col items-center gap-2">
            <MiniChessBoard
              isSelected={theme === option}
              size={104}
              theme={option}
              onClick={() => setTheme(option)}
            />
            <span
              className={`text-center text-[11px] leading-tight ${
                theme === option ? "text-primary-ink" : "text-txt-dim"
              }`}
            >
              {BOARD_THEMES[option].name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
