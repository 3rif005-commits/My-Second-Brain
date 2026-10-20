// The plugin host: what pages publish (open notes, open databases), what
// plugins add (panels, styles), and the per-plugin PluginAPI that ties the
// two together. No React in here — the hooks in usePublish.ts and the
// runtime in components/plugins/ are thin layers over this module.
//
// Every registration a plugin makes goes through its own `createPluginAPI`
// scope, so `dispose()` undoes all of it: disabling a plugin can never leave
// a panel, a style or a page subscription behind.
import * as React from "react";
import type {
  DatabaseHandle,
  NoteHandle,
  OpenCallback,
  PluginAPI,
  PluginManifest,
  Unsubscribe,
} from "./api";
import { PLUGIN_API_VERSION } from "./api";
import { CALLOUT_PALETTE } from "@/components/editor/customBlocks";
import { defaultGroupBySpec, getGroupBySpec } from "@/lib/database/types";
import { isFilterableType, operatorsForType } from "@/lib/database/filterOperators";
import { APP_VERSION } from "./manifest";

/** Open pages of one kind. A subscriber hears about every page open now and
 *  later; what it returned for a page runs when that page closes. */
export class Channel<H> {
  private open = new Map<string, H>();
  private subs = new Set<OpenCallback<H>>();
  private cleanups = new Map<OpenCallback<H>, Map<string, () => void>>();

  publish(key: string, handle: H): Unsubscribe {
    this.close(key);
    this.open.set(key, handle);
    for (const cb of this.subs) this.deliver(cb, key, handle);
    return () => {
      if (this.open.get(key) === handle) this.close(key);
    };
  }

  subscribe(cb: OpenCallback<H>): Unsubscribe {
    this.subs.add(cb);
    this.cleanups.set(cb, new Map());
    for (const [key, handle] of this.open) this.deliver(cb, key, handle);
    return () => {
      for (const fn of this.cleanups.get(cb)?.values() ?? []) safely(fn);
      this.cleanups.delete(cb);
      this.subs.delete(cb);
    };
  }

  private deliver(cb: OpenCallback<H>, key: string, handle: H) {
    let cleanup: void | (() => void) = undefined;
    try {
      cleanup = cb(handle);
    } catch (e) {
      console.error("[plugins] page callback threw", e);
    }
    if (typeof cleanup === "function") this.cleanups.get(cb)?.set(key, cleanup);
  }

  private close(key: string) {
    if (!this.open.delete(key)) return;
    for (const perSub of this.cleanups.values()) {
      const fn = perSub.get(key);
      perSub.delete(key);
      if (fn) safely(fn);
    }
  }
}

function safely(fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error("[plugins] cleanup threw", e);
  }
}

export interface PanelEntry {
  key: string;
  pluginId: string;
  render: () => React.ReactNode;
}

/** Panels, as a tiny external store for useSyncExternalStore. */
class PanelStore {
  private panels: PanelEntry[] = [];
  private listeners = new Set<() => void>();

  add(entry: PanelEntry): Unsubscribe {
    this.panels = [...this.panels.filter((p) => p.key !== entry.key), entry];
    this.emit();
    return () => {
      const next = this.panels.filter((p) => p !== entry);
      if (next.length !== this.panels.length) {
        this.panels = next;
        this.emit();
      }
    };
  }
  list = () => this.panels;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private emit() {
    for (const l of this.listeners) l();
  }
}

export const notes = new Channel<NoteHandle>();
export const databases = new Channel<DatabaseHandle>();
export const panels = new PanelStore();

let navigateImpl: (path: string) => void = (path) => {
  window.location.assign(path);
};
/** The runtime installs the Next router here once it mounts. */
export function setNavigate(fn: (path: string) => void) {
  navigateImpl = fn;
}

const STORAGE_PREFIX = "sb-plugin:";

/** The API one plugin sees, plus `dispose` to undo everything it registered. */
export function createPluginAPI(manifest: PluginManifest): { api: PluginAPI; dispose: () => void } {
  const owned = new Set<Unsubscribe>();
  const own = (u: Unsubscribe): Unsubscribe => {
    owned.add(u);
    return () => {
      if (owned.delete(u)) u();
    };
  };
  const storageKey = (k: string) => `${STORAGE_PREFIX}${manifest.id}:${k}`;

  const api: PluginAPI = {
    apiVersion: PLUGIN_API_VERSION,
    appVersion: APP_VERSION,
    manifest,
    react: React,
    workspace: {
      onNoteOpen: (cb) => own(notes.subscribe(cb)),
      onDatabaseOpen: (cb) => own(databases.subscribe(cb)),
      navigate: (path) => navigateImpl(path),
    },
    ui: {
      addPanel: (id, render) =>
        own(panels.add({ key: `${manifest.id}:${id}`, pluginId: manifest.id, render })),
      addStyle: (css) => {
        const el = document.createElement("style");
        el.dataset.plugin = manifest.id;
        el.textContent = css;
        document.head.appendChild(el);
        return own(() => el.remove());
      },
    },
    storage: {
      get: (key) => {
        try {
          const raw = localStorage.getItem(storageKey(key));
          return raw == null ? undefined : JSON.parse(raw);
        } catch {
          return undefined;
        }
      },
      set: (key, value) => {
        try {
          localStorage.setItem(storageKey(key), JSON.stringify(value));
        } catch {
          // storage unavailable (private window): the value lives for this page only
        }
      },
    },
    helpers: {
      calloutPalette: CALLOUT_PALETTE,
      defaultGroupBySpec,
      getGroupBySpec,
      isFilterableType,
      operatorsForType,
    },
  };

  const dispose = () => {
    for (const u of [...owned]) safely(u);
    owned.clear();
  };
  return { api, dispose };
}
