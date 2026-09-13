/**
 * Board presentation preferences. zustand `persist` into localStorage under
 * the app's own key; `merge` sanitizes stale persisted asset names so a
 * removed theme can never leave the board pointing at a 404.
 *
 * Every catalogue entry below matches the staged assets in public/chess-assets
 * (17 piece sets, 24 board themes).
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { SoundTheme } from "../lib/sound/sound-themes";
import { SOUND_THEME } from "../lib/sound/sound-themes";

export type BoardTheme =
  | "disco"
  | "blue"
  | "blue2"
  | "blue3"
  | "blue-marble"
  | "brown"
  | "canvas"
  | "green-plastic"
  | "grey"
  | "ic"
  | "leather"
  | "maple"
  | "maple2"
  | "marble"
  | "metal"
  | "newspaper"
  | "olive"
  | "pink"
  | "purple"
  | "purple-diag"
  | "wood"
  | "wood2"
  | "wood3"
  | "wood4";

/**
 * Piece sets we are licensed to ship: every entry is redistributable in a
 * commercial, GPL-licensed product (see COPYING.md). Sets under CC BY-NC-SA
 * or with no licence grant are not redistributable here and are excluded.
 */
export type PieceSet =
  | "caliente"
  | "cburnett"
  | "celtic"
  | "chessnut"
  | "fantasy"
  | "firi"
  | "kiwen-suwi"
  | "kosal"
  | "letter"
  | "merida"
  | "mono"
  | "mpchess"
  | "pirouetti"
  | "pixel"
  | "rhosgfx"
  | "shapes"
  | "spatial";

export type CoordinatePosition = "outside" | "inside" | "none";
export type AnimationSpeed = "slow" | "normal" | "fast" | "none" | "custom";
export type MoveInput = "both" | "drag" | "click";

export const BOARD_THEMES: Record<
  BoardTheme,
  { name: string; file: string; ext: string }
> = {
  disco: { name: "Green", file: "disco", ext: "svg" },
  brown: { name: "Brown", file: "brown", ext: "png" },
  blue: { name: "Blue", file: "blue", ext: "png" },
  purple: { name: "Purple", file: "purple", ext: "png" },
  ic: { name: "IC", file: "ic", ext: "png" },
  "green-plastic": { name: "Green Plastic", file: "green-plastic", ext: "png" },
  pink: { name: "Pink", file: "pink-pyramid", ext: "png" },
  "purple-diag": { name: "Purple Diag", file: "purple-diag", ext: "png" },
  grey: { name: "Grey", file: "grey", ext: "jpg" },
  wood: { name: "Wood", file: "wood", ext: "jpg" },
  wood2: { name: "Wood 2", file: "wood2", ext: "jpg" },
  wood3: { name: "Wood 3", file: "wood3", ext: "jpg" },
  wood4: { name: "Wood 4", file: "wood4", ext: "jpg" },
  maple: { name: "Maple", file: "maple", ext: "jpg" },
  maple2: { name: "Maple 2", file: "maple2", ext: "jpg" },
  olive: { name: "Olive", file: "olive", ext: "jpg" },
  leather: { name: "Leather", file: "leather", ext: "jpg" },
  blue2: { name: "Blue 2", file: "blue2", ext: "jpg" },
  blue3: { name: "Blue 3", file: "blue3", ext: "jpg" },
  "blue-marble": { name: "Blue Marble", file: "blue-marble", ext: "jpg" },
  canvas: { name: "Canvas", file: "canvas2", ext: "jpg" },
  marble: { name: "Marble", file: "marble", ext: "jpg" },
  metal: { name: "Metal", file: "metal", ext: "jpg" },
  newspaper: { name: "Newspaper", file: "newspaper", ext: "svg" },
};

