import { describe, expect, it } from "vitest";
import { acceptLabel, agoText, clockText, priceLine, stateLine, tonight, usdText, whenText, type BgJob } from "./backgroundJobs";

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
    expect(priceLine("batch", 0.04, at(22), now))
      .toBe("Half price · ≈$0.04 · sent tonight at 22:00, ready within a few hours");
    expect(priceLine("batch", 0.04, at(22), now, 0.08))
      .toBe("Half price · ≈$0.04 (now $0.08) · sent tonight at 22:00, ready within a few hours");
    // no "now" price when there is no saving to show
    expect(priceLine("batch", 0.04, at(22), now, 0.04)).not.toContain("(now");
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
    expect(stateLine(job({ status: "submitted", price_mode: "batch" })))
      .toBe("Sent · half price · usually under an hour, at most 24 hours");
    expect(stateLine(job({ status: "expired", error: null })))
      .toBe("Not finished within 24 hours by the provider. Nothing was charged.");
    expect(stateLine(job({ status: "failed", error: "no sources are ready yet" }))).toBe("Failed — no sources are ready yet");
    expect(stateLine(job({ status: "cancelled", cancel_reason: "by you" }))).toBe("Cancelled — by you");
    // the server's refusal already begins "Not started" — never say it twice
    expect(stateLine(job({ status: "budget_blocked", error: "Not started — about $0.05 would pass your $0.01 monthly limit" })))
      .toBe("Not started — about $0.05 would pass your $0.01 monthly limit");
    expect(stateLine(job({ status: "budget_blocked", error: "over the monthly limit" }))).toBe("Not started — over the monthly limit");
  });
});

describe("acceptLabel", () => {
  it("names the price the user is asked to accept", () => {
    expect(acceptLabel({ result_meta: { now_usd: 0.08 } })).toBe("Run at $0.08");
    expect(acceptLabel({ result_meta: {} })).toBe("Run at the new price");
    expect(acceptLabel({})).toBe("Run at the new price");
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

import { costLine, costText, monthLine, timeline, triggerText, whenShort, type ActivityJob } from "./backgroundJobs";

const done = (over: Partial<ActivityJob> = {}): ActivityJob => ({
  id: "j", note_id: "n", skill: "flashcards", focus: "", status: "applied", trigger: "run_later",
  price_mode: "normal", run_after: at(22).toISOString(), shown_estimate_usd: 0.04, actual_usd: 0.041,
  model: null, ran_late: false, error: null, cancel_reason: null, result_title: null,
  created_at: at(15).toISOString(), finished_at: null, note_title: "Lecture 10",
  live_equivalent_usd: null, result_meta: {}, started_at: null, applied_at: null, discarded_at: null, ...over });

describe("costText", () => {
  it("is $0 for a job that never reached the model, free for local, unknown for unpriced", () => {
    expect(costText(done({ status: "cancelled", actual_usd: null }))).toBe("$0");
    expect(costText(done({ status: "budget_blocked", actual_usd: null }))).toBe("$0");
    expect(costText(done({ status: "applied", actual_usd: 0, price_mode: "local" }))).toBe("free");
    expect(costText(done({ status: "applied", actual_usd: null, result_meta: { input_tokens: 10, output_tokens: 5 } }))).toBe("price unknown");
    expect(costText(done({ actual_usd: 0.041 }))).toBe("$0.04");
  });
});

describe("costText after a dismissed refusal", () => {
  it("shows $0 for a job that never reached the model, wherever it ended up", () => {
    expect(costText(done({ status: "discarded", actual_usd: 0, result_meta: {} }))).toBe("$0");
    expect(costText(done({ status: "discarded", actual_usd: 0,
      result_meta: { input_tokens: 800, output_tokens: 400 } }))).toBe("free");   // a free model that ran
    expect(costText(done({ status: "failed", actual_usd: null }))).toBe("—");       // spend unknown, not $0
  });
  it("explains a zero in the expanded row", () => {
    expect(costLine(done({ actual_usd: 0, result_meta: {} }))).toMatch(/never reached the model/);
    expect(costLine(done({ actual_usd: 0, result_meta: { input_tokens: 5 } }))).toBe("Free");
  });
});

describe("costLine", () => {
  it("claims a saving only for batch jobs with both prices", () => {
    expect(costLine(done({ price_mode: "batch", actual_usd: 0.041, live_equivalent_usd: 0.082 })))
      .toBe("Paid $0.04 · the same job run now would be $0.08 · saved $0.04");
    expect(costLine(done({ price_mode: "normal", actual_usd: 0.08, live_equivalent_usd: 0.08 }))).toBe("Paid $0.08");
    expect(costLine(done({ price_mode: "batch", actual_usd: 0.04, live_equivalent_usd: null }))).toBe("Paid $0.04");
    expect(costLine(done({ price_mode: "normal", actual_usd: null }))).toBe("Price unknown");
    expect(costLine(done({ price_mode: "local", actual_usd: null }))).toBe("Free");
  });
});

describe("monthLine", () => {
  it("shows spent of cap, and the saving only when there is one", () => {
    expect(monthLine(0.43, 5, 0.39)).toBe("This month: $0.43 of $5.00 · saved $0.39");
    expect(monthLine(0, 5, 0)).toBe("This month: $0 of $5.00");
  });
});

describe("words", () => {
  it("names the trigger, the day and the timeline", () => {
    expect(triggerText("source_added")).toBe("New source");
    expect(triggerText("mystery")).toBe("mystery");
    expect(whenShort(at(22, 25).toISOString(), at(15))).toMatch(/22:00$/);
    expect(whenShort(new Date(2026, 7, 1, 9).toISOString(), at(15))).toMatch(/Aug|1/);
    const t = timeline(done({ started_at: at(22).toISOString(), applied_at: at(23).toISOString() }));
    expect(t.map((s) => s.label)).toEqual(["queued", "started", "applied"]);
    expect(t[0].at).not.toContain("(");           // one time per step, not two
  });
});
