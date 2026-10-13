"use client";

// Per-page typography (the page `⋯` menu: font, Small text, Full width). Each page
// starts from the user's defaults (Settings → Preferences) and can override them;
// overrides live in this browser's storage, keyed by page id.
import { useCallback, useEffect, useState } from "react";
import { usePreferences } from "@/app/providers";
import type { PageFont } from "./preferences";

export interface PageStyle {
  font: PageFont;
  smallText: boolean;
  fullWidth: boolean;
}

const key = (id: string) => `sb-page-style:${id}`;

export function usePageStyle(pageId: string) {
  const { preferences } = usePreferences();
  const defaults: PageStyle = {
    font: preferences.pageFont,
    smallText: preferences.smallText,
    fullWidth: preferences.fullWidth,
  };
  const [override, setOverride] = useState<Partial<PageStyle>>({});

  useEffect(() => {
    try {
      setOverride(JSON.parse(localStorage.getItem(key(pageId)) ?? "{}") ?? {});
    } catch {
      setOverride({});
    }
  }, [pageId]);

  const update = useCallback(
    (patch: Partial<PageStyle>) => {
      setOverride((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(key(pageId), JSON.stringify(next));
        } catch {
          // storage unavailable: the change still applies for this visit
        }
        return next;
      });
    },
    [pageId],
  );

  return { style: { ...defaults, ...override } as PageStyle, update };
}
