"use client";

// MCP servers: outside toolboxes the AI can use. Built on the settings kit like the
// other pages; it used to be hand-styled light-only (a white card with near-invisible
// text in dark mode, live check 2026-10-24). Each server shows what it offers right
// now, or why it offers nothing.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Button, ConfirmDialog, EmptyState, IconButton, Input, Select, SettingsPage,
  SettingsRow, SettingsSection, Tabs, Toggle,
} from "@/components/ui";

interface McpServer {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  url: string | null;
  enabled: boolean;
  trust_level: "read_only" | "full";
  created_at: string;
}

interface AuditEntry {
  id: string;
  server_name: string;
  tool_name: string;
  args_json: Record<string, unknown>;
  result_code: "ok" | "error" | "denied";
  created_at: string;
}

type Probe = { state: "checking" } | { state: "ok"; tools: string[] } | { state: "error"; error: string };
type Tab = "servers" | "activity";
type Trust = "read_only" | "full";

// Stored as trust_level; what it does is ask (or not) before each tool call.
const TRUST_OPTIONS: { value: Trust; label: string; description: string }[] = [
  { value: "read_only", label: "Ask me first", description: "The chat asks you before each tool call" },
  { value: "full", label: "Don't ask", description: "Tools run as soon as the AI calls them" },
];

const EMPTY_FORM = { name: "", transport: "http", command: "", url: "", trust_level: "read_only" as Trust };

function toolName(full: string) {
  return full.split(".").slice(2).join(".") || full;
}

