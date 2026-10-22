"use client";

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
    <div className="my-4 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-accent-600 text-white text-xs font-semibold">
        <span>⚡</span><span>{title}</span>
      </div>
      <iframe
        ref={frameRef}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="w-full border-none block bg-white dark:bg-gray-900"
        style={{ height: frameHeight }}
        title={title}
      />
    </div>
  );
}
