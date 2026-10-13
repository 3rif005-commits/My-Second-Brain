"use client";

// In-page replacement for window.prompt(). Native dialogs block the tab
// (including in browser automation) — this renders via a portal instead,
// same visual language as ConfirmDialog / the note delete confirmation.
import { useEffect, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { Modal } from "./Modal";

export interface PromptDialogProps {
  open: boolean;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open, title, label, placeholder, defaultValue = "",
  confirmLabel = "OK", cancelLabel = "Cancel", onSubmit, onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  function submit() {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <Modal open={open} onClose={onCancel} labelledBy="prompt-dialog-title" className="w-[406px] max-w-full p-5">
      <h2 id="prompt-dialog-title" className="mb-3 text-base font-semibold leading-6 text-ink">
        {title}
      </h2>
      {label && <label className="mb-1 block text-xs text-ink-secondary">{label}</label>}
      <Input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="primary" onClick={submit} disabled={!value.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
