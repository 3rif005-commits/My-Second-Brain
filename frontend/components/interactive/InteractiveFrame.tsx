"use client";

// A live block shown read-only (in a chat answer): the same rounded frame and caption as the
// note's live block (InteractiveBlockCard, app/liveBlock.css), without the editing pill.

import { useMemo, useRef } from "react";
import { useFrameHeight } from "@/lib/liveBlock";
import { assetOrigin, buildSrcDoc } from "@/lib/liveRuntime";

interface Props {
  title?: string;
  html: string;
  height?: number;
}

export function InteractiveFrame({ title = "Interactive", html, height = 300 }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameHeight = useFrameHeight(frameRef, height);
  const srcDoc = useMemo(() => buildSrcDoc(html, { assetOrigin: assetOrigin() }), [html]);
  return (
    <div className="sb-live my-2">
      <div className="sb-live-frame">
        <iframe
          ref={frameRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          style={{ height: frameHeight }}
          aria-label={title}
        />
      </div>
      {title ? <div className="sb-live-caption">{title}</div> : null}
    </div>
  );
}
