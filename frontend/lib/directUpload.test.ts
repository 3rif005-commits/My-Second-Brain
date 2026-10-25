import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadToSignedUrl = vi.fn();
const upload = vi.fn();
const getSession = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession }, storage: { from: () => ({ uploadToSignedUrl, upload }) } }),
}));

import { wsApi } from "./workspace";
import { uploadModel } from "./modelDrop";

const PATH = "user-1/3f2b8c1e-1111-4222-8333-444455556666/source.pdf";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const signedIn = { data: { session: { user: { id: "user-1" } } } };

describe("wsApi.addSource straight into the user's own folder", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    uploadToSignedUrl.mockReset();
    upload.mockReset();
    getSession.mockResolvedValue(signedIn);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uploads before any backend call, so a sleeping backend doesn't hold the bytes back", async () => {
    upload.mockResolvedValue({ data: {}, error: null });
    fetchMock.mockResolvedValueOnce(json({ note_id: "n1", source: { id: "s1" }, deferred: false }));
    const file = new File([new Uint8Array(10)], "Lecture 10.PDF", { type: "application/pdf" });

    await wsApi.addSource({ file, noteId: "n1" });

    const path = upload.mock.calls[0][0] as string;
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\/source\.pdf$/);   // the shape /sources checks
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ws/sources");
    expect((fetchMock.mock.calls[0][1].body as FormData).get("upload_path")).toBe(path);
  });

  it("asks the backend for a link when the bucket refuses the write", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });
    uploadToSignedUrl.mockResolvedValue({ data: { path: PATH }, error: null });
    fetchMock
      .mockResolvedValueOnce(json({ upload_path: PATH, token: "tok", signed_url: "https://s" }))
      .mockResolvedValueOnce(json({ note_id: "n1", source: { id: "s1" }, deferred: false }));

    await wsApi.addSource({ file: new File(["x"], "a.pdf"), noteId: "n1" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/ws/sources/upload-url");
    expect((fetchMock.mock.calls[1][1].body as FormData).get("upload_path")).toBe(PATH);
  });

  it("stops with a plain message when the file is over the storage limit", async () => {
    upload.mockResolvedValue({ data: null, error: { message: "The object exceeded the maximum allowed size" } });
    await expect(wsApi.addSource({ file: new File(["x"], "huge.mp4") }))
      .rejects.toThrow('"huge.mp4" is larger than your storage allows.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("startUploads runs every upload at once and wakes the backend meanwhile", async () => {
    const pending: (() => void)[] = [];
    upload.mockImplementation(() => new Promise((res) => pending.push(() => res({ data: {}, error: null }))));
    fetchMock.mockResolvedValue(json([]));
    const uploads = wsApi.startUploads([
      { file: new File(["a"], "a.pdf") }, {}, { file: new File(["b"], "b.mp4") },
    ]);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));   // both started, none done
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ws/sessions/recent?limit=1");
    pending.forEach((done) => done());
    const paths = await Promise.all(uploads);
    expect(paths[0]).toMatch(/source\.pdf$/);
    expect(paths[1]).toBeNull();
    expect(paths[2]).toMatch(/source\.mp4$/);
  });
});

describe("wsApi.addSource with a file, through a backend link", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    uploadToSignedUrl.mockReset();
    getSession.mockResolvedValue({ data: { session: null } });
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

describe("uploadModel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    uploadToSignedUrl.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  const MODEL = "user-1/notes/n1/models/" + "a".repeat(32) + ".glb";

  it("uploads the model straight to Storage, then registers it for the long-lived link", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ upload_path: MODEL, token: "tok" }))
      .mockResolvedValueOnce(json({ url: "https://p/x.glb?token=t", path: MODEL }));
    uploadToSignedUrl.mockResolvedValue({ data: { path: MODEL }, error: null });
    const file = new File([new Uint8Array(8)], "heart.glb");   // browsers give .glb no type

    expect(await uploadModel("n1", file)).toBe("https://p/x.glb?token=t");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ws/notes/n1/model-upload-url");
    expect(uploadToSignedUrl).toHaveBeenCalledWith(MODEL, "tok", file, { contentType: "model/gltf-binary" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/ws/notes/n1/model-asset");
    const fd = fetchMock.mock.calls[1][1].body as FormData;
    expect(fd.get("upload_path")).toBe(MODEL);
    expect(fd.get("file")).toBeNull();
  });

  it("falls back to sending the file while the backend has no upload links yet", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ detail: "Not Found" }, 404))
      .mockResolvedValueOnce(json({ url: "https://p/x.stl?token=t", path: "p" }));
    await uploadModel("n1", new File(["solid"], "part.stl"));
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    expect((fetchMock.mock.calls[1][1].body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("shows the backend's reason when the file type is refused", async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: { error: "Drop a .glb or .stl file." } }, 400));
    await expect(uploadModel("n1", new File(["{}"], "a.gltf"))).rejects.toThrow("Drop a .glb or .stl file.");
  });
});
