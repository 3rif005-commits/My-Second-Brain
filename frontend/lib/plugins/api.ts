// The Plugin API — the ONLY surface a plugin may use. This file is the
// contract: packages/plugin-api publishes its types to npm, so a change here
// is a change for every plugin author. Add freely; to change or remove
// something, bump PLUGIN_API_VERSION and keep the old shape working for a
// release. Plan: docs/REPO_CONSOLIDATION_PLAN.md (Part 1).
import type * as ReactNS from "react";
import type {
  DatabaseRow,
  Group,
  PropertyResponse,
  PropertyValue,
  ViewResponse,
} from "@/lib/database/types";

export const PLUGIN_API_VERSION = 1;

export type Unsubscribe = () => void;

/** A BlockNote block, as much of it as plugins can rely on. */
export interface Block {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
}

/** manifest.json, next to main.js. */
export interface PluginManifest {
  /** Stable, lowercase, dashes: "webmcp". Also the storage key. */
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  /** Oldest app version that can run this plugin ("0.2.0"). */
  minAppVersion?: string;
  /** Plugin API version it was built against; defaults to 1. */
  apiVersion?: number;
}

/** What main.js must default-export. */
export interface Plugin {
  onload(api: PluginAPI): void | Promise<void>;
  /** Everything registered through `api` is undone by the host anyway;
   *  this is for what the plugin set up on its own (timers, globals). */
  onunload?(): void;
}

/** Something on screen whose state changes while it stays open. `current()`
 *  is always the latest state; `subscribe` fires after it changed. */
export interface LiveHandle<S> {
  current(): S;
  subscribe(listener: () => void): Unsubscribe;
}

export interface NoteState {
  id: string;
  title: string;
  mastery: string | null;
  topics: string[];
}

export interface NoteHandle extends LiveHandle<NoteState> {
  /** The live document, unsaved edits included. Null while the editor mounts. */
  getBlocks(): Block[] | null;
  /** Parse Markdown and append it at the end of the note; it is saved. */
  appendMarkdown(markdown: string): Promise<void>;
  /** "not_started" | "learning" | "reviewing" | "mastered" */
  setMastery(status: string): Promise<void>;
}

export interface DatabaseState {
  name: string;
  dataSourceId: string;
  properties: PropertyResponse[];
  views: ViewResponse[];
  activeViewId: string | null;
  rows: DatabaseRow[];
  groups: Group[] | null;
}

export interface DatabaseHandle extends LiveHandle<DatabaseState> {
  /** Switch view exactly as clicking its tab does (the URL follows). */
  selectView(viewId: string): void;
  updateCell(rowId: string, propertyKey: string, value: PropertyValue | null): Promise<void>;
  updateView(viewId: string, patch: Record<string, unknown>): Promise<ViewResponse>;
  refetchRows(): Promise<void> | void;
}

/** A note or database page "opening" calls `cb` with its handle; what `cb`
 *  returns runs when that page closes. Already-open pages are reported at
 *  once, so a plugin enabled mid-session sees what is on screen. */
export type OpenCallback<H> = (handle: H) => void | (() => void);

export interface PluginAPI {
  apiVersion: number;
  appVersion: string;
  manifest: PluginManifest;
  /** The app's React. Plugins must not bundle their own (hooks would break). */
  react: typeof ReactNS;

  workspace: {
    onNoteOpen(cb: OpenCallback<NoteHandle>): Unsubscribe;
    onDatabaseOpen(cb: OpenCallback<DatabaseHandle>): Unsubscribe;
    /** Client-side navigation, e.g. navigate(`/brain/${noteId}`). */
    navigate(path: string): void;
  };

  ui: {
    /** A floating panel over the brain pages (bottom-right, stacked). */
    addPanel(id: string, render: () => ReactNS.ReactNode): Unsubscribe;
    /** A <style> owned by this plugin; removed when it unloads. */
    addStyle(css: string): Unsubscribe;
  };

  /** Small per-user key/value store for this plugin (this browser only). */
  storage: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };

  /** App helpers plugins commonly need, so they stay in step with the app. */
  helpers: {
    calloutPalette: Record<string, { color: string; icon: string; label: string }>;
    defaultGroupBySpec: typeof import("@/lib/database/types").defaultGroupBySpec;
    getGroupBySpec: typeof import("@/lib/database/types").getGroupBySpec;
    isFilterableType: typeof import("@/lib/database/filterOperators").isFilterableType;
    operatorsForType: typeof import("@/lib/database/filterOperators").operatorsForType;
  };
}
