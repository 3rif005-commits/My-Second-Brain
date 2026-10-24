"use client";

// A live block shown read-only (in a chat answer): the same box and caption as the note's
// live block (InteractiveBlockCard, app/liveBlock.css), the result only, without the pill.

import { useMemo, useRef } from "react";
import { useFrameHeight } from "@/lib/liveBlock";
import { assetOrigin, buildSrcDoc } from "@/lib/liveRuntime";
import { useTheme } from "@/app/providers";

interface Props {
  title?: string;
  html: string;
  height?: number;
}

export function InteractiveFrame({ title = "Interactive", html, height = 300 }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameHeight = useFrameHeight(frameRef, height);
  const srcDoc = useMemo(() => buildSrcDoc(html, { assetOrigin: assetOrigin(), theme }), [html, theme]);
  return (
    <div className="sb-live sb-live-static my-2" data-view="preview">
      <div className="sb-live-box">
        <div className="sb-live-preview">
          <iframe
            ref={frameRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            style={{ height: frameHeight, colorScheme: theme }}
            aria-label={title}
          />
        </div>
      </div>
      {title ? <div className="sb-live-caption">{title}</div> : null}
    </div>
  );
}
