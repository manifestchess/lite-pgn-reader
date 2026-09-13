/**
 * Right-click menu for a move. The edit surface: comment, annotate, promote,
 * delete, copy game PGN. Read-only games keep the menu but disable every
 * edit item with a calm note rather than hiding them.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export const CONTEXT_MENU_ACTION = {
  COMMENT: "comment",
  ANNOTATE: "annotate",
  PROMOTE: "promote",
  COPY_PGN: "copy-pgn",
  DELETE: "delete",
} as const;
export type ContextMenuAction =
  (typeof CONTEXT_MENU_ACTION)[keyof typeof CONTEXT_MENU_ACTION];

interface MoveContextMenuProps {
  x: number;
  y: number;
  isMainline: boolean;
  readOnly: boolean;
  onAction: (action: ContextMenuAction) => void;
  onClose: () => void;
  onDeleteHover?: (hovering: boolean) => void;
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl+";

interface MenuItem {
  action: ContextMenuAction;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
}

export function MoveContextMenu({
  x,
  y,
  isMainline,
  readOnly,
  onAction,
  onClose,
  onDeleteHover,
}: MoveContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  // Clamped to the viewport, or a right-click near an edge opens the menu
  // partly offscreen.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, []);

  const items: MenuItem[] = [];

  if (!isMainline) {
    items.push({
      action: CONTEXT_MENU_ACTION.PROMOTE,
      label: "Promote variation",
      shortcut: `${modKey}P`,
      disabled: readOnly,
    });
  }
  items.push({
    action: CONTEXT_MENU_ACTION.COMMENT,
    label: "Comment",
    shortcut: `${modKey}K`,
    disabled: readOnly,
  });
  items.push({
    action: CONTEXT_MENU_ACTION.ANNOTATE,
    label: "Annotate",
    shortcut: `${modKey}I`,
    disabled: readOnly,
  });
  items.push({
    action: CONTEXT_MENU_ACTION.COPY_PGN,
    label: "Copy game PGN",
    shortcut: isMac ? "⇧⌘C" : "Ctrl+Shift+C",
  });
  items.push({
    action: CONTEXT_MENU_ACTION.DELETE,
    label: "Delete from here",
    shortcut: `${modKey}D`,
    danger: true,
    disabled: readOnly,
  });

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[220px] overflow-hidden rounded-lg border border-transp bg-overlay py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          // Keyed by action rather than label so a test names what it does,
          // not what it currently says.
          data-testid={`move-menu-${item.action}`}
          aria-disabled={item.disabled || undefined}
          className={`flex w-full cursor-pointer items-center gap-2.5 border-none bg-transparent px-3 py-1.5 text-left text-sm transition-colors duration-75 ${
            item.disabled
              ? "cursor-default text-txt-dimmer"
              : item.danger
                ? "text-danger hover:bg-danger/10"
                : "text-txt hover:bg-default"
          }`}
          onClick={item.disabled ? undefined : () => onAction(item.action)}
          onMouseEnter={
            item.action === CONTEXT_MENU_ACTION.DELETE && !item.disabled && onDeleteHover
              ? () => onDeleteHover(true)
              : undefined
          }
          onMouseLeave={
            item.action === CONTEXT_MENU_ACTION.DELETE && !item.disabled && onDeleteHover
              ? () => onDeleteHover(false)
              : undefined
          }
        >
          <span className="flex-1">{item.label}</span>
          {item.shortcut && (
            <span className="ml-4 text-[11px] text-txt-dimmer">{item.shortcut}</span>
          )}
        </button>
      ))}
      {readOnly && (
        <div className="border-t border-transp px-3 py-1.5 text-[11px] text-txt-dimmer">
          This game is read-only, so editing is off.
        </div>
      )}
    </div>,
    document.body,
  );
}
