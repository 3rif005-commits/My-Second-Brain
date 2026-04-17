import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
