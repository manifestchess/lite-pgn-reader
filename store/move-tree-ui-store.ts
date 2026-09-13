import { create } from "zustand";

/**
 * One-shot request flags for the current position. Keyboard shortcuts set
 * one, MoveTreePanel opens the matching editor and clears it.
 */
interface MoveTreeUIState {
  commentRequested: boolean;
  annotationRequested: boolean;
  deleteRequested: boolean;

  requestComment: () => void;
  requestAnnotation: () => void;
  requestDelete: () => void;
  clearRequests: () => void;
}

export const useMoveTreeUIStore = create<MoveTreeUIState>((set) => ({
  commentRequested: false,
  annotationRequested: false,
  deleteRequested: false,

  requestComment: () => set({ commentRequested: true }),
  requestAnnotation: () => set({ annotationRequested: true }),
  requestDelete: () => set({ deleteRequested: true }),
  clearRequests: () =>
    set({
      commentRequested: false,
      annotationRequested: false,
      deleteRequested: false,
    }),
}));
