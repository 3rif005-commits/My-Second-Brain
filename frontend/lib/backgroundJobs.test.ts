import { describe, expect, it } from "vitest";
import { agoText, clockText, priceLine, stateLine, tonight, usdText, whenText, type BgJob } from "./backgroundJobs";

const at = (h: number, day = 28) => new Date(2026, 8, day, h, 0, 0);

describe("usdText", () => {
  it("never prints $0.000 for a free model, and unknown is not free", () => {
    expect(usdText(0)).toBe("free");
    expect(usdText(null)).toBe("price unknown");
    expect(usdText(0.004)).toBe("$0.004");
    expect(usdText(0.041)).toBe("$0.04");
  });
});

describe("tonight", () => {
  it("is 22:00 today before 22:00, tomorrow's after", () => {
    expect(tonight(at(15))).toEqual(at(22));
    expect(tonight(at(23))).toEqual(at(22, 29));
    expect(tonight(at(22))).toEqual(at(22, 29));   // exactly 22:00 is already now
  });
});

describe("whenText", () => {
  it("says tonight, tomorrow, or the weekday", () => {
    expect(whenText(at(22), at(15))).toBe("tonight at 22:00");
    expect(whenText(at(22, 29), at(15))).toBe("tomorrow at 22:00");
    expect(whenText(at(22, 30), at(15))).toMatch(/at 22:00$/);
    expect(clockText(new Date(2026, 8, 28, 7, 5))).toBe("07:05");
  });
});

describe("priceLine", () => {
  const now = at(15);
  it("shows the price mode, the estimate and when", () => {
    expect(priceLine("normal", 0.08, at(22), now)).toBe("Normal price · ≈$0.08 · runs tonight at 22:00");
    expect(priceLine("batch", 0.04, at(22), now)).toBe("Half price · ≈$0.04 · runs tonight at 22:00");
  });
  it("is honest about free, unknown and local", () => {
    expect(priceLine("normal", 0, at(22), now)).toBe("Free · runs tonight at 22:00");
    expect(priceLine("normal", null, at(22), now)).toBe("Price unknown · runs tonight at 22:00");
    expect(priceLine("local", 0, at(22), now)).toContain("needs the app running");
    expect(priceLine("normal", 0, at(22), now)).not.toContain("0.000");
  });
});

describe("stateLine", () => {
  const job = (over: Partial<BgJob>): BgJob => ({
    id: "j", note_id: "n", skill: "flashcards", focus: "", status: "queued", trigger: "run_later",
    price_mode: "normal", run_after: at(22).toISOString(), shown_estimate_usd: 0.04, actual_usd: null,
    model: null, ran_late: false, error: null, cancel_reason: null, result_title: null,
    created_at: at(15).toISOString(), finished_at: null, ...over });
  it("names the wait, the failure and the cancel", () => {
    expect(stateLine(job({}), at(15))).toBe("Queued · runs tonight at 22:00");
    expect(stateLine(job({ run_after: at(15).toISOString() }), at(15))).toBe("Queued · starting in a moment");
    expect(stateLine(job({ status: "submitted" }))).toBe("Running now");
    expect(stateLine(job({ status: "failed", error: "no sources are ready yet" }))).toBe("Failed — no sources are ready yet");
    expect(stateLine(job({ status: "cancelled", cancel_reason: "by you" }))).toBe("Cancelled — by you");
  });
});

describe("agoText", () => {
  it("is coarse and never negative", () => {
    const now = at(15);
    expect(agoText(at(15).toISOString(), now)).toBe("just now");
    expect(agoText(at(12).toISOString(), now)).toBe("3h ago");
    expect(agoText(at(16).toISOString(), now)).toBe("just now");
    expect(agoText(null, now)).toBe("");
  });
});
