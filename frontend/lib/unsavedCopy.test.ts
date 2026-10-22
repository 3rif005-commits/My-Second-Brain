import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contentHash, createNoteSaver, dropCopy, keepCopy, planRestore, readCopy, retryDelay,
  type SaveStatus,
} from "./unsavedCopy";

const doc = (text: string) => [{ type: "paragraph", content: [{ type: "text", text }] }];

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("planRestore", () => {
  it("restores when the server still holds the copy's base", () => {
    const copy = { blocks: doc("new"), plainText: "new", base: contentHash(doc("old")), at: 1 };
    expect(planRestore(copy, doc("old"))).toEqual({ action: "restore", copy });
  });
  it("does nothing when the copy was saved after all", () => {
    const copy = { blocks: doc("new"), plainText: "new", base: contentHash(doc("old")), at: 1 };
    expect(planRestore(copy, doc("new"))).toEqual({ action: "none" });
  });
  it("never overwrites a note changed elsewhere since the copy's base", () => {
    const copy = { blocks: doc("mine"), plainText: "mine", base: contentHash(doc("old")), at: 1 };
    expect(planRestore(copy, doc("theirs")).action).toBe("conflict");
  });
  it("ignores the clock entirely", () => {
    const copy = { blocks: doc("new"), plainText: "new", base: contentHash(doc("old")), at: 0 };
    expect(planRestore(copy, doc("old")).action).toBe("restore");
  });
});

describe("copies in storage", () => {
  it("round-trips and rejects junk", () => {
    keepCopy("n1", { blocks: doc("a"), plainText: "a", base: "b", at: 5 });
    expect(readCopy("n1")?.plainText).toBe("a");
    localStorage.setItem("unsaved-note-n2", "{not json");
    expect(readCopy("n2")).toBeNull();
    localStorage.setItem("unsaved-note-n3", JSON.stringify({ blocks: "x" }));
    expect(readCopy("n3")).toBeNull();
  });
  it("dropCopy(at) never removes a newer copy", () => {
    keepCopy("n1", { blocks: doc("b"), plainText: "b", base: "x", at: 9 });
    dropCopy("n1", 5);
    expect(readCopy("n1")?.plainText).toBe("b");
    dropCopy("n1", 9);
    expect(readCopy("n1")).toBeNull();
  });
});

describe("retryDelay", () => {
  it("backs off and caps at 30 s", () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([2000, 4000, 8000, 16000, 30000]);
  });
});

// A fake clock + timer queue, so retries run without waiting.
function harness(send: (b: unknown[]) => Promise<boolean>) {
  let t = 1000;
  const timers: { fn: () => void; due: number }[] = [];
  const statuses: SaveStatus[] = [];
  const saver = createNoteSaver({
    noteId: "n", serverContent: doc("server"), send: (b) => send(b),
    onStatus: (s) => statuses.push(s),
    now: () => t,
    setTimer: (fn, ms) => { const x = { fn, due: t + ms }; timers.push(x); return x; },
    clearTimer: (x) => { const i = timers.indexOf(x as never); if (i >= 0) timers.splice(i, 1); },
  });
  const runTimers = async () => {
    while (timers.length) {
      timers.sort((a, b) => a.due - b.due);
      const x = timers.shift()!;
      t = Math.max(t, x.due);
      x.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { saver, statuses, runTimers, tick: () => { t += 1; } };
}

describe("createNoteSaver", () => {
  it("a failed save says failed, keeps the copy, and retries until it lands", async () => {
    let calls = 0;
    const h = harness(async () => ++calls >= 3);
    await h.saver.save(doc("typed"), "typed");
    expect(h.statuses.at(-1)).toBe("failed");
    expect(readCopy("n")?.plainText).toBe("typed");
    await h.runTimers();
    expect(calls).toBe(3);
    expect(h.statuses.at(-1)).toBe("saved");
    expect(readCopy("n")).toBeNull();
  });

  it("a thrown fetch (offline) is a failure, not a stuck 'Saving…'", async () => {
    const h = harness(async () => { throw new TypeError("Failed to fetch"); });
    await h.saver.save(doc("x"), "x");
    expect(h.statuses).toEqual(["saving", "failed"]);
    h.saver.dispose();
  });

  it("random failures and out-of-order replies never lose the last edit", async () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const server: { text?: string } = {};
    const h = harness(async (b) => {
      await new Promise((r) => setTimeout(r, Math.floor(rand() * 3)));
      if (rand() < 0.5) return false;
      server.text = JSON.stringify(b);
      return true;
    });
    const pending: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) { h.tick(); pending.push(h.saver.save(doc(`v${i}`), `v${i}`)); }
    await Promise.all(pending);
    // Whatever the server got, the newest edit is either confirmed or still kept for retry.
    await h.runTimers();
    const kept = readCopy("n");
    const last = JSON.stringify(doc("v19"));
    expect(kept ? JSON.stringify(kept.blocks) : server.text).toBe(last);
  });

  it("never has two saves in flight; the newest edit is what lands", async () => {
    let inFlight = 0, maxInFlight = 0;
    const landed: string[] = [];
    const h = harness(async (b) => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      landed.push(JSON.stringify(b));
      return true;
    });
    const p = [h.saver.save(doc("a"), "a"), h.saver.save(doc("b"), "b"), h.saver.save(doc("c"), "c")];
    await Promise.all(p);
    await new Promise((r) => setTimeout(r, 20));
    expect(maxInFlight).toBe(1);
    expect(landed).toEqual([JSON.stringify(doc("a")), JSON.stringify(doc("c"))]);
    expect(readCopy("n")).toBeNull();
    expect(h.statuses.at(-1)).toBe("saved");
  });

  it("keepNow records the document without sending (tab closing)", () => {
    const h = harness(async () => true);
    h.saver.keepNow(doc("closing"), "closing");
    const c = readCopy("n")!;
    expect(c.plainText).toBe("closing");
    expect(planRestore(c, doc("server")).action).toBe("restore");
  });
});
