/**
 * Right-click menu for the game list: create a game, or delete/duplicate
 * the one under the pointer. A right-click on empty list space offers only
 * "New game". Structural edits are hidden on read-only DOCUMENTS (they
 * still can't be saved, so offering them would only frustrate).
 */

import { useEffect } from "react";

import { useDocumentStore } from "../../store/document-store";

export interface ListMenuState {
  x: number;
  y: number;
  /** Game index under the pointer, or null for empty-space. */
  gameIndex: number | null;
}

export function GameListMenu({
  state,
  onClose,
  onNewFromPosition,
}: {
  state: ListMenuState;
  onClose: () => void;
  onNewFromPosition: () => void;
}): React.ReactElement | null {
  const newGame = useDocumentStore((s) => s.newGame);
  const deleteGame = useDocumentStore((s) => s.deleteGame);
  const gameCount = useDocumentStore((s) => s.summary?.gameCount ?? 0);
  const readOnly = useDocumentStore((s) => s.summary?.readOnlyDocument ?? false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClose);
    };
  }, [onClose]);

  if (readOnly) return null;

  const item = (label: string, testid: string, danger: boolean, run: () => void) => (
    <button
      className={`block w-full cursor-pointer rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-low ${
        danger ? "text-danger" : "text-txt-clear"
      }`}
      data-testid={testid}
      onClick={() => {
        run();
        onClose();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed z-50 min-w-44 rounded-md border border-line bg-box p-1 shadow-lg"
      data-testid="game-list-menu"
      style={{ top: state.y, left: state.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {item("New game", "menu-new-game", false, () =>
        void newGame(state.gameIndex ?? undefined),
      )}
      {item("New game from position…", "menu-new-from-fen", false, onNewFromPosition)}
      {state.gameIndex !== null &&
        gameCount > 1 &&
        item("Delete game", "menu-delete-game", true, () =>
          void deleteGame(state.gameIndex!),
        )}
    </div>
  );
}