export const PIECE_SETS: Record<PieceSet, { name: string }> = {
  cburnett: { name: "Cburnett" },
  merida: { name: "Merida" },
  kosal: { name: "Kosal" },
  pirouetti: { name: "Pirouetti" },
  spatial: { name: "Spatial" },
  fantasy: { name: "Fantasy" },
  chessnut: { name: "Chessnut" },
  mpchess: { name: "MP Chess" },
  celtic: { name: "Celtic" },
  caliente: { name: "Caliente" },
  firi: { name: "Firi" },
  "kiwen-suwi": { name: "Kiwen Suwi" },
  letter: { name: "Letter" },
  mono: { name: "Mono" },
  pixel: { name: "Pixel" },
  rhosgfx: { name: "Rhosgfx" },
  shapes: { name: "Shapes" },
};

export const ANIMATION_SPEEDS: Record<
  AnimationSpeed,
  { ms: number; name: string }
> = {
  slow: { ms: 500, name: "Slow" },
  normal: { ms: 300, name: "Normal" },
  fast: { ms: 150, name: "Fast" },
  none: { ms: 0, name: "None" },
  custom: { ms: 200, name: "Custom" },
};

export const DEFAULT_CUSTOM_ANIMATION_MS = 200;

export const DEFAULT_THEME: BoardTheme = "brown";
export const DEFAULT_PIECE_SET: PieceSet = "cburnett";
export const DEFAULT_COORDINATE_POSITION: CoordinatePosition = "outside";
export const DEFAULT_ANIMATION_SPEED: AnimationSpeed = "normal";
export const DEFAULT_SOUND_ENABLED = true;
export const DEFAULT_SOUND_THEME: SoundTheme = SOUND_THEME.SFX;
export const DEFAULT_SOUND_VOLUME = 0.7;
export const DEFAULT_MOVE_INPUT: MoveInput = "both";
export const DEFAULT_SHOW_MOVE_HINTS = true;
export const DEFAULT_SHOW_GHOST_PIECE = true;
export const DEFAULT_HIGHLIGHT_LAST_MOVE = true;
export const DEFAULT_BOARD_SIZE_SCALE = 1.0;

interface BoardPreferencesState {
  theme: BoardTheme;
  pieceSet: PieceSet;
  coordinatePosition: CoordinatePosition;
  animationSpeed: AnimationSpeed;
  customAnimationMs: number;
  soundEnabled: boolean;
  soundTheme: SoundTheme;
  soundVolume: number;
  moveInput: MoveInput;
  showMoveHints: boolean;
  showGhostPiece: boolean;
  highlightLastMove: boolean;
  boardSizeScale: number;

  setTheme: (theme: BoardTheme) => void;
  setPieceSet: (pieceSet: PieceSet) => void;
  setCoordinatePosition: (position: CoordinatePosition) => void;
  setAnimationSpeed: (speed: AnimationSpeed) => void;
  setCustomAnimationMs: (ms: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundTheme: (theme: SoundTheme) => void;
  setSoundVolume: (volume: number) => void;
  setMoveInput: (input: MoveInput) => void;
  setShowMoveHints: (show: boolean) => void;
  setShowGhostPiece: (show: boolean) => void;
  setHighlightLastMove: (show: boolean) => void;
  setBoardSizeScale: (scale: number) => void;
  resetPreferences: () => void;
}

export function isPieceSet(value: unknown): value is PieceSet {
  return typeof value === "string" && value in PIECE_SETS;
}

export function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === "string" && value in BOARD_THEMES;
}

/**
 * Strip `theme` / `pieceSet` from a persisted blob when they name an asset
 * the app does not ship, so the store's defaults win instead. Runs on every
 * rehydrate rather than a version bump, so it covers future removals too.
 */
export function sanitizePersisted(persisted: unknown): Record<string, unknown> {
  if (typeof persisted !== "object" || persisted === null) return {};

  const state = { ...(persisted as Record<string, unknown>) };

  if (!isBoardTheme(state.theme)) delete state.theme;
  if (!isPieceSet(state.pieceSet)) delete state.pieceSet;

  return state;
}

