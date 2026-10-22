// The live (interactive) block's small runtime pieces (ArtCraft study item 6).
//
// The block runs in `<iframe sandbox="allow-scripts">` — no same-origin, so the parent can't
// read its size. A few lines injected into the document report it instead, and the parent
// accepts a height only from that exact frame's window.

import { useEffect, useState, type RefObject } from "react";

export const DEFAULT_INTERACTIVE_HTML = `<div style="font-family:sans-serif;padding:16px">
  <strong style="color:#6366f1">Interactive Block</strong><br/>
  <p>Edit the code, or ask the AI to build something here.</p>
</div>`;

export const MIN_FRAME_HEIGHT = 80;
export const MAX_FRAME_HEIGHT = 900;
const MESSAGE_KEY = "sb-live-height";

const HEIGHT_SCRIPT = `<script>(function(){function s(){var d=document.documentElement,b=document.body;` +
  `var h=Math.max(d.scrollHeight,b?b.scrollHeight:0);parent.postMessage({"${MESSAGE_KEY}":h},"*");}` +
  `if(window.ResizeObserver){new ResizeObserver(s).observe(document.documentElement);}` +
  `window.addEventListener("load",s);setTimeout(s,50);setTimeout(s,600);})();</script>`;

/** The block's HTML with the height reporter added (before `</body>` when there is one). */
export function withAutoHeight(html: string): string {
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + HEIGHT_SCRIPT + html.slice(i) : html + HEIGHT_SCRIPT;
}

/** A reported height from `data`, clamped, or null when the message isn't one. */
export function heightFromMessage(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const h = (data as Record<string, unknown>)[MESSAGE_KEY];
  if (typeof h !== "number" || !Number.isFinite(h)) return null;
  return Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(h)));
}

/** Height state for one live frame: starts at `initial`, follows what the frame reports. */
export function useFrameHeight(frame: RefObject<HTMLIFrameElement | null>, initial = 300): number {
  const [height, setHeight] = useState(initial);
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const h = heightFromMessage(e.data);
      if (h !== null) setHeight(h);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);
  return height;
}

/** What the AI is asked. A block that already has code is EDITED, not rewritten from zero. */
export function liveBlockRequest(title: string, prompt: string, currentCode: string | null): string {
  const ask = prompt.trim();
  if (!currentCode || !currentCode.trim()) return `Title: "${title}"\n\n${ask}`;
  return `Title: "${title}"\n\nThis is the block's current code:\n\n\`\`\`html\n${currentCode}\n\`\`\`\n\n` +
    `Change it as follows, keeping everything else the same, and return the complete updated ` +
    `document:\n${ask}`;
}

/** The model's reply without the code fences it sometimes wraps HTML in. */
export function stripFences(text: string): string {
  const fenced = text.match(/```(?:html)?\s*\n([\s\S]*?)\n?```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** True for a block nobody has filled yet (the placeholder it is created with). */
export function isPlaceholderHtml(html: string): boolean {
  return !html.trim() || html.trim() === DEFAULT_INTERACTIVE_HTML.trim();
}
