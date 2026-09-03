"use client";

// The empty state's "Import" button used to be a <Link href="/brain/ingest">, but
// that page is now just `redirect("/brain")` — so clicking Import navigated to a
// route that bounced straight back to where you already were, and the button read
// as broken.
//
// Importing itself is NOT gone: dropping a file anywhere in the app still streams
// it through POST /api/agent/ingest via IngestStreamDialog. Only the dedicated
// page went away. So this button opens a file picker and hands the file to that
// same dialog, which is what the dead link was trying to reach in the first place.
//
// It talks to BrainLayoutClient (which owns the dialog's state) through a window
// event rather than a prop or a context: the empty state is a server component
// several levels below that layout, and the layout already listens for
// document-level drop events to start exactly this flow.

import { useRef, type ChangeEvent, type ReactNode } from "react";
import { ACCEPTED_INGEST_TYPES } from "./IngestDropzone";

/** Detail is the picked File. BrainLayoutClient listens for this on `window`. */
export const INGEST_FILE_EVENT = "secondbrain:ingest-file";

export function ImportFileButton({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice in a row still fires onChange.
    e.target.value = "";
    if (!file) return;
    window.dispatchEvent(new CustomEvent<File>(INGEST_FILE_EVENT, { detail: file }));
  }

  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_INGEST_TYPES}
        onChange={handleChange}
        className="hidden"
        aria-label="Import a document"
      />
    </>
  );
}
