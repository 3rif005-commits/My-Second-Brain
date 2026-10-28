"use client";

// The hover card's block renderer, loaded only when a card actually opens.
//
// Two reasons this indirection exists rather than importing BlockPreviewBody
// directly: BlockNote touches `window` at module scope, so it can't be
// server-rendered; and the chat panel that hosts the citation links should
// not carry the whole editor bundle for a card most messages never open. The
// import below is a real dynamic import (a separate chunk) — the
// `dynamic(() => Promise.resolve(Inner))` shape used elsewhere in this repo
// gets the ssr:false part right but splits nothing.

import dynamic from "next/dynamic";

/** Pull the chunk in during idle time, so the first hover renders the block
 *  instead of a loading skeleton. Called when a citation link mounts: by then
 *  we know this page has something worth previewing, which is the whole
 *  reason the chunk is split out rather than bundled with the chat. Runs at
 *  most once per page. */
let preloaded = false;
export function preloadBlockPreview() {
  if (preloaded || typeof window === "undefined") return;
  preloaded = true;
  const load = () => void import("./BlockPreviewBody");
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void) => void;
  }).requestIdleCallback;
  // Safari still has no requestIdleCallback; a delayed timeout is close
  // enough for a preload that nothing waits on.
  if (idle) idle(load);
  else window.setTimeout(load, 1000);
}

export const BlockPreview = dynamic(
  () => import("./BlockPreviewBody").then((m) => m.BlockPreviewBody),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-1.5" aria-hidden>
        <div className="h-3 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    ),
  }
);
