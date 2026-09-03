"use client";

// The Import button on /brain's empty state.
//
// It used to be a <Link href="/brain/ingest">, and that page is now just
// `redirect("/brain")` — the click navigated to a route that bounced straight
// back, so the button read as broken.
//
// Files belong in the workspace: that is where a PDF or a video gets extracted,
// viewed, cited and synthesised into a note. So this picks files and hands them
// to the workspace, rather than reaching for the older one-file-one-note ingest
// path that the removed page used to front.
//
// The picked files are staged in module state and this routes to
// /brain/workspace, where WorkspaceShell claims them on mount and runs its own
// addFiles — identical to picking them inside the workspace, including the busy
// state, the error toasts and the redirect into the new session. See
// stageSources in lib/workspace.ts for why the handoff cannot go through the URL.

import { useRef, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ACCEPTED_WORKSPACE_FILES, stageSources } from "@/lib/workspace";

export function ImportFileButton({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset so picking the same file twice in a row still fires onChange.
    e.target.value = "";
    if (!files.length) return;
    stageSources(files);
    router.push("/brain/workspace");
  }

  return (
    <>
      <button type="button" onClick={() => inputRef.current?.click()} className={className}>
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_WORKSPACE_FILES}
        onChange={handleChange}
        className="hidden"
        aria-label="Import files into the workspace"
      />
    </>
  );
}
