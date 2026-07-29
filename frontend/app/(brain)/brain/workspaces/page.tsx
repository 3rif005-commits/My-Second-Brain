"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { wsApi, type Workspace } from "@/lib/workspace";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);

  const load = () =>
    wsApi.listWorkspaces().then(setWorkspaces).catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  async function create(name: string) {
    setShowCreate(false);
    try {
      const ws = await wsApi.createWorkspace(name);
      router.push(`/brain/workspaces/${ws.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create workspace");
    }
  }

  async function confirmRemove() {
    if (!pendingDelete) return;
    const ws = pendingDelete;
    setPendingDelete(null);
    await wsApi.deleteWorkspace(ws.id).catch(() => {});
    load();
  }

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Workspaces</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Gather sources, study them with AI, and shape the summaries into your own notes.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus size={15} /> New workspace
          </button>
        </div>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        {workspaces === null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-gray-50 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🗂️</p>
            <p className="text-sm">No workspaces yet. Create one and drop in a PDF, a YouTube link, or a website.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                onClick={() => router.push(`/brain/workspaces/${ws.id}`)}
                className="group p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md cursor-pointer transition-all bg-white dark:bg-gray-800"
              >
                <div className="flex items-start justify-between">
                  <span className="text-2xl">{ws.icon || "🗂️"}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPendingDelete(ws); }}
                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                  {ws.name}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  {ws.resource_count ?? 0} source{(ws.resource_count ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <PromptDialog
        open={showCreate}
        title="New workspace"
        label="Name"
        placeholder="e.g. Thermodynamics"
        defaultValue="New Workspace"
        confirmLabel="Create"
        onSubmit={create}
        onCancel={() => setShowCreate(false)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete workspace "${pendingDelete?.name ?? ""}"?`}
        description="Notes created in it are kept — only the workspace and its source cards are removed."
        confirmLabel="Delete"
        onConfirm={confirmRemove}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
