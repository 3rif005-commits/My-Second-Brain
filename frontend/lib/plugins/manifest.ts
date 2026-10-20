// Plugin manifests: parse, check compatibility, resolve install sources.
// Pure — used by the /api/plugins routes (server) and the runtime (browser).
import type { PluginManifest } from "./api";
import { PLUGIN_API_VERSION } from "./api";
import pkg from "@/package.json";

export const APP_VERSION: string = pkg.version;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION = /^\d+(\.\d+){0,2}([-+][\w.-]+)?$/;

/** A manifest.json body → a PluginManifest, or an Error saying what is wrong. */
export function parseManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest.json is not a JSON object");
  const m = raw as Record<string, unknown>;
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string).trim() : undefined);
  const id = str("id");
  const name = str("name");
  const version = str("version");
  if (!id || !ID.test(id)) throw new Error("manifest.json needs an id: lowercase letters, digits and dashes");
  if (!name) throw new Error("manifest.json needs a name");
  if (!version || !VERSION.test(version)) throw new Error("manifest.json needs a version like 1.0.0");
  const minAppVersion = str("minAppVersion");
  if (minAppVersion && !VERSION.test(minAppVersion)) throw new Error("minAppVersion must look like 1.0.0");
  const apiVersion = m.apiVersion === undefined ? undefined : Number(m.apiVersion);
  if (apiVersion !== undefined && (!Number.isInteger(apiVersion) || apiVersion < 1)) {
    throw new Error("apiVersion must be a whole number, 1 or more");
  }
  return {
    id,
    name: name.slice(0, 80),
    version,
    description: str("description")?.slice(0, 300),
    author: str("author")?.slice(0, 80),
    minAppVersion,
    apiVersion,
  };
}

/** "1.10.0" >= "1.9.2"; missing parts count as 0. Pre-release tags are ignored. */
export function versionAtLeast(have: string, need: string): boolean {
  const parts = (v: string) => v.split(/[-+]/)[0].split(".").map((n) => parseInt(n, 10) || 0);
  const a = parts(have);
  const b = parts(need);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** Why this manifest can't run in this app, or null when it can. */
export function incompatibility(m: PluginManifest): string | null {
  if ((m.apiVersion ?? 1) > PLUGIN_API_VERSION) {
    return `needs plugin API v${m.apiVersion}; this app has v${PLUGIN_API_VERSION}`;
  }
  if (m.minAppVersion && !versionAtLeast(APP_VERSION, m.minAppVersion)) {
    return `needs app ${m.minAppVersion} or newer; this is ${APP_VERSION}`;
  }
  return null;
}

/** Where to fetch a plugin from. `owner/repo` means the repo's latest GitHub
 *  release (assets manifest.json + main.js, Obsidian's layout); an https URL
 *  is a folder that holds both files. */
export type PluginSource =
  | { kind: "github"; owner: string; repo: string }
  | { kind: "url"; base: string };

const GITHUB_SHORT = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;
const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

/** `allowLocal` (dev only, PLUGINS_ALLOW_LOCAL=1) also accepts http, so a
 *  plugin author can install straight from a local `npx serve dist`. */
export function parseSource(input: string, { allowLocal = false } = {}): PluginSource {
  const s = input.trim();
  const m = GITHUB_SHORT.exec(s) ?? GITHUB_URL.exec(s);
  if (m) return { kind: "github", owner: m[1], repo: m[2] };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error("Enter a GitHub repo (owner/repo) or an https link to a plugin folder");
  }
  if (url.protocol !== "https:" && !(allowLocal && url.protocol === "http:")) {
    throw new Error("Plugin links must use https");
  }
  if (url.username || url.password) throw new Error("Plugin links can't contain a login");
  url.hash = "";
  url.search = "";
  let base = url.toString();
  // A link straight to one of the two files means its folder.
  base = base.replace(/\/(manifest\.json|main\.js)$/, "/");
  if (!base.endsWith("/")) base += "/";
  return { kind: "url", base };
}

/** The canonical text stored as `source`, so the same plugin from the same
 *  place always compares equal. */
export function sourceKey(src: PluginSource): string {
  return src.kind === "github" ? `${src.owner}/${src.repo}` : src.base;
}
