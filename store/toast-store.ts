import { create } from "zustand";

/** Global toast notifications (one message at a time). */
interface ToastState {
  message: string | null;
  /**
   * `durationMs` for messages that must not be missed. The default suits
   * confirmations; a failed write needs long enough to read and act on.
   */
  show: (message: string, durationMs?: number) => void;
  dismiss: () => void;
}

const DEFAULT_TOAST_MS = 1500;

let timer: ReturnType<typeof setTimeout>;

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  show: (message, durationMs = DEFAULT_TOAST_MS) => {
    clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), durationMs);
  },
  dismiss: () => {
    clearTimeout(timer);
    set({ message: null });
  },
}));
