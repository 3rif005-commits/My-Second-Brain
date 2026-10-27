// The Python sandbox: Pyodide (CPython in WebAssembly) in a Web Worker.
//
// OpenShell's idea, done in the browser: code runs where it can reach nothing.
// Never on the server. The walls, from the outside in:
//
//   1. This file is served with its own Content-Security-Policy
//      (next.config.ts): scripts and connections only to the pinned Pyodide
//      folder on jsDelivr. No other host, no dynamic import from anywhere else.
//   2. A worker has no page, no DOM, no cookies, no access to the app's
//      storage or the user's session.
//   3. After Pyodide and the needed packages are loaded, every network and
//      worker-spawning function is removed from this scope, prototype chain
//      included.
//   4. One run per worker. The page terminates it when the run ends or its
//      time is up, so nothing survives between runs.
//
// The code sees only what is in its own text: no notes, no app data.
"use strict";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.5/full/";
// Packages a run may import, beyond the standard library. Fetched before the
// network is cut; anything else is refused with a plain message.
const ALLOWED = new Set(["numpy", "matplotlib", "pandas", "sympy", "scipy"]);
const MAX_OUT = 100_000;      // characters of stdout/stderr kept
const MAX_IMAGES = 5;

const CUT = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport",
  "importScripts", "Worker", "SharedWorker", "BroadcastChannel", "indexedDB", "caches"];

function cutNetwork() {
  for (const name of CUT) {
    for (let o = self; o; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, name)) {
        try {
          Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false });
        } catch (_) { /* a non-configurable one: CSP still blocks it */ }
      }
    }
  }
}

function capped(parts) {
  const text = parts.join("\n");
  return text.length > MAX_OUT ? text.slice(0, MAX_OUT) + "\n… (output cut)" : text;
}

const FIGURES = `
import sys
_sb_images = []
if "matplotlib.pyplot" in sys.modules:
    import io, base64
    import matplotlib.pyplot as _plt
    for _n in _plt.get_fignums()[:${MAX_IMAGES}]:
        _buf = io.BytesIO()
        _plt.figure(_n).savefig(_buf, format="png", dpi=100, bbox_inches="tight")
        _sb_images.append(base64.b64encode(_buf.getvalue()).decode())
    _plt.close("all")
_sb_images
`;

self.onmessage = async (event) => {
  const code = event && event.data && typeof event.data.code === "string" ? event.data.code : null;
  if (code === null) return;
  self.onmessage = null;                          // one run per worker
  const stdout = [], stderr = [];
  try {
    importScripts(PYODIDE + "pyodide.js");
    const pyodide = await self.loadPyodide({ indexURL: PYODIDE });
    const imports = pyodide.pyimport("pyodide.code").find_imports(code).toJs();
    const wanted = [...new Set(imports.map((m) => String(m).split(".")[0]))];
    const needed = wanted.filter((m) => ALLOWED.has(m));
    const stdlib = new Set(pyodide.runPython("import sys; sorted(sys.stdlib_module_names)").toJs());
    const missing = wanted.filter((m) => !ALLOWED.has(m) && !stdlib.has(m));
    if (missing.length) {
      self.postMessage({ type: "done", ok: false, stdout: "", stderr: "",
        error: `Not available in the sandbox: ${missing.join(", ")}. Available: ${[...ALLOWED].join(", ")} and the standard library.` });
      return;
    }
    if (needed.length) await pyodide.loadPackage(needed);
    pyodide.runPython("import os; os.environ['MPLBACKEND'] = 'Agg'");
    cutNetwork();
    self.postMessage({ type: "ready" });          // the page's run clock starts here
    pyodide.setStdout({ batched: (s) => stdout.push(s) });
    pyodide.setStderr({ batched: (s) => stderr.push(s) });
    let value = await pyodide.runPythonAsync(code);
    const result = value === undefined || value === null ? null : String(value).slice(0, 10_000);
    if (value && typeof value.destroy === "function") value.destroy();
    const images = pyodide.runPython(FIGURES).toJs().map(String);
    self.postMessage({ type: "done", ok: true, stdout: capped(stdout), stderr: capped(stderr), result, images });
  } catch (e) {
    self.postMessage({ type: "done", ok: false, stdout: capped(stdout), stderr: capped(stderr),
      error: String(e && e.message ? e.message : e).slice(-4000) });
  }
};
