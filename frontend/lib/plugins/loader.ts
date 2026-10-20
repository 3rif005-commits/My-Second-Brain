// Turn stored plugin code into a running plugin, and back.
//
// main.js is an ES module whose default export is a Plugin. It is imported
// from a blob: URL, so it runs with the app's origin and the user's session —
// the same trust model as an Obsidian community plugin, which is why
// Settings → Plugins warns before installing anything not on the approved list.
//
// Plugins must use the app's React (two copies break hooks). Their build maps
// `react` and `react/jsx-runtime` onto window.__secondBrainPluginHost.
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import type { Plugin, PluginManifest } from "./api";
import { createPluginAPI } from "./host";
import { incompatibility } from "./manifest";

export interface InstalledPlugin {
  plugin_id: string;
  manifest: PluginManifest;
  code: string;
}

export type PluginStatus = { state: "running" } | { state: "failed"; error: string };

interface Loaded {
  plugin: Plugin;
  dispose: () => void;
}

const loaded = new Map<string, Loaded>();
const status = new Map<string, PluginStatus>();
const listeners = new Set<() => void>();
let statusSnapshot: ReadonlyMap<string, PluginStatus> = new Map();

function setStatus(id: string, s: PluginStatus | null) {
  if (s) status.set(id, s);
  else status.delete(id);
  statusSnapshot = new Map(status);
  for (const l of listeners) l();
}

/** For Settings → Plugins: which plugins run in this tab, and why one failed. */
export const pluginStatus = {
  get: () => statusSnapshot,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

function exposeHost() {
  (window as unknown as Record<string, unknown>).__secondBrainPluginHost = { React, jsxRuntime };
}

async function importModule(code: string): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadPlugin(p: InstalledPlugin): Promise<void> {
  unloadPlugin(p.plugin_id);
  const why = incompatibility(p.manifest);
  if (why) {
    setStatus(p.plugin_id, { state: "failed", error: why });
    return;
  }
  exposeHost();
  const { api, dispose } = createPluginAPI(p.manifest);
  try {
    const mod = (await importModule(p.code)) as { default?: unknown };
    const plugin = mod.default as Plugin | undefined;
    if (!plugin || typeof plugin.onload !== "function") {
      throw new Error("main.js must default-export an object with onload(api)");
    }
    loaded.set(p.plugin_id, { plugin, dispose });
    await plugin.onload(api);
    setStatus(p.plugin_id, { state: "running" });
  } catch (e) {
    // A plugin that fails to start must leave nothing behind.
    loaded.delete(p.plugin_id);
    dispose();
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[plugins] ${p.manifest.name} failed to load`, e);
    setStatus(p.plugin_id, { state: "failed", error });
  }
}

export function unloadPlugin(id: string) {
  const l = loaded.get(id);
  if (!l) {
    setStatus(id, null);
    return;
  }
  loaded.delete(id);
  try {
    l.plugin.onunload?.();
  } catch (e) {
    console.error(`[plugins] ${id} onunload threw`, e);
  }
  l.dispose();
  setStatus(id, null);
}

export function unloadAll() {
  for (const id of [...loaded.keys()]) unloadPlugin(id);
}

export function loadedIds(): string[] {
  return [...loaded.keys()];
}
