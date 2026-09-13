/**
 * Single-key NAG entry: with a move selected and no field
 * focused, ! and ? keystrokes compose within a short window into one of
 * the six standard suffix annotations (!, ?, !!, ??, !?, ?!) and commit.
 *
 * Timing lives here, separated from the keyboard hook, so tests can drive
 * it with fake timers.
 */

export const NAG_COMPOSE_WINDOW_MS = 350;

export interface NagComposer {
  /** Feed one keystroke. Two keys commit immediately; one commits when the
   *  window elapses without a second. */
  press: (ch: "!" | "?") => void;
  /** Drop any pending composition (navigation moved on, editor opened...). */
  cancel: () => void;
}

export function createNagComposer(
  commit: (sequence: string) => void,
  windowMs: number = NAG_COMPOSE_WINDOW_MS,
): NagComposer {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (buffer.length === 0) return;
    const seq = buffer;
    buffer = "";
    commit(seq);
  };

  return {
    press(ch) {
      buffer += ch;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (buffer.length >= 2) {
        flush();
        return;
      }
      timer = setTimeout(flush, windowMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      buffer = "";
    },
  };
}
