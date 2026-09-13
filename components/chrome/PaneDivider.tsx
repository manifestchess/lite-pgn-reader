/**
 * Drag divider between panes: a slim strip that highlights on hover, drags
 * with col-resize, and resets to the default width on double-click.
 * Window-level listeners for the drag so fast pointers never escape the
 * handle.
 */

import { useCallback } from "react";

import { useLayoutStore } from "../../store/layout-store";

export function PaneDivider({
  side,
}: {
  side: "left" | "right";
}): React.ReactElement {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const st = useLayoutStore.getState();
      const startX = e.clientX;
      const startWidth = side === "left" ? st.leftWidth : st.rightWidth;
      st.setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX;
        const s = useLayoutStore.getState();
        if (side === "left") s.setLeftWidth(startWidth + dx);
        else s.setRightWidth(startWidth - dx);
      };
      const onUp = (): void => {
        useLayoutStore.getState().setResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [side],
  );

  const onDoubleClick = useCallback(() => {
    const st = useLayoutStore.getState();
    if (side === "left") st.resetLeft();
    else st.resetRight();
  }, [side]);

  return (
    <div
      aria-orientation="vertical"
      className="relative z-10 w-1 shrink-0 cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-primary/25 active:bg-primary/25"
      data-testid={`pane-divider-${side}`}
      role="separator"
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
    />
  );
}
