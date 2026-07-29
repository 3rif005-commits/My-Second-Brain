"use client";

// Freeform workspace canvas — React Flow with zero edges, used purely as a
// spatial card manager (drag / resize / stack) for resource + note-page cards.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  type Node,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Link2, StickyNote, MessageSquare } from "lucide-react";
import { wsApi, type Workspace, type WsPage, type WsResource } from "@/lib/workspace";
import { useToast } from "@/app/providers";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ResourceCard, type ResourceNodeData } from "./ResourceCard";
import { NotePageCard, type PageNodeData } from "./NotePageCard";

const nodeTypes = { resource: ResourceCard, page: NotePageCard };

interface WorkspaceCanvasProps {
  workspace: Workspace;
  onOpenResource: (resource: WsResource) => void;
  onOpenPage: (page: WsPage) => void;
  onWorkspaceChanged: () => void;
  onToggleChat: () => void;
}

export function WorkspaceCanvas({
  workspace, onOpenResource, onOpenPage, onWorkspaceChanged, onToggleChat,
}: WorkspaceCanvasProps) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showUrlPrompt, setShowUrlPrompt] = useState(false);
  const [pendingDeleteResource, setPendingDeleteResource] = useState<WsResource | null>(null);
  const zCounter = useRef(1);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { showToast } = useToast();

  const retryResource = useCallback(async (r: WsResource) => {
    await wsApi.reprocessResource(r.id).catch(() => {});
    onWorkspaceChanged();
  }, [onWorkspaceChanged]);

  const deleteResource = useCallback((r: WsResource) => {
    setPendingDeleteResource(r);
  }, []);

  const confirmDeleteResource = useCallback(async () => {
    if (!pendingDeleteResource) return;
    const r = pendingDeleteResource;
    setPendingDeleteResource(null);
    await wsApi.deleteResource(r.id).catch(() => {});
    onWorkspaceChanged();
  }, [pendingDeleteResource, onWorkspaceChanged]);

  const removePage = useCallback(async (p: WsPage) => {
    await wsApi.removePage(p.id).catch(() => {});
    onWorkspaceChanged();
  }, [onWorkspaceChanged]);

  // Build nodes from workspace data
  useEffect(() => {
    const maxZ = Math.max(1,
      ...workspace.resources.map((r) => r.z_index),
      ...workspace.pages.map((p) => p.z_index));
    zCounter.current = maxZ;
    setNodes([
      ...workspace.resources.map((r): Node => ({
        id: `res-${r.id}`,
        type: "resource",
        position: { x: r.pos_x, y: r.pos_y },
        width: r.width,
        height: r.height,
        zIndex: r.z_index,
        data: {
          resource: r,
          onOpen: onOpenResource,
          onRetry: retryResource,
          onDelete: deleteResource,
        } satisfies ResourceNodeData,
      })),
      ...workspace.pages.map((p): Node => ({
        id: `page-${p.id}`,
        type: "page",
        position: { x: p.pos_x, y: p.pos_y },
        width: p.width,
        height: p.height,
        zIndex: p.z_index,
        data: {
          page: p,
          onOpen: onOpenPage,
          onRemove: removePage,
        } satisfies PageNodeData,
      })),
    ]);
  }, [workspace, setNodes, onOpenResource, onOpenPage, retryResource, deleteResource, removePage]);

  // Poll statuses while anything is queued/processing
  const hasPending = workspace.resources.some(
    (r) => r.status === "queued" || r.status === "processing");
  useEffect(() => {
    if (!hasPending) return;
    pollRef.current = setInterval(async () => {
      try {
        const statuses = await wsApi.resourceStatuses(workspace.id);
        const stillPending = statuses.some(
          (s) => s.status === "queued" || s.status === "processing");
        const changed = statuses.some((s) => {
          const local = workspace.resources.find((r) => r.id === s.id);
          return local && local.status !== s.status;
        });
        if (changed) onWorkspaceChanged();
        if (!stillPending && pollRef.current) clearInterval(pollRef.current);
      } catch { /* backend momentarily unreachable */ }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [hasPending, workspace, onWorkspaceChanged]);

  const persistNode = useCallback((node: Node) => {
    const patch = {
      pos_x: node.position.x,
      pos_y: node.position.y,
      width: node.width ?? undefined,
      height: node.height ?? undefined,
      z_index: node.zIndex ?? undefined,
    };
    if (node.id.startsWith("res-")) {
      wsApi.patchResource(node.id.slice(4), patch).catch(() => {});
    } else {
      wsApi.patchPage(node.id.slice(5), patch).catch(() => {});
    }
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChangeBase(changes);
    // Persist resize when the interaction ends
    for (const ch of changes) {
      if (ch.type === "dimensions" && ch.resizing === false) {
        setNodes((nds) => {
          const node = nds.find((n) => n.id === ch.id);
          if (node) persistNode(node);
          return nds;
        });
      }
    }
  }, [onNodesChangeBase, persistNode, setNodes]);

  const bringToFront = useCallback((_: unknown, node: Node) => {
    zCounter.current += 1;
    const z = zCounter.current;
    setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, zIndex: z } : n)));
  }, [setNodes]);

  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    persistNode({ ...node, zIndex: zCounter.current });
  }, [persistNode]);

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    wsApi.patchWorkspace(workspace.id, { viewport }).catch(() => {});
  }, [workspace.id]);

  const defaultViewport = useMemo(
    () => workspace.viewport ?? { x: 0, y: 0, zoom: 1 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  const dropPos = useCallback(() => ({
    x: 80 + Math.random() * 160,
    y: 80 + Math.random() * 160,
  }), []);

  async function submitUrl(url: string) {
    setShowUrlPrompt(false);
    await wsApi.importUrl(workspace.id, url, dropPos())
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to import URL"));
    onWorkspaceChanged();
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFilesPicked(files: FileList | null) {
    if (!files?.length) return;
    setShowAdd(false);
    for (const file of Array.from(files)) {
      await wsApi.importFile(workspace.id, file, dropPos())
        .catch((e) => showToast(e instanceof Error ? e.message : `Failed to import ${file.name}`));
    }
    onWorkspaceChanged();
  }

  async function addNotePage() {
    setShowAdd(false);
    await wsApi.addPage(workspace.id, { title: "Untitled", ...dropPos(), pos_x: 120, pos_y: 120 })
      .catch((e) => showToast(e instanceof Error ? e.message : "Failed to add note page"));
    onWorkspaceChanged();
  }

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={bringToFront}
        onNodeDragStart={bringToFront}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        defaultViewport={defaultViewport}
        minZoom={0.2}
        maxZoom={2}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        className="bg-gray-50 dark:bg-gray-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5}
          className="!bg-gray-50 dark:!bg-gray-950" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>

      {/* Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium shadow hover:bg-indigo-700 transition-colors"
          >
            <Plus size={15} /> Add source
          </button>
          {showAdd && (
            <div className="absolute left-0 top-full mt-1.5 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 overflow-hidden">
              <button
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={14} /> Upload file (PDF, MD, TXT, video)
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                onClick={() => { setShowAdd(false); setShowUrlPrompt(true); }}
              >
                <Link2 size={14} /> Paste URL (website / YouTube)
              </button>
              <button
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
                onClick={addNotePage}
              >
                <StickyNote size={14} /> Blank note page
              </button>
            </div>
          )}
        </div>
        <button
          onClick={onToggleChat}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <MessageSquare size={15} /> Chat
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.txt,.mp4,.webm,.mov,.mkv,.m4v"
        className="hidden"
        onChange={(e) => onFilesPicked(e.target.files)}
      />

      <PromptDialog
        open={showUrlPrompt}
        title="Add a source URL"
        label="URL"
        placeholder="https://... (website or YouTube video)"
        confirmLabel="Add"
        onSubmit={submitUrl}
        onCancel={() => setShowUrlPrompt(false)}
      />
      <ConfirmDialog
        open={pendingDeleteResource !== null}
        title={`Remove "${pendingDeleteResource?.title ?? ""}"?`}
        description="It will be removed from this workspace. Its note is kept."
        confirmLabel="Remove"
        onConfirm={confirmDeleteResource}
        onCancel={() => setPendingDeleteResource(null)}
      />
    </div>
  );
}
