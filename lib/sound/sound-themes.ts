/**
 * Sound theme catalogue and the event taxonomy the player resolves against.
 * Renderer only: the settings panel renders the picker, and
 * `lib/sound/play-sound.ts` resolves an event to a file URL under the app
 * origin (/sounds/<theme>/<event>.mp3, staged in public/).
 */

export const SOUND_EVENT = {
  MOVE: "move",
  CAPTURE: "capture",
  CHECK: "check",
} as const;
export type SoundEvent = (typeof SOUND_EVENT)[keyof typeof SOUND_EVENT];

export const SOUND_THEME = {
  PIANO: "piano",
  SFX: "sfx",
  NES: "nes",
  FUTURISTIC: "futuristic",
} as const;
export type SoundTheme = (typeof SOUND_THEME)[keyof typeof SOUND_THEME];

interface SoundThemeInfo {
  /** Label shown in the settings picker. */
  name: string;
  /** One-line character description shown under the label. */
  description: string;
  /**
   * Events this theme ships a distinct file for. Anything omitted falls back
   * to `SOUND_EVENT.MOVE`, so every theme must provide that one.
   */
  events: readonly SoundEvent[];
}

export const SOUND_THEMES: Record<SoundTheme, SoundThemeInfo> = {
  sfx: {
    name: "Wooden",
    description: "Weighted pieces on a wooden board",
    events: [SOUND_EVENT.MOVE, SOUND_EVENT.CAPTURE, SOUND_EVENT.CHECK],
  },
  piano: {
    name: "Piano",
    description: "Soft struck notes",
    events: [SOUND_EVENT.MOVE, SOUND_EVENT.CAPTURE, SOUND_EVENT.CHECK],
  },
  nes: {
    name: "Arcade",
    description: "8-bit chiptune blips",
    events: [SOUND_EVENT.MOVE, SOUND_EVENT.CAPTURE, SOUND_EVENT.CHECK],
  },
  futuristic: {
    name: "Futuristic",
    description: "Synthetic sci-fi tones",
    events: [SOUND_EVENT.MOVE, SOUND_EVENT.CAPTURE, SOUND_EVENT.CHECK],
  },
};

export function isSoundTheme(value: unknown): value is SoundTheme {
  return typeof value === "string" && value in SOUND_THEMES;
}

/** Collapses to `MOVE` when the theme ships no file for `event`. */
export function resolveSoundEvent(
  theme: SoundTheme,
  event: SoundEvent,
): SoundEvent {
  return SOUND_THEMES[theme].events.includes(event) ? event : SOUND_EVENT.MOVE;
}

/** URL of the file a theme uses for an event, after fallback. */
export function getSoundUrl(theme: SoundTheme, event: SoundEvent): string {
  return `/sounds/${theme}/${resolveSoundEvent(theme, event)}.mp3`;
}

/**
 * Classifies a move from its SAN. Check and mate outrank capture, so a
 * capture that gives check sounds like a check, following common convention.
 */
export function soundEventForSan(san: string): SoundEvent {
  if (san.includes("+") || san.includes("#")) return SOUND_EVENT.CHECK;
  if (san.includes("x")) return SOUND_EVENT.CAPTURE;

  return SOUND_EVENT.MOVE;
}
