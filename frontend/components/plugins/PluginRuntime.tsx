"use client";

// Runs the user's enabled plugins inside the brain layout and renders the
// panels they add. Settings → Plugins dispatches PLUGINS_CHANGED after any
// install, update, toggle or uninstall; this reloads from the server then.
import { Component, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { panels, setNavigate, type PanelEntry } from "@/lib/plugins/host";
import { loadPlugin, loadedIds, unloadPlugin, type InstalledPlugin } from "@/lib/plugins/loader";

export const PLUGINS_CHANGED = "plugins-changed";

const NO_PANELS: PanelEntry[] = [];

class PanelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error(`[plugins] panel ${this.props.name} crashed`, e);
  }
  render() {
    // A broken plugin panel disappears; the app keeps going.
    return this.state.failed ? null : this.props.children;
  }
}

/** Calls the plugin's render inside the boundary, so a throw there is caught too. */
function PanelBody({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

const loadedVersion = new Map<string, string>();

async function syncOnce() {
  const r = await fetch("/api/plugins?code=enabled", { cache: "no-store" });
  if (!r.ok) return; // not signed in, or migration 031 missing: no plugins
  const { plugins } = (await r.json()) as { plugins: (InstalledPlugin & { updated_at: string })[] };
  const wanted = new Map(plugins.map((p) => [p.plugin_id, p]));
  for (const id of loadedIds()) if (!wanted.has(id)) unloadPlugin(id);
  for (const p of plugins) {
    // Reload only what changed since this tab loaded it.
    if (loadedVersion.get(p.plugin_id) === p.updated_at && loadedIds().includes(p.plugin_id)) continue;
    loadedVersion.set(p.plugin_id, p.updated_at);
    await loadPlugin(p);
  }
}

// One sync at a time: two overlapping ones could load a plugin twice.
let queue: Promise<void> = Promise.resolve();
function sync() {
  queue = queue.then(syncOnce).catch((e) => console.error("[plugins] sync failed", e));
  return queue;
}

export function PluginRuntime() {
  const router = useRouter();
  const list = useSyncExternalStore(panels.subscribe, panels.list, () => NO_PANELS);

  useEffect(() => {
    setNavigate((path) => router.push(path));
  }, [router]);

  useEffect(() => {
    void sync();
    const onChange = () => void sync();
    window.addEventListener(PLUGINS_CHANGED, onChange);
    return () => window.removeEventListener(PLUGINS_CHANGED, onChange);
  }, []);

  if (list.length === 0) return null;
  return (
    <div
      data-testid="plugin-panels"
      className="pointer-events-none fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2"
    >
      {list.map((p) => (
        <div key={p.key} className="pointer-events-auto" data-plugin={p.pluginId}>
          <PanelBoundary name={p.key}><PanelBody render={p.render} /></PanelBoundary>
        </div>
      ))}
    </div>
  );
}
