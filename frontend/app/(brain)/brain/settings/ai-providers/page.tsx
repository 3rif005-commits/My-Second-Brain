"use client";

// Settings → AI Providers: user API keys for the provider-agnostic AI layer.
// The backend routes each job (summaries, formula OCR, video understanding,
// chat) to the best configured provider and falls back to the local model.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/ui/Settings";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";

interface ProviderRow {
  id: string;
  provider: string;
  label: string;
  base_url: string | null;
  chat_model: string | null;
  enabled: boolean;
  api_key_hint: string;
}

const PROVIDER_INFO: Record<string, { name: string; caps: string; keyUrl: string }> = {
  gemini: {
    name: "Google Gemini",
    caps: "text · vision · native video/PDF understanding",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    name: "Anthropic Claude",
    caps: "text · vision",
    keyUrl: "https://console.anthropic.com/",
  },
  openai: {
    name: "OpenAI",
    caps: "text · vision",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  openai_compatible: {
    name: "OpenAI-compatible endpoint",
    caps: "text (OpenRouter, Groq, local gateways…)",
    keyUrl: "",
  },
};

export default function AiProvidersPage() {
  const [rows, setRows] = useState<ProviderRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    provider: "gemini", api_key: "", label: "", base_url: "", chat_model: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderRow | null>(null);

  const load = () =>
    fetch("/api/ws/ai-providers")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRows)
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  async function add() {
    setError(null);
    const res = await fetch("/api/ws/ai-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: form.provider,
        api_key: form.api_key,
        label: form.label || PROVIDER_INFO[form.provider]?.name,
        base_url: form.base_url || null,
        chat_model: form.chat_model || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.detail?.error || body?.error || `HTTP ${res.status}`);
      return;
    }
    setForm({ provider: "gemini", api_key: "", label: "", base_url: "", chat_model: "" });
    setShowForm(false);
    load();
  }

  async function toggle(row: ProviderRow) {
    await fetch(`/api/ws/ai-providers/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !row.enabled }),
    });
    load();
  }

  async function confirmRemove() {
    if (!pendingDelete) return;
    const row = pendingDelete;
    setPendingDelete(null);
    await fetch(`/api/ws/ai-providers/${row.id}`, { method: "DELETE" });
    load();
  }

  const info = PROVIDER_INFO[form.provider];

  // Notion's settings layout: a section of provider rows (name, capabilities and
  // key hint on the left; an enable toggle and remove on the right), then an
  // "Add provider" form laid out as setting rows.
  return (
    <div>
      <SettingsPage
        title="AI providers"
        description="Workspace AI (summaries, formula → LaTeX, video understanding, grounded chat) picks the best configured provider per job and falls back to the local model."
        actions={!showForm ? <Button icon={<Plus />} onClick={() => setShowForm(true)}>Add provider</Button> : undefined}
      >
        <SettingsSection title="Providers">
          {error && <p className="text-sm text-ink-danger">{error}</p>}
          {rows?.map((row) => (
            <SettingsRow
              key={row.id}
              label={
                <span className="flex items-center gap-2">
                  {row.label}
                  <span className="rounded bg-surface-chip px-1 py-0.5 font-mono text-[11px] font-medium text-ink-icon">{row.api_key_hint}</span>
                </span>
              }
              help={`${PROVIDER_INFO[row.provider]?.caps ?? ""}${row.chat_model ? ` · ${row.chat_model}` : ""}`}
            >
              <Toggle checked={row.enabled} onChange={() => toggle(row)} label={`Enable ${row.label}`} />
              <IconButton label={`Remove ${row.label}`} size={28} onClick={() => setPendingDelete(row)}>
                <Trash2 />
              </IconButton>
            </SettingsRow>
          ))}
          {rows !== null && rows.length === 0 && (
            <p className="text-sm text-ink-secondary">
              No providers configured — server .env keys and the local Gemma model are used.
            </p>
          )}
          {rows === null && !error && <p className="text-sm text-ink-tertiary">Loading…</p>}
        </SettingsSection>

        {showForm && (
          <SettingsSection title="Add a provider">
            <SettingsRow label="Provider" help={info?.caps}>
              <Select
                label="Provider"
                value={form.provider}
                onChange={(provider) => setForm({ ...form, provider })}
                options={Object.entries(PROVIDER_INFO).map(([k, v]) => ({ value: k, label: v.name }))}
              />
            </SettingsRow>
            <SettingsRow
              stacked
              label="API key"
              htmlFor="provider-key"
              help={
                info?.keyUrl ? (
                  <>
                    Get a key at{" "}
                    <a className="underline" href={info.keyUrl} target="_blank" rel="noreferrer">
                      {info.keyUrl.replace(/^https?:\/\//, "")}
                    </a>
                    . It is encrypted before it is stored.
                  </>
                ) : (
                  "It is encrypted before it is stored."
                )
              }
            >
              <Input
                id="provider-key"
                inputSize="lg"
                className="max-w-[400px]"
                type="password"
                placeholder="API key"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              />
            </SettingsRow>
            {form.provider === "openai_compatible" && (
              <SettingsRow stacked label="Base URL" htmlFor="provider-url">
                <Input
                  id="provider-url"
                  inputSize="lg"
                  className="max-w-[400px]"
                  placeholder="https://openrouter.ai/api/v1"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                />
              </SettingsRow>
            )}
            <SettingsRow stacked label="Model override" help="Optional. Leave empty to use the provider's default." htmlFor="provider-model">
              <Input
                id="provider-model"
                inputSize="lg"
                className="max-w-[400px]"
                placeholder="e.g. claude-sonnet-5-5"
                value={form.chat_model}
                onChange={(e) => setForm({ ...form, chat_model: e.target.value })}
              />
            </SettingsRow>
            <div className="flex gap-2">
              <Button onClick={add} disabled={!form.api_key.trim()}>
                Add provider
              </Button>
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </SettingsSection>
        )}
      </SettingsPage>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Remove ${pendingDelete?.label ?? "this provider"}?`}
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
