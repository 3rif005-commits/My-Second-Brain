import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { timeAgo } from "./time";

const NOW = new Date("2026-09-13T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("timeAgo", () => {
  it("says just now under a minute", () => {
    expect(timeAgo(ago(30_000))).toBe("just now");
  });

  it("counts minutes under an hour", () => {
    expect(timeAgo(ago(1 * MIN))).toBe("1m ago");
    expect(timeAgo(ago(59 * MIN))).toBe("59m ago");
  });

  it("counts hours under a day", () => {
    expect(timeAgo(ago(60 * MIN))).toBe("1h ago");
    expect(timeAgo(ago(23 * 60 * MIN))).toBe("23h ago");
  });

  it("counts days beyond that", () => {
    expect(timeAgo(ago(24 * 60 * MIN))).toBe("1d ago");
    expect(timeAgo(ago(40 * 24 * 60 * MIN))).toBe("40d ago");
  });
});
