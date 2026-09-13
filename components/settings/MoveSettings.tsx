/**
 * Move input settings: input mode, move hints, ghost piece, last-move
 * highlight.
 */

import { ToggleSetting } from "./ToggleSetting";

import {
  useBoardPreferencesStore,
  type MoveInput,
} from "../../store/board-preferences-store";

const MOVE_INPUT_OPTIONS: { key: MoveInput; label: string; desc: string }[] = [
  { key: "both", label: "Both", desc: "Drag or click" },
  { key: "drag", label: "Drag", desc: "Drag pieces only" },
  { key: "click", label: "Click", desc: "Click two squares" },
];

export function MoveSettings(): React.ReactElement {
  const moveInput = useBoardPreferencesStore((s) => s.moveInput);
  const showMoveHints = useBoardPreferencesStore((s) => s.showMoveHints);
  const showGhostPiece = useBoardPreferencesStore((s) => s.showGhostPiece);
  const highlightLastMove = useBoardPreferencesStore((s) => s.highlightLastMove);
  const setMoveInput = useBoardPreferencesStore((s) => s.setMoveInput);
  const setShowMoveHints = useBoardPreferencesStore((s) => s.setShowMoveHints);
  const setShowGhostPiece = useBoardPreferencesStore((s) => s.setShowGhostPiece);
  const setHighlightLastMove = useBoardPreferencesStore(
    (s) => s.setHighlightLastMove,
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-txt-clear">Move input</h3>
          <p className="mt-0.5 text-xs text-txt-dimmer">
            How pieces are moved on the board.
          </p>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {MOVE_INPUT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              aria-pressed={moveInput === opt.key}
              className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[11px] transition-all duration-150 ${
                moveInput === opt.key
                  ? "chip-active ring-1 ring-primary"
                  : "bg-low/50 text-txt-dim ring-1 ring-line hover:text-txt hover:ring-txt-dim"
              }`}
              onClick={() => setMoveInput(opt.key)}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-[9px]">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <ToggleSetting
        description="Dots on the squares a selected piece can reach."
        label="Move hints"
        value={showMoveHints}
        onChange={setShowMoveHints}
      />
      <ToggleSetting
        description="A faint copy of the piece stays on its square while dragging."
        label="Ghost piece"
        value={showGhostPiece}
        onChange={setShowGhostPiece}
      />
      <ToggleSetting
        description="Shade the from and to squares of the last move."
        label="Highlight last move"
        value={highlightLastMove}
        onChange={setHighlightLastMove}
      />
    </div>
  );
}
