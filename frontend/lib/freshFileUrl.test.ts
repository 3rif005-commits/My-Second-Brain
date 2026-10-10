import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearFreshUrlCache, freshFileUrl, isOurStoredFile } from "./freshFileUrl";

const OLD = "https://x.supabase.co/storage/v1/object/sign/workspace-resources/u1/r1/captures/f.png?token=EXPIRED";
beforeEach(() => _clearFreshUrlCache());
afterEach(() => vi.unstubAllGlobals());

describe("freshFileUrl", () => {
  it("leaves every other address alone, without a request", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await freshFileUrl("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(await freshFileUrl("")).toBe("");
    expect(f).not.toHaveBeenCalled();
    expect(isOurStoredFile(OLD)).toBe(true);
  });
  it("swaps an old link to our storage for the fresh one, once per link", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ url: "https://x/new?token=OK" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await freshFileUrl(OLD)).toBe("https://x/new?token=OK");
    expect(await freshFileUrl(OLD)).toBe("https://x/new?token=OK");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("falls back to the old link when the server cannot help", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect(await freshFileUrl(OLD)).toBe(OLD);
    _clearFreshUrlCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await freshFileUrl(OLD)).toBe(OLD);
  });
});
