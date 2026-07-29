"use client";

// Workspace canvas page — hosts the freeform canvas, the split view overlay,
// and the grounded chat panel. Deep links:
//   ?resource=<id>&t=<seconds> | &p=<page> | &s=<section>  → open split view there
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft } from "lucide-react";
import {
  wsApi, type AnchorType, type Citation, type Workspace, type WsPage, type WsResource,
} from "@/lib/workspace";
import { WorkspaceCanvas } from "@/components/workspace/WorkspaceCanvas";
import { WorkspaceChat } from "@/components/workspace/WorkspaceChat";

// SplitView pulls in react-pdf (PdfViewer), which touches browser-only APIs
// (DOMMatrix) at module-eval time and crashes SSR — same reason BlockEditor
// itself is loaded with ssr:false.
const SplitView = dynamic(
  () => import("@/components/workspace/SplitView").then((m) => m.SplitView),
  { ssr: false }
);

interface OpenState {
  resource: WsResource | null;
  noteId: string | null;
  seek: { type: AnchorType; value: number } | null;
}

export default function WorkspacePage() {
  const params = useParams<{ workspaceId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const workspaceId = params.workspaceId;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const load = useCallback(() => {
    wsApi.getWorkspace(workspaceId)
      .then((ws) => { setWorkspace(ws); setError(null); })
      .catch((e) => setError(e.message));
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  // deep link handling (checkpoint blocks / citations from other pages)
  const deepLink = useMemo(() => {
    const rid = search.get("resource");
    if (!rid) return null;
    const t = search.get("t"), p = search.get("p"), s = search.get("s");
    let seek: OpenState["seek"] = null;
    if (t) seek = { type: "time", value: parseFloat(t) };
    else if (p) seek = { type: "page", value: parseFloat(p) };
    else if (s) seek = { type: "section", value: parseFloat(s) };
    return { rid, seek };
  }, [search]);

  useEffect(() => {
    if (!deepLink || !workspace || open) return;
    const resource = workspace.resources.find((r) => r.id === deepLink.rid);
    if (resource) {
      setOpen({ resource, noteId: resource.note_id, seek: deepLink.seek });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, workspace]);

  const openResource = useCallback((resource: WsResource) => {
    setOpen({ resource, noteId: resource.note_id, seek: null });
  }, []);

  const openPage = useCallback((page: WsPage) => {
    if (!workspace) return;
    // If this note is a resource's output note, open it beside its source.
    const source = workspace.resources.find((r) => r.note_id === page.note_id) ?? null;
    setOpen({ resource: source, noteId: page.note_id, seek: null });
  }, [workspace]);

  const handleCitation = useCallback((c: Citation) => {
    if (!workspace) return;
    const resource = workspace.resources.find((r) => r.id === c.resource_id);
    if (!resource) return;
    setOpen({
      resource,
      noteId: resource.note_id,
      seek: { type: c.anchor_type, value: c.anchor_start },
    });
  }, [workspace]);

  async function saveName() {
    setRenaming(false);
    if (!workspace || !nameDraft.trim() || nameDraft === workspace.name) return;
    await wsApi.patchWorkspace(workspace.id, { name: nameDraft.trim() }).catch(() => {});
    load();
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400">
        <p className="text-sm">{error}</p>
        <button className="text-xs text-indigo-500 hover:underline" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!workspace) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading workspace…</div>;
  }

  return (
    <div className="relative h-full flex flex-col bg-white dark:bg-gray-900">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <button
          onClick={() => router.push("/brain/workspaces")}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          title="All workspaces"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-lg">{workspace.icon || "🗂️"}</span>
        {renaming ? (
          <input
            autoFocus
            className="text-sm font-semibold bg-transparent border-b border-indigo-400 outline-none text-gray-900 dark:text-gray-100"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
          />
        ) : (
          <button
            className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-indigo-600"
            onClick={() => { setNameDraft(workspace.name); setRenaming(true); }}
            title="Rename"
          >
            {workspace.name}
          </button>
        )}
        <span className="text-xs text-gray-400 ml-2">
          {workspace.resources.length} source{workspace.resources.length === 1 ? "" : "s"} ·{" "}
          {workspace.pages.length} page{workspace.pages.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* canvas + chat */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0">
          <WorkspaceCanvas
            workspace={workspace}
            onOpenResource={openResource}
            onOpenPage={openPage}
            onWorkspaceChanged={load}
            onToggleChat={() => setChatOpen((v) => !v)}
          />
        </div>
        {chatOpen && (
          <WorkspaceChat
            workspaceId={workspace.id}
            onCitation={handleCitation}
            onClose={() => setChatOpen(false)}
          />
        )}
      </div>

      {/* split view overlay */}
      {open && (
        <SplitView
          workspaceId={workspace.id}
          resource={open.resource}
          noteId={open.noteId}
          initialSeek={open.seek}
          onClose={() => { setOpen(null); load(); }}
        />
      )}
    </div>
  );
}
