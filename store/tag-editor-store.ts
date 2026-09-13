/** Open flag for the tag editor modal. */

import { create } from "zustand";

interface TagEditorState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useTagEditorStore = create<TagEditorState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
