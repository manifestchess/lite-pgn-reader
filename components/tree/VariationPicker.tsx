/**
 * Shown while Alt is held anywhere a line branches, over the wire model.
 * Selection commits on Alt release, so the whole interaction is one keypress
 * rather than an open-then-choose dialog.
 *
 * Two questions deserve the same key, and which one you mean is decided by
 * where the branch is. Standing just before a fork, "which way from here"
 * is the choice, so the options are this move's continuations. Standing ON
 * one branch of a fork, the choice is "what else could I have played", so
 * the options are its siblings.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { WireNode } from "../../electron/wire";
import { nodeById, parentId, useDocumentStore } from "../../store/document-store";
import { withMoveSound } from "../../lib/sound/play-sound";
import { pathStep as stepOf } from "../../lib/shared/path";



export function VariationPicker(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const game = useDocumentStore((s) => s.game);
  const currentId = useDocumentStore((s) => s.currentId);
  const navigateTo = useDocumentStore((s) => s.navigateTo);

  const currentNode = game && currentId !== "" ? nodeById(game, currentId) : null;
  const forward: WireNode[] = currentId === "" ? (game?.children ?? []) : (currentNode?.children ?? []);

  const pid = currentId === "" ? null : parentId(currentId);
  const siblings: WireNode[] =
    pid === null
      ? []
      : pid === ""
        ? (game?.children ?? [])
        : (game ? (nodeById(game, pid)?.children ?? []) : []);

  const showingForward = forward.length > 1;
  const children = showingForward ? forward : siblings;
  // Where the listed moves hang from, so a selection is basePath + index.
  const basePath = showingForward ? currentId : (pid ?? "");
  const hasVariations = children.length > 1;
  // The move already on the board, so releasing Alt without moving the
  // highlight is a no-op rather than a jump to the mainline.
  const currentIdx = showingForward
    ? 0
    : currentId.length >= 2
      ? parseInt(currentId.slice(-2), 36)
      : 0;

  const handleSelect = useCallback(
    (idx: number) => {
      withMoveSound(() => navigateTo(basePath + stepOf(idx)));
      setOpen(false);
    },
    [basePath, navigateTo],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;

      if (e.key === "Alt" && hasVariations && !open) {
        e.preventDefault();
        setSelectedIdx(currentIdx);
        setOpen(true);
        return;
      }

      if (!open) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIdx((i) => Math.min(i + 1, children.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          setSelectedIdx((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          e.stopPropagation();
          handleSelect(selectedIdx);
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    }

    function handleKeyUp(e: KeyboardEvent): void {
      if (e.key === "Alt" && open) {
        handleSelect(selectedIdx);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [open, hasVariations, children.length, selectedIdx, currentIdx, handleSelect]);

  useEffect(() => {
    setOpen(false);
  }, [currentId]);

  if (!open || children.length === 0) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <button
        aria-label="Close variation picker"
        className="absolute inset-0 cursor-default border-none bg-black/30"
        onClick={() => setOpen(false)}
      />

      <div className="relative z-10 min-w-[200px] max-w-[320px] overflow-hidden rounded-lg border border-line bg-box py-1 shadow-xl">
        <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-txt-dimmer">
          Choose a line
        </div>
        {children.map((child, idx) => {
          const isMainline = idx === 0;
          const isSelected = idx === selectedIdx;
          return (
            <button
              key={child.id}
              className={`flex w-full cursor-pointer items-center gap-2 border-none px-3 py-2 text-left text-sm transition-colors ${
                isSelected ? "chip-active" : "bg-transparent text-txt-clear hover:bg-low/50"
              }`}
              data-testid={`variation-pick-${idx}`}
              onClick={() => handleSelect(idx)}
            >
              <span className="font-chess font-semibold">{child.text}</span>
              {isMainline && (
                <span className="ml-auto text-[10px] text-txt-dimmer">main line</span>
              )}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
