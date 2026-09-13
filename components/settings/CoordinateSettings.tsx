/**
 * Coordinate position picker: outside the board (default), inside the
 * squares, or none. Previews are drawn with the current board theme.
 */

import {
  useBoardPreferencesStore,
  getBoardThemeUrl,
  type CoordinatePosition,
  type BoardTheme,
} from "../../store/board-preferences-store";

const POSITION_LABELS: Record<CoordinatePosition, string> = {
  outside: "Outside",
  inside: "Inside",
  none: "None",
};

export function CoordinatePreview({
  position,
  theme,
  isSelected,
  onClick,
  size = 72,
}: {
  position: CoordinatePosition;
  theme: BoardTheme;
  isSelected: boolean;
  onClick: () => void;
  size?: number;
}): React.ReactElement {
  const boardUrl = getBoardThemeUrl(theme);
  const sz = `${size}px`;
  // Label and gutter sizes are defined relative to a 72px tile and scale
  // with it to stay legible at any size.
  const scale = size / 72;
  const insideFont = `${Math.max(5, Math.round(5 * scale))}px`;
  const outsideFont = `${Math.max(4, Math.round(4 * scale))}px`;
  const gutterPx = `${Math.max(10, Math.round(10 * scale))}px`;

  return (
    <button
      aria-label={`Coordinates ${POSITION_LABELS[position].toLowerCase()}`}
      aria-pressed={isSelected}
      className={`flex cursor-pointer flex-col items-center gap-1.5 overflow-visible transition-all duration-150 ${
        isSelected ? "scale-105" : "hover:scale-[1.02]"
      }`}
      data-testid={`coordinates-${position}`}
      onClick={onClick}
    >
      <div className="relative">
        {position === "outside" ? (
          <div
            className={`overflow-hidden rounded-lg transition-all duration-150 ${
              isSelected
                ? "ring-2 ring-primary ring-offset-1 ring-offset-page"
                : "ring-1 ring-line hover:ring-txt-dim"
            }`}
            style={{
              width: sz,
              height: sz,
              display: "grid",
              gridTemplateColumns: `${gutterPx} 1fr`,
              gridTemplateRows: `1fr ${gutterPx}`,
              background: "var(--color-low)",
            }}
          >
            <div
              className="flex flex-col items-center justify-around font-bold text-txt-dim"
              style={{ fontSize: outsideFont }}
            >
              {["4", "3", "2", "1"].map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
            <div
              className="rounded-sm"
              style={{
                backgroundImage: `url(${boardUrl})`,
                backgroundSize: "200%",
                backgroundPosition: "0 100%",
              }}
            />
            <div />
            <div
              className="flex items-center justify-around font-bold text-txt-dim"
              style={{ fontSize: outsideFont }}
            >
              {["a", "b", "c", "d"].map((f) => (
                <span key={f}>{f}</span>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={`relative overflow-hidden rounded-lg transition-all duration-150 ${
              isSelected
                ? "ring-2 ring-primary ring-offset-1 ring-offset-page"
                : "ring-1 ring-line hover:ring-txt-dim"
            }`}
            style={{
              width: sz,
              height: sz,
              backgroundImage: `url(${boardUrl})`,
              backgroundSize: "200%",
              backgroundPosition: "0 100%",
            }}
          >
            {position === "inside" && (
              <>
                {["4", "3", "2", "1"].map((r, i) => (
                  <span
                    key={`r${r}`}
                    className="pointer-events-none absolute font-bold leading-none"
                    style={{
                      top: `${i * 25 + 2}%`,
                      left: "3%",
                      fontSize: insideFont,
                      color:
                        i % 2 === 0
                          ? "rgba(72,52,35,0.8)"
                          : "rgba(235,215,185,0.85)",
                    }}
                  >
                    {r}
                  </span>
                ))}
                {["a", "b", "c", "d"].map((f, i) => (
                  <span
                    key={`f${f}`}
                    className="pointer-events-none absolute font-bold leading-none"
                    style={{
                      bottom: "2%",
                      left: `${(i + 1) * 25 - 3}%`,
                      transform: "translateX(-100%)",
                      fontSize: insideFont,
                      color:
                        i % 2 === 0
                          ? "rgba(235,215,185,0.85)"
                          : "rgba(72,52,35,0.8)",
                    }}
                  >
                    {f}
                  </span>
                ))}
              </>
            )}
          </div>
        )}
        {isSelected && (
          <div className="absolute -right-1 -top-1 z-10 rounded-full bg-primary p-[1px] text-accent-foreground">
            <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 16 16" width="14">
              <path d="M6.5 12l-4-4 1.4-1.4 2.6 2.6 5.6-5.6L13.5 5z" />
            </svg>
          </div>
        )}
      </div>
      <span
        className={`text-[11px] font-medium ${
          isSelected ? "text-primary-ink" : "text-txt-dim"
        }`}
      >
        {POSITION_LABELS[position]}
      </span>
    </button>
  );
}

export function CoordinateSettings(): React.ReactElement {
  const theme = useBoardPreferencesStore((s) => s.theme);
  const coordinatePosition = useBoardPreferencesStore((s) => s.coordinatePosition);
  const setCoordinatePosition = useBoardPreferencesStore(
    (s) => s.setCoordinatePosition,
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-txt-clear">Coordinates</h3>
        <p className="mt-0.5 text-xs text-txt-dimmer">
          Where the file and rank labels sit.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-x-4 gap-y-5">
        {(["outside", "inside", "none"] as CoordinatePosition[]).map((pos) => (
          <div key={pos} className="flex flex-col items-center">
            <CoordinatePreview
              isSelected={coordinatePosition === pos}
              position={pos}
              size={104}
              theme={theme}
              onClick={() => setCoordinatePosition(pos)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
