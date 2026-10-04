"use client";

import { useEffect, useState } from "react";

/** Where a chat turn runs. "auto" lets the backend's switchboard decide (rules,
 *  then the brain); "local" pins it to the on-device model; the rest pin a
 *  role whose model is set in Settings → Routing → Targets. */
export type Mode = "auto" | "local" | "fast" | "strong" | "vision" | "long";

export const MODES: Mode[] = ["auto", "local", "fast", "strong", "vision", "long"];

const KEY = "secondbrain:mode";

/** The request fields a mode becomes. */
export function modeRequest(mode: Mode): { mode: "auto" | "local"; slot?: string } {
  if (mode === "auto" || mode === "local") return { mode };
  return { mode: "auto", slot: mode };
}

export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>("auto");
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      // "api" was the old Cloud choice; the switchboard now picks the cloud model.
      if (v === "api") setMode("auto");
      else if (v && (MODES as string[]).includes(v)) setMode(v as Mode);
    } catch { /* storage blocked: keep the default */ }
  }, []);
  const update = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem(KEY, m); } catch { /* not remembered, still applied */ }
  };
  return [mode, update];
}
