/**
 * Lightweight inline confirm for destructive tree edits. Keyboard-first and
 * modal-averse, so this is a small anchored popover rather than a full
 * dialog: Return confirms, Escape or click-away cancels, focus lands on the
 * confirm button.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfirmPopoverProps {
  x: number;
  y: number;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmPopover({
  x,
  y,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmPopoverProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel]);

  // Viewport clamping
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, []);

  return createPortal(
    <div
      ref={containerRef}
      aria-label={title}
      className="fixed z-[150] w-[260px] rounded-lg border border-transp bg-overlay p-3 shadow-lg"
      role="alertdialog"
      style={{ left: x, top: y }}
    >
      <div className="text-[13px] font-semibold text-txt-clear">{title}</div>
      <p className="mt-1 text-[12px] leading-snug text-txt-dim">{message}</p>
      <div className="mt-2.5 flex justify-end gap-1.5">
        <button
          className="rounded-md px-2.5 py-1 text-xs text-txt-dim transition-colors hover:bg-default"
          data-testid="confirm-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          ref={confirmRef}
          className="rounded-md bg-danger px-2.5 py-1 text-xs text-danger-foreground transition-colors hover:bg-danger/90"
          data-testid="confirm-accept"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
