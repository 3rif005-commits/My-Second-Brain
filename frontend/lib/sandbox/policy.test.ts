import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The sandbox's outer wall is the CSP next.config.ts sends with the worker.
// Verified in Chrome (2026-10-27): with this policy Pyodide, numpy and
// matplotlib run, and fetch, XHR, importScripts, Worker, pyfetch, eval and
// new Function are all refused. These tests stop the two from drifting apart.
const root = join(__dirname, "..", "..");
const worker = readFileSync(join(root, "public/sandbox/python-worker.js"), "utf8");
const config = readFileSync(join(root, "next.config.ts"), "utf8");

describe("sandbox policy", () => {
  it("pins the same Pyodide folder in the worker and the CSP", () => {
    const inWorker = worker.match(/const PYODIDE = "([^"]+)"/)?.[1];
    const inConfig = config.match(/const PYODIDE = "([^"]+)"/)?.[1];
    expect(inWorker).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/pyodide\/v\d+\.\d+\.\d+\/full\/$/);
    expect(inConfig).toBe(inWorker);
  });

  it("allows no eval, no other host, and nothing by default", () => {
    expect(config).toContain(`"default-src 'none'"`);
    expect(config).toContain("`script-src ${PYODIDE} 'wasm-unsafe-eval'`");
    expect(config).toContain("`connect-src ${PYODIDE}`");
    expect(config).not.toMatch(/'unsafe-eval'/);
    expect(config).toContain('source: "/sandbox/python-worker.js"');
  });

  it("cuts the network before the code runs", () => {
    expect(worker.indexOf("cutNetwork();")).toBeLessThan(worker.indexOf("runPythonAsync(code)"));
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "Worker"]) {
      expect(worker).toContain(`"${name}"`);
    }
  });
});
