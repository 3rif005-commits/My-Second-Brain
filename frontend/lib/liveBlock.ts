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

/** How tall the block's content is. Not documentElement.scrollHeight: that never drops below
 *  the frame's own height, so a short diagram kept the 300 px the frame starts at. The lowest
 *  edge of the body's children (absolutely positioned or full-height content too) with their
 *  bottom margins, plus the body's own bottom padding and margin, or the body's height.
 *  The same answer whatever the frame's size, so the frame settles instead of oscillating. */
export const CONTENT_HEIGHT_JS = `function contentHeight(b,scrollY,css){if(!b)return 0;` +
  `var px=function(el,p){return parseFloat(css(el)[p])||0};` +
  `var h=b.scrollHeight,low=0;for(var i=0;i<b.children.length;i++){var c=b.children[i];` +
  `if(c.tagName==="SCRIPT"||c.tagName==="STYLE")continue;` +
  `low=Math.max(low,c.getBoundingClientRect().bottom+(scrollY||0)+px(c,"marginBottom"));}` +
  `return Math.max(h,low+px(b,"paddingBottom")+px(b,"marginBottom"));}`;

// While the content fits the tallest frame, the frame shows no scrollbar of its own: a 1–2px
// overflow otherwise brought one in, which narrowed the content, made it taller, and kept it.
const HEIGHT_SCRIPT = `<script>(function(){${CONTENT_HEIGHT_JS}function s(){` +
  `var h=contentHeight(document.body,window.scrollY,getComputedStyle);` +
  `document.documentElement.style.overflowY=h<=${MAX_FRAME_HEIGHT}?"hidden":"auto";` +
  `parent.postMessage({"${MESSAGE_KEY}":h},"*");}` +
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
  // An untitled block says nothing about a title rather than send an empty one.
  const head = title.trim() ? `Title: "${title.trim()}"\n\n` : "";
  if (!currentCode || !currentCode.trim()) return `${head}${ask}`;
  return `${head}This is the block's current code:\n\n\`\`\`html\n${currentCode}\n\`\`\`\n\n` +
    `Change it as follows, keeping everything else the same, and return the complete updated ` +
    `document:\n${ask}`;
}

/** The model's reply without the code fences it sometimes wraps HTML in. */
export function stripFences(text: string): string {
  const fenced = text.match(/```[a-z0-9-]*\s*\n([\s\S]*?)\n?```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** The page the slash menu used to insert ("⚡ Interactive Block — switch to AI…"). Notes
 *  saved with it still hold it; it counts as empty like the one above. */
export const LEGACY_SLASH_PLACEHOLDER_HTML = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
  height:100vh;background:#f8fafc;color:#64748b;font-size:14px;text-align:center;padding:24px}
</style>
<div>
  <div style="font-size:32px;margin-bottom:12px">⚡</div>
  <strong style="color:#6366f1">Interactive Block</strong><br/>
  Switch to <strong>AI</strong> to generate content, or <strong>Code</strong> to paste your own HTML.
</div>`;

/** True for a block nobody has filled yet: no code, or one of the placeholder pages blocks
 *  used to be created with. Such a block shows the "Ask AI to build something" row. */
export function isPlaceholderHtml(html: string): boolean {
  const h = html.trim();
  return !h || h === DEFAULT_INTERACTIVE_HTML.trim() || h === LEGACY_SLASH_PLACEHOLDER_HTML.trim();
}

/** The first image in a paste/drop, if any (a photo of a diagram for the AI). */
export function imageFromTransfer(dt: DataTransfer | null | undefined): File | null {
  if (!dt) return null;
  for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/** A diagram photo → Mermaid source, via the note's vision model. Throws a readable Error. */
export async function diagramFromImage(noteId: string, image: File): Promise<string> {
  const body = new FormData();
  body.append("file", image, image.name || "diagram.png");
  const res = await fetch(`/api/ws/notes/${encodeURIComponent(noteId)}/diagram-from-image`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data?.detail?.error ?? data?.error ?? `HTTP ${res.status}`) as string;
    throw new Error(msg);
  }
  if (typeof data?.code !== "string" || !data.code.trim()) throw new Error("No diagram came back.");
  return data.code;
}

/** True when the model's reply is something a block can show: Mermaid source, a model link,
 *  or HTML. Anything else is the model talking ("I can't make that from your notes…"): it is
 *  shown to the user as a message and must never replace the block's code. */
export function isBlockCode(reply: string, kind: "mermaid" | "model" | "html"): boolean {
  const r = reply.trim();
  if (!r) return false;
  if (kind !== "html") return true;
  return /<\s*(?:!doctype|html|head|body|style|script|div|section|main|canvas|svg|button|input|form|table|p|h[1-6]|ul|ol|span|label|select|textarea|img|figure|details)\b/i.test(r);
}
