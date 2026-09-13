/**
 * Small non-modal notice above the bottom edge. Carries refused-edit messages
 * and small confirmations; never steals focus, never blocks input.
 */

import { useEffect, useState } from "react";

import { useToastStore } from "../../store/toast-store";

export function ActionToast(): React.ReactElement | null {
  const message = useToastStore((s) => s.message);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);

      return;
    }
    // Stays mounted for the length of the fade-out, or the toast vanishes
    // instead of animating away.
    const t = setTimeout(() => setVisible(false), 200);

    return () => clearTimeout(t);
  }, [message]);

  if (!visible && !message) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 transition-all duration-200"
      data-testid="toast"
      role="status"
      style={{
        opacity: message ? 1 : 0,
        transform: `translateX(-50%) translateY(${message ? "0" : "4px"})`,
      }}
    >
      <div className="whitespace-nowrap rounded-lg border border-transp bg-box px-4 py-2 text-[13px] text-txt-clear shadow-lg">
        {message}
      </div>
    </div>
  );
}
