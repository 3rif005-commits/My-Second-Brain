"use client";

// In-page replacement for window.confirm(). Notion's confirm dialog: 406px card,
// 20px padding, centred 16px/600 message, full-width stacked 32px buttons 8px apart,
// the destructive one outlined in red (database-table.md §12, checklist #215-216).
import { Button } from "./button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel",
  danger = true, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-dialog-title" className="w-[406px] max-w-full p-5 text-center">
      <h2 id="confirm-dialog-title" className="text-base font-semibold leading-6 text-ink">
        {title}
      </h2>
      {description && <p className="mt-1.5 text-sm leading-5 text-ink-secondary">{description}</p>}
      <div className="mt-4 flex flex-col gap-2">
        <Button variant={danger ? "danger" : "primary"} size="md" block onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="md" block onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </Modal>
  );
}
