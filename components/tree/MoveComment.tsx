/**
 * Comment display. The wire model already strips well-formed [%...] commands
 * into WireComment.displayText, so a [%clk]-only comment renders as nothing
 * here and, via hasVisibleComment, never fragments the two-column layout.
 */

import type { WireComment } from "../../electron/wire";

/**
 * Whether these comments would render as anything a reader can see. The
 * move tree needs this BEFORE laying out a row, since a visible comment
 * forces a full-width interrupt that breaks the white/black pair.
 */
export function hasVisibleComment(comments: WireComment[]): boolean {
  return comments.some((c) => c.displayText.length > 0);
}

export function commentText(comments: WireComment[]): string {
  return comments
    .map((c) => c.displayText)
    .filter((t) => t.length > 0)
    .join(" ");
}

interface MoveCommentProps {
  comments: WireComment[];
  /** "interrupt" for mainline rows, "variation" for inline comments. */
  variant?: "interrupt" | "variation";
}

export function MoveComment({
  comments,
  variant = "interrupt",
}: MoveCommentProps): React.ReactElement | null {
  const text = commentText(comments);
  if (text.length === 0) return null;

  if (variant === "variation") {
    return (
      <span className="mx-1 inline break-words text-xs text-primary-ink">{text}</span>
    );
  }

  return (
    <span className="block break-words border-l-2 border-primary py-1 pl-2 text-[13px] text-primary-ink">
      {text}
    </span>
  );
}
