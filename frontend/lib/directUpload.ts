// Files go from the browser straight to Supabase Storage through a one-time link the backend
// hands out, so they never pass through the Vercel function (it refuses request bodies over
// 4.5 MB). The backend checks the stored file when it's registered.
import { createClient } from "@/lib/supabase/client";

const BUCKET = "workspace-resources";

/** Upload a source file straight into the user's own folder (the bucket lets each user write
 *  under their id), so the bytes start moving at once instead of after a link request, which
 *  waits for the backend to wake (up to a minute on Render's free plan). The path has the shape
 *  /sources/upload-url hands out, so POST /sources accepts it the same way.
 *  → the path, or null when that write is refused and the link route should be used. */
export async function uploadSourceToOwnFolder(file: File): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!session || !/^\.[a-z0-9]+$/.test(ext)) return null;
  const path = `${session.user.id}/${crypto.randomUUID()}/source${ext}`;
  const { error } = await supabase.storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  if (!error) return path;
  if (/exceeded|too large|maximum allowed size/i.test(error.message)) {
    throw new Error(`"${file.name}" is larger than your storage allows.`);
  }
  return null;
}

/** Ask `linkEndpoint` (an /api/ws route) for a link and upload `file` to it.
 *  → the Storage path, or null when the backend doesn't offer links yet (a deploy in
 *  between: Vercel goes live minutes before Render) and the old upload should be used. */
export async function directUpload(linkEndpoint: string, file: File, contentType?: string): Promise<string | null> {
  const res = await fetch(linkEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name }),
  });
  if (res.status === 404 || res.status === 405) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data?.upload_path !== "string") {
    throw new Error((data?.detail?.error ?? data?.error ?? `Upload failed (HTTP ${res.status})`) as string);
  }
  const { error } = await createClient().storage.from(BUCKET)
    .uploadToSignedUrl(data.upload_path, data.token, file, { contentType: contentType || file.type || undefined });
  if (error) {
    throw new Error(/exceeded|too large|maximum allowed size/i.test(error.message)
      ? `"${file.name}" is larger than your storage allows.`
      : `Upload failed: ${error.message}`);
  }
  return data.upload_path;
}
