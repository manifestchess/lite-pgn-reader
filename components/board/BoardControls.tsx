/**
 * The strip under the board: navigation, flip, copy PGN, export game,
 * comment, tags, settings. Export and copy use the exact bytes the document
 * would save for this game (api().docGameText), not a re-serialization.
 */

import { useCallback } from "react";

import { copyGamePgn } from "../../lib/renderer/edits";
import { exportCurrentGame } from "../../lib/renderer/export";
import { useDocumentStore } from "../../store/document-store";
import { useMoveTreeUIStore } from "../../store/move-tree-ui-store";
import { useSettingsModalStore } from "../../store/settings-modal-store";
import { useTagEditorStore } from "../../store/tag-editor-store";
import { useToastStore } from "../../store/toast-store";
import { withMoveSound } from "../../lib/sound/play-sound";

function Icon({ d }: { d: string }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d={d} />
    </svg>
  );
}

const BTN =
  "no-drag flex items-center justify-center w-8 h-7 rounded bg-transparent text-txt-dim border-none cursor-pointer transition-colors duration-100 hover:bg-low hover:text-txt-clear active:bg-primary/15 active:text-primary-ink disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-txt-dim";

export function BoardControls(): React.ReactElement {
  const game = useDocumentStore((s) => s.game);
  const toggleOrientation = useDocumentStore((s) => s.toggleOrientation);
  const openSettings = useSettingsModalStore((s) => s.open);
  const settingsOpen = useSettingsModalStore((s) => s.isOpen);
  const openTags = useTagEditorStore((s) => s.open);
  const showToast = useToastStore((s) => s.show);

  const copyPgn = useCallback(async () => {
    if (!useDocumentStore.getState().game) return;
    try {
      await copyGamePgn();
    } catch {
      showToast("Could not copy the PGN");
    }
  }, [showToast]);

  const exportGame = useCallback(() => exportCurrentGame(), []);

  const nav = useCallback((action: "start" | "back" | "forward" | "end") => {
    const st = useDocumentStore.getState();

    withMoveSound(() => {
      if (action === "start") st.goStart();
      else if (action === "back") st.goBack();
      else if (action === "forward") st.goForward();
      else st.goEnd();
    });
  }, []);

  return (
    <div
      aria-label="Board controls"
      className="no-drag flex shrink-0 items-center justify-center gap-0.5"
      role="toolbar"
    >
      <button
        aria-label="Go to start"
        className={BTN}
        title="Go to start"
        onClick={() => nav("start")}
      >
        <Icon d="M19 5l-7 7 7 7M12 5l-7 7 7 7" />
      </button>
      <button
        aria-label="Back one move"
        className={BTN}
        title="Back"
        onClick={() => nav("back")}
      >
        <Icon d="M15 5l-7 7 7 7" />
      </button>
      <button
        aria-label="Forward one move"
        className={BTN}
        title="Forward"
        onClick={() => nav("forward")}
      >
        <Icon d="M9 5l7 7-7 7" />
      </button>
      <button
        aria-label="Go to end"
        className={BTN}
        title="Go to end"
        onClick={() => nav("end")}
      >
        <Icon d="M5 5l7 7-7 7M12 5l7 7-7 7" />
      </button>
      <div aria-hidden className="mx-1 h-4 w-px bg-line/50" />
      <button
        aria-label="Flip board"
        className={BTN}
        data-testid="flip-board"
        title="Flip board (f)"
        onClick={toggleOrientation}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="M7.5 7.5L12 3l4.5 4.5" />
          <path d="M16.5 16.5L12 21l-4.5-4.5" />
          <line x1="12" x2="12" y1="3" y2="21" />
        </svg>
      </button>
      <button
        aria-label="Copy game PGN"
        className={BTN}
        data-testid="copy-pgn"
        disabled={!game}
        title="Copy PGN"
        onClick={() => void copyPgn()}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
          width="18"
        >
          <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button
        aria-label="Export game to a file"
        className={BTN}
        data-testid="export-pgn"
        disabled={!game}
        title="Export game"
        onClick={() => void exportGame()}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      </button>
      <button
        aria-label="Edit comment on the current move"
        className={BTN}
        disabled={!game || game.readOnly}
        title={
          game?.readOnly
            ? "This game could not be fully read, so editing is off to protect it"
            : "Comment"
        }
        onClick={() => useMoveTreeUIStore.getState().requestComment()}
      >
        <Icon d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </button>
      <button
        aria-label="View and edit game tags"
        className={BTN}
        data-testid="open-tag-editor"
        disabled={!game}
        title="Tags"
        onClick={openTags}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
          width="18"
        >
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" x2="7.01" y1="7" y2="7" />
        </svg>
      </button>
      <button
        aria-label="Open settings"
        className={`${BTN} ${settingsOpen ? "!bg-primary/15 !text-primary-ink" : ""}`}
        data-testid="open-settings"
        title="Settings (`)"
        onClick={() => openSettings()}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
          width="18"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}
