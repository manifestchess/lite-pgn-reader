/**
 * Move animation speed: four presets plus a custom millisecond value with
 * number + range inputs.
 */

import { useEffect, useState } from "react";

import {
  useBoardPreferencesStore,
  ANIMATION_SPEEDS,
  type AnimationSpeed,
} from "../../store/board-preferences-store";

const PRESET_SPEEDS: AnimationSpeed[] = ["slow", "normal", "fast", "none"];

export function AnimationSettings(): React.ReactElement {
  const animationSpeed = useBoardPreferencesStore((s) => s.animationSpeed);
  const customAnimationMs = useBoardPreferencesStore((s) => s.customAnimationMs);
  const setAnimationSpeed = useBoardPreferencesStore((s) => s.setAnimationSpeed);
  const setCustomAnimationMs = useBoardPreferencesStore(
    (s) => s.setCustomAnimationMs,
  );

  const [customInput, setCustomInput] = useState(String(customAnimationMs));

  useEffect(() => {
    setCustomInput(String(customAnimationMs));
  }, [customAnimationMs]);

  function handleCustomInputChange(value: string): void {
    setCustomInput(value);
    const num = parseInt(value, 10);

    if (!isNaN(num) && num >= 0 && num <= 2000) {
      setCustomAnimationMs(num);
    }
  }

  function handleCustomInputBlur(): void {
    const num = parseInt(customInput, 10);

    if (isNaN(num) || num < 0) {
      setCustomInput(String(customAnimationMs));
    } else if (num > 2000) {
      setCustomAnimationMs(2000);
      setCustomInput("2000");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-txt-clear">Animation</h3>
        <p className="mt-0.5 text-xs text-txt-dimmer">
          How quickly pieces glide between squares.
        </p>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {PRESET_SPEEDS.map((speed) => (
          <button
            key={speed}
            aria-pressed={animationSpeed === speed}
            className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[11px] transition-all duration-150 ${
              animationSpeed === speed
                ? "chip-active ring-1 ring-primary"
                : "bg-low/50 text-txt-dim ring-1 ring-line hover:text-txt hover:ring-txt-dim"
            }`}
            onClick={() => setAnimationSpeed(speed)}
          >
            <span className="font-medium">{ANIMATION_SPEEDS[speed].name}</span>
            <span className="text-[9px]">
              {speed === "none" ? "Instant" : `${ANIMATION_SPEEDS[speed].ms} ms`}
            </span>
          </button>
        ))}
        <button
          aria-pressed={animationSpeed === "custom"}
          className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-lg text-[11px] transition-all duration-150 ${
            animationSpeed === "custom"
              ? "chip-active ring-1 ring-primary"
              : "bg-low/50 text-txt-dim ring-1 ring-line hover:text-txt hover:ring-txt-dim"
          }`}
          onClick={() => setAnimationSpeed("custom")}
        >
          <span className="font-medium">Custom</span>
          <span className="text-[9px]">{customAnimationMs} ms</span>
        </button>
      </div>

      {animationSpeed === "custom" && (
        <div className="flex items-center gap-3 pt-1">
          <label
            className="whitespace-nowrap text-xs text-txt-dim"
            htmlFor="custom-animation-ms"
          >
            Duration
          </label>
          <input
            className="input w-20 rounded-md border border-line bg-low px-2 py-1 text-center text-xs text-txt-clear [appearance:textfield] focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            id="custom-animation-ms"
            max={2000}
            min={0}
            step={10}
            type="number"
            value={customInput}
            onBlur={handleCustomInputBlur}
            onChange={(e) => handleCustomInputChange(e.target.value)}
          />
          <input
            aria-label="Custom animation duration"
            className="input h-1 flex-1 accent-primary"
            max={1000}
            min={0}
            step={10}
            type="range"
            value={customAnimationMs > 1000 ? 1000 : customAnimationMs}
            onChange={(e) => {
              const v = Number(e.target.value);

              setCustomAnimationMs(v);
              setCustomInput(String(v));
            }}
          />
        </div>
      )}
    </div>
  );
}
