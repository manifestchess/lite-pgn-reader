/**
 * Small confirm dialog. Takes an optional inline SVG node for its accent
 * icon, since the app ships no icon registry.
 */

import { Button, Modal } from "@heroui/react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  /** Defaults to "Delete", the verb almost every caller wants. */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Inline icon for the accent tile, which gives the dialog an identity
   *  beyond a plain title. */
  icon?: React.ReactNode;
  /** Tints the icon tile. Defaults to `danger` for the typical delete-confirm. */
  iconTone?: "danger" | "warning" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_TILE: Record<NonNullable<ConfirmDialogProps["iconTone"]>, string> = {
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  primary: "bg-primary/15 text-primary-ink",
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  icon,
  iconTone = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <div className="flex flex-col gap-3 px-5 pb-4 pt-5">
              {icon && (
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${TONE_TILE[iconTone]}`}
                >
                  {icon}
                </div>
              )}
              <h2 className="text-[16px] font-semibold leading-tight text-txt-clear">
                {title}
              </h2>
              <p className="whitespace-pre-line text-[13px] leading-snug text-txt-dim">
                {message}
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-low/40 px-5 py-3">
              <Button
                data-testid="confirm-cancel"
                size="sm"
                variant="ghost"
                onPress={onCancel}
              >
                {cancelLabel ?? "Cancel"}
              </Button>
              <Button
                data-testid="confirm-accept"
                size="sm"
                variant="danger"
                onPress={onConfirm}
              >
                {confirmLabel ?? "Delete"}
              </Button>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
