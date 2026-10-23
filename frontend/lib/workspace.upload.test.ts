import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}));

import { wsApi } from "./workspace";

const PATH = "user-1/3f2b8c1e-1111-4222-8333-444455556666/source.pdf";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("wsApi.addSource with a file", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    uploadToSignedUrl.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uploads straight to Storage and registers the path, so the file skips Vercel", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ upload_path: PATH, token: "tok", signed_url: "https://s" }))
      .mockResolvedValueOnce(json({ note_id: "n1", source: { id: "s1" }, deferred: false }));
    uploadToSignedUrl.mockResolvedValue({ data: { path: PATH }, error: null });
    const file = new File([new Uint8Array(10)], "Lecture 10.pdf", { type: "application/pdf" });

    const r = await wsApi.addSource({ file, noteId: "n1" });

    expect(r.note_id).toBe("n1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ws/sources/upload-url");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ filename: "Lecture 10.pdf" });
    expect(uploadToSignedUrl).toHaveBeenCalledWith(PATH, "tok", file, { contentType: "application/pdf" });
    const fd = fetchMock.mock.calls[1][1].body as FormData;
    expect(fd.get("upload_path")).toBe(PATH);
    expect(fd.get("filename")).toBe("Lecture 10.pdf");
    expect(fd.get("file")).toBeNull();                 // the bytes are not sent again
  });

  it("falls back to the old upload while the backend has no upload links yet", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ detail: "Method Not Allowed" }, 405))
      .mockResolvedValueOnce(json({ note_id: "n1", source: { id: "s1" }, deferred: false }));
    const file = new File(["x"], "a.pdf", { type: "application/pdf" });

    await wsApi.addSource({ file, noteId: "n1" });

    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    const fd = fetchMock.mock.calls[1][1].body as FormData;
    expect(fd.get("file")).toBeInstanceOf(File);
    expect(fd.get("upload_path")).toBeNull();
  });

  it("stops with a plain message when Storage refuses the file, and registers nothing", async () => {
    fetchMock.mockResolvedValueOnce(json({ upload_path: PATH, token: "tok", signed_url: "https://s" }));
    uploadToSignedUrl.mockResolvedValue({ data: null, error: { message: "The object exceeded the maximum allowed size" } });
    const file = new File(["x"], "huge.mp4", { type: "video/mp4" });

    await expect(wsApi.addSource({ file })).rejects.toThrow('"huge.mp4" is larger than your storage allows.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a URL source still goes in one request", async () => {
    fetchMock.mockResolvedValueOnce(json({ note_id: "n1", source: { id: "s1" }, deferred: false }));
    await wsApi.addSource({ url: "https://example.com" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ws/sources");
  });
});
