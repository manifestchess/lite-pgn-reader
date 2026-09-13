/**
 * Portal comment editor. ⌘Enter saves, Escape closes, click-away closes.
 *
 * '}' is refused at keystroke, paste and any other input path, with visible
 * feedback. A brace comment cannot contain '}', and silently stripping it
 * would corrupt the text, so the character is refused rather than stripped.
 * The main process rejects it too; if that message ever arrives (onSave
 * resolving false) the editor stays open so no text is lost.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const BLOCK_FEEDBACK_MS = 2200;

interface CommentEditorProps {
  x: number;
  y: number;
  initialComment: string;
  /** Resolves true when the edit applied; false keeps the editor open. */
  onSave: (prose: string) => Promise<boolean>;
  onClose: () => void;
}

export function CommentEditor({
  x,
  y,
  initialComment,
  onSave,
  onClose,
}: CommentEditorProps): React.ReactElement {
  const [value, setValue] = useState(initialComment);
  const [blocked, setBlocked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashBlocked = useCallback(() => {
    setBlocked(true);
    if (blockTimer.current) clearTimeout(blockTimer.current);
    blockTimer.current = setTimeout(() => setBlocked(false), BLOCK_FEEDBACK_MS);
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
    return () => {
      if (blockTimer.current) clearTimeout(blockTimer.current);
    };
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

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

  const handleSave = useCallback(() => {
    void onSave(value.trim()).then((ok) => {
      if (ok) onClose();
    });
  }, [value, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "}") {
        e.preventDefault();
        flashBlocked();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave, flashBlocked],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (e.clipboardData.getData("text").includes("}")) {
        e.preventDefault();
        flashBlocked();
      }
    },
    [flashBlocked],
  );

  // Last-resort guard for input paths keydown/paste cannot see (drag and
  // drop, IME composition): refuse the change rather than strip it.
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      if (next.includes("}")) {
        flashBlocked();
        return;
      }
      setValue(next);
    },
    [flashBlocked],
  );

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[100] w-[280px] overflow-hidden rounded-lg border border-transp bg-overlay p-2 shadow-lg"
      style={{ left: x, top: y }}
    >
      <textarea
        ref={textareaRef}
        className="input h-[80px] w-full resize-none rounded-md bg-default p-2 text-sm text-txt outline-none focus:ring-1 focus:ring-primary"
        data-testid="comment-editor-input"
        placeholder="Add a comment"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      {blocked && (
        <div className="mt-1 text-[11px] text-danger" data-testid="comment-editor-blocked" role="alert">
          A comment cannot contain &#125;
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[11px] text-txt-dimmer">
          {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}⏎ to save
        </span>
        <div className="flex gap-1.5">
          <button
            className="rounded-md px-2.5 py-1 text-xs text-txt-dim transition-colors hover:bg-default"
            data-testid="comment-editor-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button rounded-md bg-primary px-2.5 py-1 text-xs text-accent-foreground transition-colors hover:bg-primary/90"
            data-testid="comment-editor-save"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
