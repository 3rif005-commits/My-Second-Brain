"use client";

// The shared modal frame: Notion's dim backdrop (no blur), a card with radius 12px and
// the modal shadow, Esc and backdrop-click to close, focus moved into the card.
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name (or pass labelledBy). */
  label?: string;
  labelledBy?: string;
  children: ReactNode;
  /** Card classes: width, height, padding. */
  className?: string;
  /** Close on backdrop click (default true). */
  dismissable?: boolean;
}

export function Modal({ open, onClose, label, labelledBy, children, className, dismissable = true }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    // Focus the first focusable element (or the card) so keyboard users land inside.
    const first = cardRef.current?.querySelector<HTMLElement>("[autofocus], input, button, [tabindex]:not([tabindex='-1'])");
    (first ?? cardRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface-backdrop px-4"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx("relative rounded-modal bg-surface-panel text-ink shadow-modal outline-none", className)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
