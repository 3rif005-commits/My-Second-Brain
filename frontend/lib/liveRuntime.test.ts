import { describe, expect, it } from "vitest";
import { parse } from "acorn";
import { CDN, FIT_CAMERA_JS, MERMAID_URL, buildSrcDoc, detectKind, preflightWarnings } from "./liveRuntime";

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
    expect(cspOf(doc)).toContain(`connect-src ${CDN} https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh`);
    expect(cspOf(doc)).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com");
    expect(doc).toContain("sb-live-export");
    expect(doc).toContain("sb-live-height");
    allParse(doc);
  });

  it("model: 3D runtime with the fixed light rig, the file's own origin allowed", () => {
    const doc = buildSrcDoc("https://models.example.org/a/cell.glb", { assetOrigin: "https://p.supabase.co" });
    expect(doc).toContain('"three":"https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js"');
    expect(doc).toContain("GLTFLoader");
    expect(doc).toContain("dampingFactor = 0.05");
    // an environment to reflect, so material-less (default metallic) glTF isn't black
    expect(doc).toContain('from "three/addons/environments/RoomEnvironment.js"');
    expect(doc).toContain("scene.environment = ");
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

describe("buildSrcDoc theme (content follows the note's light/dark, like Notion's previews)", () => {
  it("light by default; dark gives the dark colours, color-scheme and Mermaid's dark theme", () => {
    const light = buildSrcDoc("flowchart LR\n A-->B");
    expect(light).toContain("color-scheme:light");
    expect(light).toContain(`"theme":"default"`);
    const dark = buildSrcDoc("flowchart LR\n A-->B", { theme: "dark" });
    expect(dark).toContain("color-scheme:dark");
    expect(dark).toContain("--sb-text:rgb(240,239,237)");
    expect(dark).toContain(`"theme":"dark"`);
    expect(dark).toContain(`"primaryBorderColor":"#cccccc"`);
    allParse(dark);
  });
  it("fit (Expand) scales a diagram to fill the frame; Mermaid ranks 40px apart like Notion", () => {
    expect(buildSrcDoc("flowchart LR\n A-->B", { fit: true })).toContain("pre.mermaid svg{width:100%!important");
    expect(buildSrcDoc("flowchart LR\n A-->B")).not.toContain("pre.mermaid svg{width:100%!important");
    expect(buildSrcDoc("flowchart LR\n A-->B")).toContain(`"rankSpacing":40`);
  });
  it("the page is transparent so the block's box shows through; HTML gets the variables too", () => {
    const doc = buildSrcDoc("<p>x</p>", { theme: "dark" });
    expect(doc).toContain("background:transparent");
    expect(doc).toContain("--sb-surface:rgb(37,37,37)");
  });
});

describe("preflightWarnings", () => {
  it("flags network, page escapes and foreign files; built-ins are fine", () => {
    expect(preflightWarnings("<script>fetch('https://x')</script>")).toHaveLength(1);
    expect(preflightWarnings("<script>parent.document.body</script>")[0]).toMatch(/page around it/);
    expect(preflightWarnings('<img src="https://evil.com/a.png">')[0]).toMatch(/isn't allowed/);
    expect(preflightWarnings(`<script src="${CDN}/npm/x"></script>`)).toEqual([]);
    // The other public library sites pasted examples use are allowed too (user's choice).
    expect(preflightWarnings('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>')).toEqual([]);
    expect(preflightWarnings('<script type="module">import x from "https://esm.sh/d3"</script><script src="https://unpkg.com/a"></script>')).toEqual([]);
    // A look-alike host is not one of them.
    expect(preflightWarnings('<script src="https://unpkg.com.evil.io/a"></script>')[0]).toMatch(/isn't allowed/);
    expect(preflightWarnings("flowchart LR\n A-->B")).toEqual([]);
  });
});

describe("fitCamera (3D framing)", () => {
  const fitCamera = new Function(`${FIT_CAMERA_JS}; return fitCamera;`)() as
    (sx: number, sy: number, sz: number, fov: number) => { x: number; y: number; z: number; ty: number };

  // Every corner of the box must sit inside the camera's vertical field of view.
  function cornersFit(sx: number, sy: number, sz: number, fov = 50) {
    const p = fitCamera(sx, sy, sz, fov);
    const f = [-p.x, p.ty - p.y, -p.z], fl = Math.hypot(...f);
    const half = (fov * Math.PI) / 360;
    for (const cx of [-sx / 2, sx / 2]) for (const cy of [0, sy]) for (const cz of [-sz / 2, sz / 2]) {
      const v = [cx - p.x, cy - p.y, cz - p.z], vl = Math.hypot(...v);
      const angle = Math.acos((v[0] * f[0] + v[1] * f[1] + v[2] * f[2]) / (vl * fl));
      if (angle > half) return false;
    }
    return true;
  }

  it("keeps a whole cube in view (the 2-unit cube used to be cut off)", () => {
    expect(cornersFit(2, 2, 2)).toBe(true);
  });

  it("keeps flat, tall and long models in view, aimed at their middle", () => {
    expect(cornersFit(2, 0.2, 2)).toBe(true);
    expect(cornersFit(0.5, 2, 0.5)).toBe(true);
    expect(cornersFit(2, 0.5, 0.3)).toBe(true);
    expect(fitCamera(2, 2, 2, 50).ty).toBe(1);
  });
});
