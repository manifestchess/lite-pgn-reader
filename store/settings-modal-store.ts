/**
 * Settings panel open state. There is ONE scrollable settings panel, so this
 * stores an optional section to scroll to on open (the About menu item and
 * the engine chip both deep-link this way).
 */

import { create } from "zustand";

export const SETTINGS_SECTION = {
  BOARD: "board",
  PIECES: "pieces",
  COORDINATES: "coordinates",
  ANIMATION: "animation",
  SOUND: "sound",
  MOVES: "moves",
  ENGINE: "engine",
  APPEARANCE: "appearance",
  ABOUT: "about",
} as const;

export type SettingsSection =
  (typeof SETTINGS_SECTION)[keyof typeof SETTINGS_SECTION];

interface SettingsModalState {
  isOpen: boolean;
  /** Section to bring into view when the panel opens; null = top. */
  section: SettingsSection | null;
  open: (section?: SettingsSection) => void;
  close: () => void;
  toggle: () => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set, get) => ({
  isOpen: false,
  section: null,
  open: (section) => set({ isOpen: true, section: section ?? null }),
  close: () => set({ isOpen: false }),
  toggle: () => set({ isOpen: !get().isOpen, section: null }),
}));