export const useBoardPreferencesStore = create<BoardPreferencesState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      pieceSet: DEFAULT_PIECE_SET,
      coordinatePosition: DEFAULT_COORDINATE_POSITION,
      animationSpeed: DEFAULT_ANIMATION_SPEED,
      customAnimationMs: DEFAULT_CUSTOM_ANIMATION_MS,
      soundEnabled: DEFAULT_SOUND_ENABLED,
      soundTheme: DEFAULT_SOUND_THEME,
      soundVolume: DEFAULT_SOUND_VOLUME,
      moveInput: DEFAULT_MOVE_INPUT,
      showMoveHints: DEFAULT_SHOW_MOVE_HINTS,
      showGhostPiece: DEFAULT_SHOW_GHOST_PIECE,
      highlightLastMove: DEFAULT_HIGHLIGHT_LAST_MOVE,
      boardSizeScale: DEFAULT_BOARD_SIZE_SCALE,

      setTheme: (theme) => set({ theme }),
      setPieceSet: (pieceSet) => set({ pieceSet }),
      setCoordinatePosition: (position) => set({ coordinatePosition: position }),
      setAnimationSpeed: (speed) => set({ animationSpeed: speed }),
      setCustomAnimationMs: (ms) => set({ customAnimationMs: ms }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setSoundTheme: (theme) => set({ soundTheme: theme }),
      setSoundVolume: (volume) =>
        set({ soundVolume: Math.max(0, Math.min(1, volume)) }),
      setMoveInput: (input) => set({ moveInput: input }),
      setShowMoveHints: (show) => set({ showMoveHints: show }),
      setShowGhostPiece: (show) => set({ showGhostPiece: show }),
      setHighlightLastMove: (show) => set({ highlightLastMove: show }),
      setBoardSizeScale: (scale) =>
        set({ boardSizeScale: Math.max(0.3, Math.min(1.0, scale)) }),
      resetPreferences: () =>
        set({
          theme: DEFAULT_THEME,
          pieceSet: DEFAULT_PIECE_SET,
          coordinatePosition: DEFAULT_COORDINATE_POSITION,
          animationSpeed: DEFAULT_ANIMATION_SPEED,
          customAnimationMs: DEFAULT_CUSTOM_ANIMATION_MS,
          soundEnabled: DEFAULT_SOUND_ENABLED,
          soundTheme: DEFAULT_SOUND_THEME,
          soundVolume: DEFAULT_SOUND_VOLUME,
          moveInput: DEFAULT_MOVE_INPUT,
          showMoveHints: DEFAULT_SHOW_MOVE_HINTS,
          showGhostPiece: DEFAULT_SHOW_GHOST_PIECE,
          highlightLastMove: DEFAULT_HIGHLIGHT_LAST_MOVE,
          boardSizeScale: DEFAULT_BOARD_SIZE_SCALE,
        }),
    }),
    {
      name: "pgnreader-board-preferences",
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersisted(persisted),
      }),
      partialize: (state) => ({
        theme: state.theme,
        pieceSet: state.pieceSet,
        coordinatePosition: state.coordinatePosition,
        animationSpeed: state.animationSpeed,
        customAnimationMs: state.customAnimationMs,
        soundEnabled: state.soundEnabled,
        soundTheme: state.soundTheme,
        soundVolume: state.soundVolume,
        moveInput: state.moveInput,
        showMoveHints: state.showMoveHints,
        showGhostPiece: state.showGhostPiece,
        highlightLastMove: state.highlightLastMove,
        boardSizeScale: state.boardSizeScale,
      }),
    },
  ),
);

export function getAnimationMs(speed: AnimationSpeed, customMs: number): number {
  return speed === "custom" ? customMs : ANIMATION_SPEEDS[speed].ms;
}

export function getBoardThemeUrl(theme: BoardTheme): string {
  const t = BOARD_THEMES[theme];

  return `/chess-assets/boards/${t.file}.${t.ext}`;
}

export function getPieceUrl(pieceSet: PieceSet, piece: string): string {
  const baseUrl = `/chess-assets/pieces/${pieceSet}`;

  if (pieceSet === "mono") return `${baseUrl}/${piece.slice(1)}.svg`;

  return `${baseUrl}/${piece}.svg`;
}
