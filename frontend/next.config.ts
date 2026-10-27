import type { NextConfig } from "next";
import os from "os";

function localNetworkHosts(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
}

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
const SANDBOX_CSP = [
  "default-src 'none'",
  `script-src ${PYODIDE} 'wasm-unsafe-eval'`,
  `connect-src ${PYODIDE}`,
].join("; ");

const nextConfig: NextConfig = {
  allowedDevOrigins: localNetworkHosts(),
  async headers() {
    return [
      {
        source: "/manifest.json",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        // The Python sandbox (public/sandbox/python-worker.js). A worker takes
        // the CSP of its own script: it may load scripts and data from the
        // pinned Pyodide folder only, and connect nowhere else. Keep the
        // version here and in the worker the same.
        source: "/sandbox/python-worker.js",
        headers: [
          { key: "Content-Type", value: "application/javascript" },
          { key: "Cache-Control", value: "no-cache" },
          { key: "Content-Security-Policy", value: SANDBOX_CSP },
        ],
      },
      {
        // Service worker needs to run from root scope
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  // Transpile BlockNote client packages so Turbopack deduplicates Yjs.
  // @blocknote/xl-ai is NOT here — it's in serverExternalPackages so that
  // Node.js loads it natively (its server bundle requires ESM-only peer deps
  // that can't be bundled via CJS require).
  transpilePackages: [
    "@blocknote/core",
    "@blocknote/react",
    "@blocknote/mantine",
    "@handlewithcare/prosemirror-inputrules",
    "@handlewithcare/prosemirror-suggest-changes",
  ],
  // Let Node.js load @blocknote/xl-ai as a native ESM module for API routes.
  serverExternalPackages: ["@blocknote/xl-ai"],
  turbopack: {},
};

export default nextConfig;
