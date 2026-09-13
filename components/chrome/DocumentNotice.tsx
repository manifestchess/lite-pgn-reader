/**
 * The one document notice: a single calm, dismissible bar above the board
 * that combines the soft-cap note and the read-only note into one place.
 * Plain language, a real close button.
 */

import { useEffect, useState } from "react";

import { useDocumentStore } from "../../store/document-store";

const INDEX_BUDGET_MS = 1500;

export function DocumentNotice(): React.ReactElement | null {
  const summary = useDocumentStore((s) => s.summary);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  // Re-arm when a different document lands in this window.
  useEffect(() => {
    setDismissedFor(null);
  }, [summary?.filePath]);

  if (!summary || summary.refusal) return null;
  if (dismissedFor === summary.filePath) return null;

  const parts: string[] = [];
  if (summary.readOnlyDocument) {
    parts.push(
      "This file is opened read-only. You can browse, analyze and try out " +
        "moves, but changes won't be saved to this file — use File → Save As " +
        "to keep them.",
    );
  }
  if (summary.softCapHit && summary.indexMs > INDEX_BUDGET_MS) {
    parts.push(
      `Large file (${summary.gameCount.toLocaleString()} games) — opening and saving can take a few seconds.`,
    );
  }
  if (parts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="flex w-full max-w-2xl items-start gap-2 rounded-lg border border-line bg-low/70 px-3 py-2 text-xs text-txt-dim"
      data-testid="document-notice"
      role="status"
    >
      <span className="min-w-0">{parts.join(" ")}</span>
      <button
        aria-label="Dismiss notice"
        className="ml-auto shrink-0 rounded px-1 py-0.5 text-txt-dimmer transition-colors hover:bg-low hover:text-txt"
        data-testid="document-notice-close"
        title="Dismiss"
        onClick={() => setDismissedFor(summary.filePath)}
      >
        <svg aria-hidden="true" fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="12">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
