import { describe, expect, it } from "vitest";
import { incompatibility, parseManifest, parseSource, sourceKey, versionAtLeast } from "./manifest";

describe("parseManifest", () => {
  it("accepts a minimal manifest", () => {
    expect(parseManifest({ id: "webmcp", name: "WebMCP", version: "1.0.0" })).toMatchObject({
      id: "webmcp",
      name: "WebMCP",
      version: "1.0.0",
    });
  });
  it("refuses bad ids, names and versions", () => {
    expect(() => parseManifest({ id: "Web MCP", name: "x", version: "1" })).toThrow(/id/);
    expect(() => parseManifest({ id: "a", version: "1" })).toThrow(/name/);
    expect(() => parseManifest({ id: "a", name: "A", version: "latest" })).toThrow(/version/);
    expect(() => parseManifest({ id: "a", name: "A", version: "1", apiVersion: 0 })).toThrow(/apiVersion/);
    expect(() => parseManifest("nope")).toThrow();
  });
});

describe("versions", () => {
  it("compares numerically, not as text", () => {
    expect(versionAtLeast("1.10.0", "1.9.2")).toBe(true);
    expect(versionAtLeast("0.1.0", "0.2")).toBe(false);
    expect(versionAtLeast("1.0.0-beta", "1.0.0")).toBe(true);
  });
  it("says why a plugin can't run", () => {
    expect(incompatibility({ id: "a", name: "A", version: "1", apiVersion: 99 })).toMatch(/API v99/);
    expect(incompatibility({ id: "a", name: "A", version: "1", minAppVersion: "999.0.0" })).toMatch(/999/);
    expect(incompatibility({ id: "a", name: "A", version: "1" })).toBeNull();
  });
});

describe("parseSource", () => {
  it("reads GitHub repos in either form", () => {
    expect(parseSource("owner/repo")).toEqual({ kind: "github", owner: "owner", repo: "repo" });
    expect(parseSource("https://github.com/owner/repo.git")).toEqual({ kind: "github", owner: "owner", repo: "repo" });
  });
  it("turns a file link into its folder", () => {
    const src = parseSource("https://cdn.example.com/p/main.js?x=1#y");
    expect(sourceKey(src)).toBe("https://cdn.example.com/p/");
  });
  it("refuses http, logins and junk", () => {
    expect(() => parseSource("http://example.com/p/")).toThrow(/https/);
    expect(() => parseSource("https://u:p@example.com/p/")).toThrow(/login/);
    expect(() => parseSource("not a link")).toThrow();
  });
});
