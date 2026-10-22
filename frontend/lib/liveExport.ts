// Asking a live block's sandboxed frame for its picture. The frame can't be read from outside
// (no same-origin), so it answers a message instead (see EXPORT_SCRIPT in liveRuntime.ts).

/** Largest picture kept on the block as its print/fallback image (~400 KB of data URL). */
export const MAX_SNAPSHOT_CHARS = 400_000;

export interface FrameImage { dataUrl: string; kind: "png" | "svg" }

export function exportFrameImage(frame: HTMLIFrameElement, timeoutMs = 4000): Promise<FrameImage | null> {
  return new Promise((resolve) => {
    const win = frame.contentWindow;
    if (!win) return resolve(null);
    const done = (v: FrameImage | null) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(v);
    };
    function onMessage(e: MessageEvent) {
      if (e.source !== win || !e.data || typeof e.data !== "object" || !("sb-live-image" in e.data)) return;
      const url = e.data["sb-live-image"];
      const kind = e.data["sb-live-kind"];
      const ok = typeof url === "string" && /^data:image\/(png|svg\+xml)/.test(url) && (kind === "png" || kind === "svg");
      done(ok ? { dataUrl: url, kind } : null);
    }
    const timer = setTimeout(() => done(null), timeoutMs);
    window.addEventListener("message", onMessage);
    win.postMessage({ "sb-live-export": true }, "*");
  });
}
