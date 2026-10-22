// Dropping a 3D model file into a note (ArtCraft study 7b): upload it, then insert a live block
// whose code is the file's link — the live runtime shows it auto-framed and lit.

export const MODEL_EXTS = [".glb", ".stl"];

/** The first .glb/.stl file in a drop, if any. */
export function modelFileFrom(dt: DataTransfer | null | undefined): File | null {
  for (const f of Array.from(dt?.files ?? [])) {
    if (MODEL_EXTS.some((x) => f.name.toLowerCase().endsWith(x))) return f;
  }
  return null;
}

/** A block title from a file name: "heart_model.glb" → "heart model". */
export function modelTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "3D model";
}

export async function uploadModel(noteId: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file, file.name);
  const res = await fetch(`/api/ws/notes/${encodeURIComponent(noteId)}/model-asset`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data?.url !== "string") {
    throw new Error((data?.detail?.error ?? data?.error ?? `Upload failed (HTTP ${res.status})`) as string);
  }
  return data.url;
}
