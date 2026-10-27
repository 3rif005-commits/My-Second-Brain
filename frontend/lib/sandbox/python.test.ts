import { afterEach, describe, expect, it, vi } from "vitest";

import { readResult, runPython } from "./python";

/** A stand-in Worker driven by the test. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(m: unknown) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

afterEach(() => { vi.useRealTimers(); });

describe("runPython", () => {
  it("runs once per worker and ends it", async () => {
    const w = new FakeWorker();
    const phases: string[] = [];
    const p = runPython("print(1)", { makeWorker: () => w as unknown as Worker, onPhase: (x) => phases.push(x) });
    expect(w.posted).toEqual([{ code: "print(1)" }]);
    w.emit({ type: "ready" });
    w.emit({ type: "done", ok: true, stdout: "1", stderr: "", result: null, images: [] });
    expect(await p).toMatchObject({ ok: true, stdout: "1" });
    expect(phases).toEqual(["loading", "running"]);
    expect(w.terminated).toBe(true);
  });

  it("kills a run that goes past its time", async () => {
    vi.useFakeTimers();
    const w = new FakeWorker();
    const p = runPython("while True: pass", { makeWorker: () => w as unknown as Worker, runMs: 3000 });
    w.emit({ type: "ready" });
    vi.advanceTimersByTime(3001);
    expect(await p).toMatchObject({ ok: false, error: "Stopped after 3 s." });
    expect(w.terminated).toBe(true);
  });

  it("kills a load that never finishes, and stops on request", async () => {
    vi.useFakeTimers();
    const w1 = new FakeWorker();
    const p1 = runPython("1", { makeWorker: () => w1 as unknown as Worker, loadMs: 1000 });
    vi.advanceTimersByTime(1001);
    expect((await p1).error).toMatch(/took too long/);
    const w2 = new FakeWorker();
    const ctl = new AbortController();
    const p2 = runPython("1", { makeWorker: () => w2 as unknown as Worker, signal: ctl.signal });
    ctl.abort();
    expect((await p2).error).toBe("Stopped.");
    expect(w2.terminated).toBe(true);
  });
});

describe("readResult — the worker's message is untrusted", () => {
  it("keeps only valid base64 PNG images, at most five", () => {
    const r = readResult({ ok: true, images: ["iVBORw0KGgo=", "javascript:alert(1)", "<svg onload=x>", ...Array(9).fill("AAAA")] });
    expect(r.images).toEqual(["iVBORw0KGgo=", "AAAA", "AAAA", "AAAA", "AAAA"]);
  });

  it("drops fields of the wrong type and caps text", () => {
    const r = readResult({ ok: "yes", stdout: { html: "<b>" }, result: 5, error: "x".repeat(10_000) });
    expect(r.ok).toBe(false);
    expect(r.stdout).toBe("");
    expect(r.result).toBeNull();
    expect(r.error!.length).toBe(4000);
  });
});
