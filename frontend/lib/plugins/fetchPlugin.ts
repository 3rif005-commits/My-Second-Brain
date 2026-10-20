// Server only: download a plugin's manifest.json + main.js from its source.
//
// Runs on the server because GitHub's release downloads send no CORS header,
// so a browser cannot fetch them. Fetching a user-supplied URL from the server
// is the classic SSRF shape, hence: https only, every hop's host resolved and
// refused if it points at a private, loopback or link-local address,
// redirects followed by hand (so each hop is checked), a timeout and a size cap.
//
// PLUGINS_GITHUB_TOKEN (optional, server env) lets installs read releases of
// private repos; it is sent to api.github.com only, never to a redirect target.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { PluginManifest } from "./api";
import { parseManifest, type PluginSource } from "./manifest";

const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST = 64 * 1024;
const MAX_CODE = 5 * 1024 * 1024;

export interface FetchedPlugin {
  manifest: PluginManifest;
  code: string;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      s === "::" || s === "::1" ||
      s.startsWith("fc") || s.startsWith("fd") ||
      /^fe[89ab]/.test(s) || s.startsWith("ff")
    );
  }
  return true; // not an address at all: refuse
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== "https:") throw new Error("Plugin downloads must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`${url.hostname} is not a public address`);
  }
}

/** GET with every redirect hop checked; resolves with the final response. */
async function safeGet(input: string, accept: string): Promise<Response> {
  let url = new URL(input);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    const headers: Record<string, string> = { Accept: accept, "User-Agent": "second-brain-plugin-installer" };
    const token = process.env.PLUGINS_GITHUB_TOKEN;
    if (token && url.hostname === "api.github.com") headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { redirect: "manual", signal, headers, cache: "no-store" });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error(`Redirect without a location from ${url.hostname}`);
      url = new URL(next, url);
      continue;
    }
    if (!res.ok) throw new Error(`${url.hostname} answered ${res.status} for ${url.pathname}`);
    return res;
  }
  throw new Error("Too many redirects");
}

async function readCapped(res: Response, max: number, what: string): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new Error(`${what} is too large`);
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error(`${what} is too large`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

interface FileUrls { manifest: string; code: string; accept: string }

async function fileUrls(src: PluginSource): Promise<FileUrls> {
  if (src.kind === "url") {
    return { manifest: `${src.base}manifest.json`, code: `${src.base}main.js`, accept: "*/*" };
  }
  const res = await safeGet(
    `https://api.github.com/repos/${src.owner}/${src.repo}/releases/latest`,
    "application/vnd.github+json",
  );
  const release = JSON.parse(await readCapped(res, 1024 * 1024, "The release listing")) as {
    assets?: { name: string; url: string }[];
  };
  // The asset's API url (not browser_download_url): it serves the bytes with
  // Accept: application/octet-stream and works for private repos too.
  const asset = (name: string) => release.assets?.find((a) => a.name === name)?.url;
  const manifest = asset("manifest.json");
  const code = asset("main.js");
  if (!manifest || !code) {
    throw new Error(`The latest release of ${src.owner}/${src.repo} needs manifest.json and main.js attached`);
  }
  return { manifest, code, accept: "application/octet-stream" };
}

export async function fetchPlugin(src: PluginSource): Promise<FetchedPlugin> {
  const urls = await fileUrls(src);
  const manifestText = await readCapped(await safeGet(urls.manifest, urls.accept), MAX_MANIFEST, "manifest.json");
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }
  const manifest = parseManifest(raw);
  const code = await readCapped(await safeGet(urls.code, urls.accept), MAX_CODE, "main.js");
  if (!code.trim()) throw new Error("main.js is empty");
  return { manifest, code };
}
