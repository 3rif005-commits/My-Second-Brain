import { describe, expect, it } from "vitest";
import { modelFileFrom, modelTitle } from "./modelDrop";
import { detectKind } from "./liveRuntime";

describe("model drops", () => {
  it("picks the first .glb/.stl file and ignores everything else", () => {
    const img = new File(["x"], "a.png", { type: "image/png" });
    const glb = new File(["glTF"], "Heart_Model.GLB");
    expect(modelFileFrom({ files: [img, glb] } as unknown as DataTransfer)).toBe(glb);
    expect(modelFileFrom({ files: [img] } as unknown as DataTransfer)).toBeNull();
    expect(modelFileFrom(null)).toBeNull();
  });
  it("titles from file names", () => {
    expect(modelTitle("heart_model-v2.glb")).toBe("heart model v2");
    expect(modelTitle(".stl")).toBe("3D model");
  });
  it("an uploaded file's signed link is read as a model block", () => {
    expect(detectKind("https://p.supabase.co/storage/v1/object/sign/b/u/notes/n/models/ab12.glb?token=xyz")).toBe("model");
  });
});
