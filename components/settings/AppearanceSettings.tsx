/**
 * Appearance: light / dark / follow system, via next-themes (the
 * ThemeProvider is mounted in app/main.tsx). next-themes flips the
 * `class` attribute on <html>, which the token palettes in
 * styles/globals.css key off.
 */

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const OPTIONS: { key: string; label: string; desc: string }[] = [
  { key: "light", label: "Light", desc: "Cream and amber" },
  { key: "dark", label: "Dark", desc: "Charcoal and amber" },
  { key: "system", label: "System", desc: "Follow macOS" },
];

export function AppearanceSettings(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  // next-themes resolves the stored choice after mount; rendering the
  // selection before that would flash the wrong tile.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current = mounted ? (theme ?? "system") : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-txt-clear">Appearance</h3>
        <p className="mt-0.5 text-xs text-txt-dimmer">
          The app around the board.
        </p>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt.key}
            aria-pressed={current === opt.key}
            className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[11px] transition-all duration-150 ${
              current === opt.key
                ? "chip-active ring-1 ring-primary"
                : "bg-low/50 text-txt-dim ring-1 ring-line hover:text-txt hover:ring-txt-dim"
            }`}
            data-testid={`appearance-${opt.key}`}
            onClick={() => setTheme(opt.key)}
          >
            <span className="font-medium">{opt.label}</span>
            <span className="text-[9px]">{opt.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
