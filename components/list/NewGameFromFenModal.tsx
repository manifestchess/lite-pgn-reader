/**
 * "New game from position" — enter a FEN, validated live by chessops, and
 * create a game seated at that position (SetUp+FEN tags). For studying a
 * position or entering a game that does not start from the initial array.
 */

import { useState } from "react";
import { Modal } from "@heroui/react";
import { parseFen } from "chessops/fen";

import { useDocumentStore } from "../../store/document-store";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function NewGameFromFenModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement {
  const newGameFromFen = useDocumentStore((s) => s.newGameFromFen);
  const [fen, setFen] = useState(START_FEN);

  const trimmed = fen.trim();
  const parsed = parseFen(trimmed);
  const valid = trimmed.length > 0 && parsed.isOk;
  const error = trimmed.length === 0 ? null : parsed.isOk ? null : "Not a legal FEN.";

  const create = (): void => {
    if (!valid) return;
    void newGameFromFen(trimmed);
    onClose();
  };

  return (
    <Modal isOpen={open} onOpenChange={(o) => !o && onClose()}>
      <Modal.Backdrop isDismissable>
        <Modal.Container>
          <Modal.Dialog
            aria-label="New game from position"
            className="no-drag w-[min(34rem,100vw-2rem)] p-5"
          >
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-txt-clear">New game from position</h2>
              <p className="text-xs text-txt-dimmer">
                Paste a FEN. The game will start from that position.
              </p>
              <textarea
                autoFocus
                className="h-16 w-full resize-none rounded-md border border-transp bg-page px-2 py-1.5 font-mono text-xs text-txt-clear outline-none focus:border-primary/50"
                data-testid="fen-input"
                spellCheck={false}
                value={fen}
                onChange={(e) => setFen(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) create();
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-danger" data-testid="fen-error">
                  {error ?? ""}
                </span>
                <div className="flex gap-2">
                  <button
                    className="cursor-pointer rounded-lg border border-line bg-transparent px-4 py-1.5 text-xs text-txt-dim transition-colors hover:bg-low hover:text-txt-clear"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                  <button
                    className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${
                      valid
                        ? "cursor-pointer bg-primary text-page hover:opacity-90"
                        : "cursor-default bg-low text-txt-dimmer"
                    }`}
                    data-testid="fen-create"
                    disabled={!valid}
                    onClick={create}
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
