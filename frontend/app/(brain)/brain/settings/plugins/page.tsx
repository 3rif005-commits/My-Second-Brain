"use client";

// Settings → Plugins: add features without changing the app, like Obsidian's
// community plugins. Approved plugins (lib/plugins/approved.ts) install with
// one click; anything else installs from a link after a warning, because a
// plugin runs with your account's access. Install, update, on/off and
// uninstall all go through /api/plugins; the running tab picks the change up
// through PLUGINS_CHANGED (components/plugins/PluginRuntime.tsx).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/ui/Settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/Toggle";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PLUGINS_CHANGED } from "@/components/plugins/PluginRuntime";
import { APPROVED_PLUGINS } from "@/lib/plugins/approved";
import { pluginStatus } from "@/lib/plugins/loader";
import type { PluginManifest } from "@/lib/plugins/api";

interface Installed {
  plugin_id: string;
  manifest: PluginManifest;
  source: string;
  enabled: boolean;
  updated_at: string;
}

const NO_STATUS = new Map();

async function call(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
  return data;
}
const post = (url: string, body?: unknown) =>
  call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export default function PluginsPage() {
  const [installed, setInstalled] = useState<Installed[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [confirmLink, setConfirmLink] = useState(false);
  const [removing, setRemoving] = useState<Installed | null>(null);
  const status = useSyncExternalStore(pluginStatus.subscribe, pluginStatus.get, () => NO_STATUS);

  const load = useCallback(async () => {
    try {
      const data = await call("/api/plugins");
      setInstalled(data.plugins);
    } catch (e) {
      setInstalled([]);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<string | void>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const msg = await action();
      if (msg) setNotice(msg);
      window.dispatchEvent(new Event(PLUGINS_CHANGED));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const install = (source: string) =>
    run(`install:${source}`, async () => {
      const { manifest } = await post("/api/plugins", { source });
      return `${manifest.name} ${manifest.version} is installed and on.`;
    });

  const isInstalled = (id: string) => installed?.some((p) => p.plugin_id === id);

  return (
    <SettingsPage
      title="Plugins"
      description="Add features to Second Brain without changing the app. Plugins are turned on for your account and run in this browser."
    >
      {(error || notice) && (
        <p role={error ? "alert" : "status"} className={error ? "text-sm text-ink-danger" : "text-sm text-ink-secondary"}>
          {error || notice}
        </p>
      )}

      <SettingsSection title="Installed">
        {installed === null && <p className="text-sm text-ink-secondary">Loading…</p>}
        {installed?.length === 0 && <p className="text-sm text-ink-secondary">No plugins yet.</p>}
        {installed?.map((p) => {
          const s = status.get(p.plugin_id);
          const state = !p.enabled ? "Off" : s?.state === "failed" ? `Failed: ${s.error}` : s?.state === "running" ? "Running" : "Starting…";
          return (
            <SettingsRow
              key={p.plugin_id}
              label={p.manifest.name}
              badge={`v${p.manifest.version}`}
              help={
                <>
                  {p.manifest.description && <span className="block">{p.manifest.description}</span>}
                  <span className="block">
                    {p.manifest.author ? `${p.manifest.author} · ` : ""}from {p.source}
                  </span>
                  <span data-testid={`plugin-state-${p.plugin_id}`} className={s?.state === "failed" && p.enabled ? "block text-ink-danger" : "block"}>
                    {state}
                  </span>
                </>
              }
            >
              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(`update:${p.plugin_id}`, async () => {
                    const r = await post(`/api/plugins/${encodeURIComponent(p.plugin_id)}/update`);
                    return r.updated ? `${r.manifest.name} updated to ${r.manifest.version}.` : `${p.manifest.name} is up to date.`;
                  })
                }
              >
                {busy === `update:${p.plugin_id}` ? "Checking…" : "Update"}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setRemoving(p)}>
                Uninstall
              </Button>
              <Toggle
                label={`${p.manifest.name} on`}
                checked={p.enabled}
                disabled={busy !== null}
                onChange={(enabled) =>
                  run(`toggle:${p.plugin_id}`, () =>
                    call(`/api/plugins/${encodeURIComponent(p.plugin_id)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ enabled }),
                    }),
                  )
                }
              />
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Approved plugins" description="Reviewed by the Second Brain project.">
        {APPROVED_PLUGINS.map((a) => (
          <SettingsRow key={a.id} label={a.name} help={`${a.description} · ${a.author}`}>
            {isInstalled(a.id) ? (
              <span className="text-sm text-ink-secondary">Installed</span>
            ) : (
              <Button disabled={busy !== null || installed === null} onClick={() => install(a.source)}>
                {busy === `install:${a.source}` ? "Installing…" : "Install"}
              </Button>
            )}
          </SettingsRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Install from a link">
        <SettingsRow
          stacked
          htmlFor="plugin-link"
          label="GitHub repo or plugin folder"
          help="owner/repo installs that repo's latest release (manifest.json + main.js). An https link must point at a folder holding both files."
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) setConfirmLink(true);
            }}
          >
            <Input
              id="plugin-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="owner/repo or https://…/my-plugin/"
              className="flex-1"
            />
            <Button type="submit" variant="secondary" disabled={busy !== null || !link.trim()}>
              Install…
            </Button>
          </form>
        </SettingsRow>
      </SettingsSection>

      <ConfirmDialog
        open={confirmLink}
        title="Install a plugin that isn't approved?"
        description="A plugin runs with your account's access: it can read, change and delete your notes. Only install code from someone you trust."
        confirmLabel="Install anyway"
        onCancel={() => setConfirmLink(false)}
        onConfirm={() => {
          setConfirmLink(false);
          void install(link.trim()).then(() => setLink(""));
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        title={`Uninstall ${removing?.manifest.name ?? ""}?`}
        description="It stops at once. Your notes are not changed; you can install it again later."
        confirmLabel="Uninstall"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const p = removing!;
          setRemoving(null);
          void run(`remove:${p.plugin_id}`, () =>
            call(`/api/plugins/${encodeURIComponent(p.plugin_id)}`, { method: "DELETE" }),
          );
        }}
      />
    </SettingsPage>
  );
}
