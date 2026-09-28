"use client";

import { useEffect, useState } from "react";
import { JOBS_CHANGED, getBadge } from "@/lib/backgroundJobs";

export const BADGE_POLL_MS = 45_000;

/** How many background results and problems are waiting — the sidebar's dot.
 *  Quiet on failure: a badge that cannot be fetched is simply not shown. */
export function useJobBadge(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () => getBadge()
      .then((b) => { if (live) setCount(b.ready + b.needs_you); })
      .catch(() => {});
    void load();
    const t = setInterval(load, BADGE_POLL_MS);
    window.addEventListener(JOBS_CHANGED, load);
    return () => { live = false; clearInterval(t); window.removeEventListener(JOBS_CHANGED, load); };
  }, []);
  return count;
}
