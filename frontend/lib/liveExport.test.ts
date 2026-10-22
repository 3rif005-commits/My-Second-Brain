import { describe, expect, it } from "vitest";
import { exportFrameImage } from "./liveExport";

function frame() {
  const f = document.createElement("iframe");
  document.body.appendChild(f);
  return f;
}
const reply = (source: Window | null, data: unknown) =>
  window.dispatchEvent(new MessageEvent("message", { data, source }));

describe("exportFrameImage", () => {
  it("returns the picture the frame sends back", async () => {
    const f = frame();
    const p = exportFrameImage(f);
    reply(f.contentWindow, { "sb-live-image": "data:image/svg+xml;charset=utf-8,%3Csvg%3E", "sb-live-kind": "svg" });
    expect(await p).toEqual({ dataUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%3E", kind: "svg" });
  });
  it("ignores other windows and anything that isn't an image", async () => {
    const f = frame(), other = frame();
    const p = exportFrameImage(f, 50);
    reply(other.contentWindow, { "sb-live-image": "data:image/png;base64,AAA", "sb-live-kind": "png" });
    expect(await p).toBeNull();
    const q = exportFrameImage(f);
    reply(f.contentWindow, { "sb-live-image": "javascript:alert(1)", "sb-live-kind": "png" });
    expect(await q).toBeNull();
  });
  it("gives up when the frame never answers", async () => {
    expect(await exportFrameImage(frame(), 20)).toBeNull();
  });
});
