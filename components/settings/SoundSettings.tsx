/**
 * Sound settings: master toggle, theme picker with preview buttons, volume.
 * Previews deliberately ignore the master toggle so a theme can be
 * auditioned before turning sound on.
 */

import { useEffect } from "react";

import { ToggleSetting } from "./ToggleSetting";

import { useBoardPreferencesStore } from "../../store/board-preferences-store";
import {
  SOUND_EVENT,
  SOUND_THEME,
  SOUND_THEMES,
  type SoundTheme,
} from "../../lib/sound/sound-themes";
import { playSoundPreview, preloadSoundTheme } from "../../lib/sound/play-sound";

const THEME_ORDER: SoundTheme[] = [
  SOUND_THEME.SFX,
  SOUND_THEME.PIANO,
  SOUND_THEME.NES,
  SOUND_THEME.FUTURISTIC,
];

/**
 * Keys that actually move a range input. Previewing on any keyup would
 * fire on the Tab press that lands focus here, since that keyup is
 * delivered to the newly focused element.
 */
const VOLUME_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function SpeakerIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function SoundSettings(): React.ReactElement {
  const soundEnabled = useBoardPreferencesStore((s) => s.soundEnabled);
  const soundTheme = useBoardPreferencesStore((s) => s.soundTheme);
  const soundVolume = useBoardPreferencesStore((s) => s.soundVolume);
  const setSoundEnabled = useBoardPreferencesStore((s) => s.setSoundEnabled);
  const setSoundTheme = useBoardPreferencesStore((s) => s.setSoundTheme);
  const setSoundVolume = useBoardPreferencesStore((s) => s.setSoundVolume);

  useEffect(() => {
    preloadSoundTheme(soundTheme);
  }, [soundTheme]);

  function preview(theme: SoundTheme): void {
    playSoundPreview(theme, SOUND_EVENT.MOVE, soundVolume);
  }

  function handleSelect(theme: SoundTheme): void {
    setSoundTheme(theme);
    preloadSoundTheme(theme);
    preview(theme);
  }

  const volumePercent = Math.round(soundVolume * 100);
  const muted = soundVolume === 0;

  return (
    <div className="space-y-6">
      <ToggleSetting
        description="Piece sounds on moves, captures and checks."
        label="Sound"
        value={soundEnabled}
        onChange={setSoundEnabled}
      />

      <div
        className={`space-y-4 transition-opacity duration-150 ${
          soundEnabled ? "" : "opacity-50"
        }`}
      >
        <div>
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-txt-clear">Sound theme</h4>
            {!soundEnabled && (
              <span className="text-[10px] text-txt-dimmer">
                Sound is off. Previews still play.
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-txt-dimmer">
            The character of the board sounds.
          </p>
        </div>

        <div className="space-y-1.5">
          {THEME_ORDER.map((theme) => {
            const info = SOUND_THEMES[theme];
            const selected = soundTheme === theme;

            return (
              <div
                key={theme}
                className={`flex items-center gap-3 rounded-lg py-2 pl-3 pr-1.5 transition-all duration-150 ${
                  selected
                    ? "chip-active ring-1 ring-primary"
                    : "bg-low/50 ring-1 ring-line hover:ring-txt-dim"
                }`}
              >
                <button
                  aria-pressed={selected}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                  data-testid={`sound-theme-${theme}`}
                  onClick={() => handleSelect(theme)}
                >
                  <span
                    className={`block truncate text-xs font-medium ${
                      selected ? "" : "text-txt"
                    }`}
                  >
                    {info.name}
                  </span>
                  <p
                    className={`mt-0.5 truncate text-[11px] ${
                      selected ? "" : "text-txt-dimmer"
                    }`}
                  >
                    {info.description}
                  </p>
                </button>
                <button
                  aria-label={`Preview ${info.name}`}
                  className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-md transition-colors duration-150 ${
                    selected
                      ? "hover:bg-txt-clear/10"
                      : "text-txt-dimmer hover:bg-txt-clear/5 hover:text-txt"
                  }`}
                  onClick={() => preview(theme)}
                >
                  <SpeakerIcon />
                </button>
              </div>
            );
          })}
        </div>

        <div className="pt-1">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-txt-clear">Volume</h4>
            <span className="text-xs tabular-nums text-txt-dim">
              {muted ? "Muted" : `${volumePercent}%`}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <input
              aria-label="Sound volume"
              aria-valuetext={muted ? "Muted" : `${volumePercent} percent`}
              className="input h-1 flex-1 accent-primary"
              max={100}
              min={0}
              step={5}
              type="range"
              value={volumePercent}
              onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
              onKeyUp={(e) => {
                if (VOLUME_KEYS.has(e.key)) preview(soundTheme);
              }}
              onPointerUp={() => preview(soundTheme)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
