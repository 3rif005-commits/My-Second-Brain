import { describe, expect, it } from "vitest";
import { parse } from "acorn";
import { CDN, MERMAID_URL, buildSrcDoc, detectKind, preflightWarnings } from "./liveRuntime";

// Every inline script the runtime emits must at least parse — no browser needed to catch a slip.
function scripts(doc: string): { module: boolean; src: string }[] {
  return [...doc.matchAll(/<script(\s+type="([^"]+)")?>([\s\S]*?)<\/script>/g)]
    .filter((m) => m[2] !== "importmap")
    .map((m) => ({ module: m[2] === "module", src: m[3] }));
}
function allParse(doc: string) {
  for (const s of scripts(doc)) {
    expect(() => parse(s.src, { ecmaVersion: "latest", sourceType: s.module ? "module" : "script" }))
      .not.toThrow();
  }
}
const cspOf = (doc: string) => doc.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";

describe("detectKind", () => {
  it("reads the kind from the code itself", () => {
    expect(detectKind("flowchart LR\n  A-->B")).toBe("mermaid");
    expect(detectKind("%% notes\nmindmap\n  root((x))")).toBe("mermaid");
    expect(detectKind("timeline\n 2020 : a")).toBe("mermaid");
    expect(detectKind("https://example.com/models/cell.glb")).toBe("model");
    expect(detectKind("https://x.supabase.co/s/a.stl?token=1")).toBe("model");
    expect(detectKind("<div>flowchart</div>")).toBe("html");
    expect(detectKind("graphical explanation")).toBe("html");
    expect(detectKind("http://insecure/a.glb")).toBe("html");
  });
});

describe("buildSrcDoc", () => {
  it("mermaid: pinned library, escaped source, parsable scripts, tight CSP", () => {
    const doc = buildSrcDoc("flowchart LR\n  A[<b>x</b>] --> B");
    expect(doc).toContain(MERMAID_URL);
    expect(doc).toContain("A[&lt;b&gt;x&lt;/b&gt;]");
    expect(cspOf(doc)).toContain("default-src 'none'");
    expect(cspOf(doc)).toContain(`connect-src ${CDN}`);
    expect(doc).toContain("sb-live-export");
    expect(doc).toContain("sb-live-height");
    allParse(doc);
  });

  it("model: 3D runtime with the fixed light rig, the file's own origin allowed", () => {
    const doc = buildSrcDoc("https://models.example.org/a/cell.glb", { assetOrigin: "https://p.supabase.co" });
    expect(doc).toContain('"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js"');
    expect(doc).toContain("GLTFLoader");
    expect(doc).toContain("dampingFactor = 0.05");
    expect(cspOf(doc)).toContain("https://models.example.org");
    expect(cspOf(doc)).toContain("https://p.supabase.co");
    allParse(doc);
  });

  it("model: a hostile URL cannot close the script", () => {
    const doc = buildSrcDoc("https://e.com/</script><script>alert(1)</script>.glb");
    expect(doc).not.toContain("<script>alert(1)");
    allParse(doc);
  });

  it("html: the scene helper only when the block uses it", () => {
    const plain = buildSrcDoc("<p>Quiz</p><script>var a=1</script>");
    expect(plain).not.toContain("importmap");
    allParse(plain);
    const three = buildSrcDoc('<script type="module">const s = await sbScene(); s.frame(new s.THREE.Mesh());</script>');
    expect(three).toContain("importmap");
    expect(three).toContain("window.sbScene");
    allParse(three);
  });

  it("html: goes into the block's own <head> when it has one", () => {
    const doc = buildSrcDoc("<html><head><title>t</title></head><body><p>x</p></body></html>");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<title>"));
    expect(doc.match(/<html/g)?.length).toBe(1);
  });
});

describe("preflightWarnings", () => {
  it("flags network, page escapes and foreign files; built-ins are fine", () => {
    expect(preflightWarnings("<script>fetch('https://x')</script>")).toHaveLength(1);
    expect(preflightWarnings("<script>parent.document.body</script>")[0]).toMatch(/page around it/);
    expect(preflightWarnings('<img src="https://evil.com/a.png">')[0]).toMatch(/other sites/);
    expect(preflightWarnings(`<script src="${CDN}/npm/x"></script>`)).toEqual([]);
    expect(preflightWarnings("flowchart LR\n A-->B")).toEqual([]);
  });
});
