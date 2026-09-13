/**
 * Pane layout for the fixed three panes. App-global, persisted: pane widths
 * are a workspace preference, not a per-document one.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const LEFT_DEFAULT = 288;
export const RIGHT_DEFAULT = 384;
const LEFT_MIN = 200;
const LEFT_MAX = 480;
const RIGHT_MIN = 280;
const RIGHT_MAX = 560;

interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  /** True while a divider drag is in flight (disables width transitions). */
  resizing: boolean;
  setLeftWidth(px: number): void;
  setRightWidth(px: number): void;
  setResizing(resizing: boolean): void;
  resetLeft(): void;
  resetRight(): void;
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      leftWidth: LEFT_DEFAULT,
      rightWidth: RIGHT_DEFAULT,
      resizing: false,
      setLeftWidth: (px) => set({ leftWidth: clamp(px, LEFT_MIN, LEFT_MAX) }),
      setRightWidth: (px) => set({ rightWidth: clamp(px, RIGHT_MIN, RIGHT_MAX) }),
      setResizing: (resizing) => set({ resizing }),
      resetLeft: () => set({ leftWidth: LEFT_DEFAULT }),
      resetRight: () => set({ rightWidth: RIGHT_DEFAULT }),
    }),
    {
      name: "pgnreader-layout",
      partialize: (s) => ({ leftWidth: s.leftWidth, rightWidth: s.rightWidth }),
    },
  ),
);
