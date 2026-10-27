// Run Python in the browser sandbox (public/sandbox/python-worker.js) and get
// its output back as plain data. Each run gets a new worker and is killed when
// it ends or its time is up — a stuck loop cannot keep anything running.
//
// What comes back is treated as untrusted data: only the expected fields, as
// text, and images only as validated base64 PNG.

export const WORKER_URL = "/sandbox/python-worker.js";
/** Loading Pyodide and packages the first time can take a while (~10 MB+). */
export const LOAD_TIMEOUT_MS = 120_000;
/** The code itself, once loaded. */
export const RUN_TIMEOUT_MS = 20_000;

export interface PythonRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** repr of the last expression, if any */
  result: string | null;
  /** base64 PNG images (matplotlib figures) */
  images: string[];
  error?: string;
}

export type Phase = "loading" | "running";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_CHARS = 3_000_000;

function text(v: unknown, max = 100_500): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Only the shape we expect, from a message the code inside could forge. */
export function readResult(data: unknown): PythonRun {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const images = Array.isArray(d.images)
    ? d.images.filter((i): i is string => typeof i === "string" && i.length <= MAX_IMAGE_CHARS && BASE64.test(i)).slice(0, 5)
    : [];
  return {
    ok: d.ok === true,
    stdout: text(d.stdout),
    stderr: text(d.stderr),
    result: typeof d.result === "string" ? d.result.slice(0, 10_000) : null,
    images,
    ...(d.ok === true ? {} : { error: text(d.error, 4000) || "The run failed." }),
  };
}

export function runPython(
  code: string,
  opts: { onPhase?: (p: Phase) => void; signal?: AbortSignal;
          makeWorker?: () => Worker; loadMs?: number; runMs?: number } = {},
): Promise<PythonRun> {
  return new Promise((resolve) => {
    const worker = opts.makeWorker ? opts.makeWorker() : new Worker(WORKER_URL);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const finish = (r: PythonRun) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker.terminate();
      opts.signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    const fail = (error: string) => finish({ ok: false, stdout: "", stderr: "", result: null, images: [], error });
    const arm = (ms: number, why: string) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fail(why), ms);
    };
    const onAbort = () => fail("Stopped.");

    opts.signal?.addEventListener("abort", onAbort);
    worker.onmessage = (e: MessageEvent) => {
      const d = e.data as { type?: unknown } | null;
      if (d && d.type === "ready") {
        opts.onPhase?.("running");
        arm(opts.runMs ?? RUN_TIMEOUT_MS, `Stopped after ${Math.round((opts.runMs ?? RUN_TIMEOUT_MS) / 1000)} s.`);
      } else if (d && d.type === "done") {
        finish(readResult(d));
      }
    };
    worker.onerror = (e: ErrorEvent) => { e.preventDefault?.(); fail(e.message || "The sandbox could not start."); };
    opts.onPhase?.("loading");
    arm(opts.loadMs ?? LOAD_TIMEOUT_MS, "Loading Python took too long. Check the connection and try again.");
    worker.postMessage({ code });
  });
}