export default function McpSettingsPage() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [stdioAllowed, setStdioAllowed] = useState(false);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>("servers");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null);

  const probe = useCallback(async (id: string) => {
    setProbes((p) => ({ ...p, [id]: { state: "checking" } }));
    try {
      const res = await fetch(`/api/mcp-servers/${id}/tools`);
      const data = await res.json().catch(() => ({}));
      const next: Probe = !res.ok
        ? { state: "error", error: data.detail ?? data.error ?? `Error ${res.status}` }
        : data.error
          ? { state: "error", error: data.error }
          : { state: "ok", tools: (data.tools ?? []).map((t: { name: string }) => toolName(t.name)) };
      setProbes((p) => ({ ...p, [id]: next }));
    } catch (e) {
      setProbes((p) => ({ ...p, [id]: { state: "error", error: e instanceof Error ? e.message : String(e) } }));
    }
  }, []);

  const loadServers = useCallback(async (probeIds?: string[]) => {
    const res = await fetch("/api/mcp-servers");
    if (!res.ok) {
      setServers([]);
      return;
    }
    const data = await res.json();
    const list: McpServer[] = data.servers ?? [];
    setServers(list);
    setStdioAllowed(!!data.stdio_allowed);
    for (const s of list) if (s.enabled && (!probeIds || probeIds.includes(s.id))) probe(s.id);
  }, [probe]);

  useEffect(() => { loadServers(); }, [loadServers]);
  useEffect(() => {
    if (tab !== "activity") return;
    fetch("/api/mcp-audit-log")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => setAudit(d.entries ?? []))
      .catch(() => setAudit([]));
  }, [tab]);

  async function addServer() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          transport: form.transport,
          command: form.transport === "stdio" ? form.command.trim() : null,
          url: form.transport !== "stdio" ? form.url.trim() : null,
          trust_level: form.trust_level,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? `Error ${res.status}`);
        return;
      }
      setShowAdd(false);
      setForm(EMPTY_FORM);
      await loadServers(data.id ? [data.id] : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Partial<Pick<McpServer, "enabled" | "trust_level">>) {
    setServers((list) => list?.map((s) => (s.id === id ? { ...s, ...body } : s)) ?? list);
    await fetch(`/api/mcp-servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (body.enabled) probe(id);
  }

  async function confirmRemove() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    await fetch(`/api/mcp-servers/${target.id}`, { method: "DELETE" });
    await loadServers([]);
  }

  const canAdd = form.name.trim() && (form.transport === "stdio" ? form.command.trim() : form.url.trim());

  return (
    <div>
      <SettingsPage
        title="MCP servers"
        description="Outside toolboxes the AI can use in chat, such as web search or a code wiki. Add a server by its address; the chat can then call its tools."
        actions={tab === "servers" && !showAdd
          ? <Button icon={<Plus />} onClick={() => setShowAdd(true)}>Add server</Button>
          : undefined}
      >
        <Tabs
          label="MCP sections"
          value={tab}
          onChange={setTab}
          items={[{ value: "servers", label: "Servers" }, { value: "activity", label: "Activity" }]}
          className="-mt-6"
        />

        {tab === "servers" && (
          <>
            {showAdd && (
              <SettingsSection title="Add a server">
                <SettingsRow stacked label="Name" htmlFor="mcp-name" help="A short word; the AI sees tools as name.tool.">
                  <Input
                    id="mcp-name"
                    inputSize="lg"
                    className="max-w-[400px]"
                    placeholder="deepwiki"
                    value={form.name}
                    autoFocus
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </SettingsRow>
                {stdioAllowed && (
                  <SettingsRow label="Connection" help="stdio runs a command on this computer.">
                    <Select
                      label="Connection"
                      value={form.transport}
                      onChange={(transport) => setForm((f) => ({ ...f, transport }))}
                      options={[{ value: "http", label: "URL" }, { value: "stdio", label: "Command (stdio)" }]}
                    />
                  </SettingsRow>
                )}
                {form.transport === "stdio" ? (
                  <SettingsRow stacked label="Command" htmlFor="mcp-command">
                    <Input
                      id="mcp-command"
                      inputSize="lg"
                      className="max-w-[400px] font-mono"
                      placeholder="npx -y @modelcontextprotocol/server-everything"
                      value={form.command}
                      onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    />
                  </SettingsRow>
                ) : (
                  <SettingsRow stacked label="URL" htmlFor="mcp-url" help="The server's address, e.g. https://mcp.deepwiki.com/mcp">
                    <Input
                      id="mcp-url"
                      inputSize="lg"
                      className="max-w-[400px]"
                      type="url"
                      placeholder="https://"
                      value={form.url}
                      onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    />
                  </SettingsRow>
                )}
                <SettingsRow label="Before each tool call" help={TRUST_OPTIONS.find((o) => o.value === form.trust_level)?.description}>
                  <Select
                    label="Before each tool call"
                    value={form.trust_level}
                    onChange={(trust_level) => setForm((f) => ({ ...f, trust_level }))}
                    options={TRUST_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  />
                </SettingsRow>
                {error && <p role="alert" className="text-sm text-ink-danger">{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={addServer} disabled={saving || !canAdd}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : "Add server"}
                  </Button>
                  <Button variant="secondary" onClick={() => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); }}>
                    Cancel
                  </Button>
                </div>
              </SettingsSection>
            )}

            <SettingsSection title="Servers">
              {servers === null && <p className="text-sm text-ink-tertiary">Loading…</p>}
              {servers?.length === 0 && !showAdd && (
                <EmptyState
                  title="No servers yet"
                  description="Try https://mcp.deepwiki.com/mcp: a free server that answers questions about public GitHub projects."
                  action={<Button variant="secondary" icon={<Plus />} onClick={() => setShowAdd(true)}>Add server</Button>}
                />
              )}
              {servers?.map((s) => (
                <SettingsRow
                  key={s.id}
                  label={
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{s.name}</span>
                      {s.transport === "stdio" && (
                        <span className="rounded bg-surface-chip px-1 py-0.5 text-[11px] font-medium text-ink-icon">stdio</span>
                      )}
                    </span>
                  }
                  help={
                    <span className="flex flex-col gap-0.5">
                      <span className="truncate [overflow-wrap:anywhere]">{s.command || s.url || "—"}</span>
                      <ServerStatus enabled={s.enabled} probe={probes[s.id]} onRetry={() => probe(s.id)} />
                    </span>
                  }
                >
                  <Select
                    label={`Before ${s.name} runs a tool`}
                    value={s.trust_level}
                    onChange={(trust_level) => patch(s.id, { trust_level })}
                    options={TRUST_OPTIONS.map(({ value, label, description }) => ({ value, label, description }))}
                    menuWidth={280}
                  />
                  <Toggle checked={s.enabled} onChange={(enabled) => patch(s.id, { enabled })} label={`Use ${s.name}`} />
                  <IconButton label={`Remove ${s.name}`} onClick={() => setPendingDelete(s)}>
                    <Trash2 />
                  </IconButton>
                </SettingsRow>
              ))}
            </SettingsSection>
          </>
        )}

        {tab === "activity" && (
          <SettingsSection title="Recent tool calls" description="Every call the AI made to an MCP server.">
            {audit === null && <p className="text-sm text-ink-tertiary">Loading…</p>}
            {audit?.length === 0 && <p className="text-sm text-ink-secondary">No tool calls yet.</p>}
            {audit && audit.length > 0 && (
              <ul className="-mt-2 divide-y divide-line">
                {audit.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <span
                      aria-label={e.result_code}
                      className={`size-2 shrink-0 rounded-full ${
                        e.result_code === "ok" ? "bg-emerald-500" : e.result_code === "error" ? "bg-rose-500" : "bg-amber-500"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-ink">{e.server_name}.{e.tool_name}</span>
                    <span className="shrink-0 text-ink-tertiary">
                      {new Date(e.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        )}
      </SettingsPage>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Remove ${pendingDelete?.name ?? "this server"}?`}
        description="The AI stops using its tools. You can add it again later."
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemove}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function ServerStatus({ enabled, probe, onRetry }: { enabled: boolean; probe?: Probe; onRetry: () => void }) {
  if (!enabled) return <span className="text-ink-tertiary">Off: the AI doesn&apos;t use it</span>;
  if (!probe || probe.state === "checking") {
    return (
      <span className="inline-flex items-center gap-1 text-ink-tertiary">
        <Loader2 size={11} className="animate-spin" /> Connecting…
      </span>
    );
  }
  if (probe.state === "error") {
    return (
      <span className="text-ink-danger [overflow-wrap:anywhere]">
        Can&apos;t connect: {probe.error}{" "}
        <button type="button" className="underline" onClick={onRetry}>Retry</button>
      </span>
    );
  }
  return (
    <span className="text-emerald-600 dark:text-emerald-400 [overflow-wrap:anywhere]">
      Connected · {probe.tools.length} {probe.tools.length === 1 ? "tool" : "tools"}
      {probe.tools.length > 0 && <span className="text-ink-tertiary">: {probe.tools.join(", ")}</span>}
    </span>
  );
}
