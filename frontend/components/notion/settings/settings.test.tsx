import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
vi.mock("@/context/NotionContext", () => ({
  useNotion: () => ({ open, mirror: { connected: true, notes: { a: "synced", b: "changed", c: "changed", d: "private" }, collections: {} }, refresh: vi.fn() }),
}));

import { ActivitySection } from "./ActivitySection";
import { HealthSection } from "./HealthSection";
import { MirrorSection } from "./MirrorSection";
import { RulesSection } from "./RulesSection";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function route(map: Record<string, (init?: RequestInit) => Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/ws/", "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const k = Object.keys(map).sort((a, b) => b.length - a.length).find((x) => path.startsWith(x));
    return k ? map[k](init) : json({}, 404);
  }));
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); open.mockClear(); });

describe("MirrorSection", () => {
  it("counts the mirror states, flips an include switch, and opens whole-brain send", async () => {
    const include = { collections: true, notes: true, databases: true, embedded_files: true, source_files: false, threads: false, skills: false };
    const calls = route({ "notion/include": (init) => json({ include: init?.method === "PUT" ? { ...include, threads: true } : include }) });
    render(<MirrorSection />);
    const counts = await screen.findByTestId("mirror-counts");
    expect(counts).toHaveTextContent("1 in sync");
    expect(counts).toHaveTextContent("2 changed");
    expect(counts).toHaveTextContent("1 private (not sent)");
    const sw = await screen.findByRole("switch", { name: "Chat threads" });
    await waitFor(() => expect(sw).not.toBeDisabled());
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    await waitFor(() => expect(calls).toContain("PUT notion/include"));
    expect(screen.getByRole("switch", { name: "Chat threads" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: /Send all changes/ }));
    expect(open).toHaveBeenCalledWith({ all: true }, "whole brain");
  });
});

describe("RulesSection", () => {
  it("turns whole-brain auto-sync on and off", async () => {
    let rules: unknown[] = [];
    const calls = route({ "notion/rules": (init) => {
      if (init?.method === "POST") { rules = [{ id: "r1", scope_kind: "all", scope_id: null, mode: "daily", include: {} }]; return json(rules[0]); }
      if (init?.method === "DELETE") { rules = []; return json({ deleted: "r1" }); }
      return json({ rules });
    } });
    render(<RulesSection />);
    const pick = async (option: string) => {
      await userEvent.click(await screen.findByRole("button", { name: "Whole brain auto-sync" }));
      await userEvent.click(await screen.findByRole("option", { name: new RegExp(option) }));
    };
    await pick("Once a day");
    await waitFor(() => expect(calls).toContain("POST notion/rules"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Whole brain auto-sync" })).toHaveTextContent("Once a day"));
    await pick("Off");
    await waitFor(() => expect(calls).toContain("DELETE notion/rules/r1"));
  });
  it("says what auto-sync will never do", async () => {
    route({ "notion/rules": () => json({ rules: [] }) });
    render(<RulesSection />);
    expect(await screen.findByText(/never sends a private note/)).toBeTruthy();
  });
});

describe("ActivitySection", () => {
  const run = { id: "r1", trigger: "manual", status: "partial", counts: { done: 2, problems: 1 }, requests_used: 14, created_at: "2026-10-09T10:00:00Z", started_at: "2026-10-09T10:00:00Z", finished_at: null };
  it("says so when nothing was sent, and lists runs with a plain status", async () => {
    route({ "notion/runs": () => json({ runs: [] }) });
    const { unmount } = render(<ActivitySection />);
    expect(await screen.findByTestId("activity-empty")).toBeTruthy();
    unmount();
    route({ "notion/runs": () => json({ runs: [run] }) });
    render(<ActivitySection />);
    expect(await screen.findByText("Partly done")).toBeTruthy();
    expect(screen.getByText(/2 sent · 1 problem\(s\) · 14 requests/)).toBeTruthy();
  });
  it("expands a run, shows why an item failed, and retries the failed ones", async () => {
    const calls = route({
      "notion/runs/r1/retry": () => json({ status: "queued", run_id: "r2" }),
      "notion/runs/r1": () => json({ ...run, items: [{ id: "i1", kind: "note", local_id: "n", title: "Lecture", action: "create", status: "failed", error_class: "retryable", message: "Notion isn't responding." }] }),
      "notion/runs": () => json({ runs: [run] }),
    });
    render(<ActivitySection />);
    await userEvent.click(await screen.findByText("Partly done"));
    expect(await screen.findByText("Notion isn't responding.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(calls).toContain("POST notion/runs/r1/retry"));
  });
});

describe("HealthSection", () => {
  const health = { status: "active", last_ok_at: new Date().toISOString(), api_version: "2026-03-11", mappings: {}, failing: 1,
    rate_limit_waits_recent: 3, token_problem: false, canary: { ok: false, when: new Date().toISOString(), api_version: "2026-03-11", failed: ["text blocks: send succeeds"] } };
  it("shows the facts, a failing canary by name, and the kill switch", async () => {
    const calls = route({ "notion/health": () => json(health), "notion/pause": () => json({ connected: true, status: "paused" }),
      "backup": () => json({ enabled: false, folder: "/home/x/SecondBrainBackups/abc", archives: [{ name: "b.sbz", bytes: 2048 }] }) });
    const onChanged = vi.fn();
    render(<HealthSection paused={false} onChanged={onChanged} />);
    const h = await screen.findByTestId("health");
    expect(h).toHaveTextContent("2026-03-11 (pinned)");
    expect(screen.getByTestId("canary")).toHaveTextContent("text blocks: send succeeds");
    await userEvent.click(screen.getByRole("button", { name: "Pause all syncing" }));
    await waitFor(() => expect(calls).toContain("POST notion/pause"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await screen.findByText(/Daily backups are off/)).toBeTruthy();
    expect(screen.queryByText(/BACKUP_ENABLED|python -m/)).toBeNull();     // no developer instructions
  });
  it("backs up now and reports what it saved", async () => {
    route({ "notion/health": () => json(health), "backup/run": () => json({ path: "p", bytes: 5 << 20, counts: { notes: 12, databases: 2, threads: 3 }, problems: [], pruned: [] }),
      "backup": () => json({ enabled: true, folder: "/f", archives: [] }) });
    render(<HealthSection paused onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: "Resume syncing" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Backed up 12 notes, 2 databases, 3 chats (5.0 MB).");
  });
  it("on a hosted server, offers the backup as a download (its disk is wiped on deploy)", async () => {
    route({ "notion/health": () => json(health),
      "backup": () => json({ enabled: false, hosted: true, folder: "/opt/render/SecondBrainBackups/abc", archives: [{ name: "sb-2026.sbz", bytes: 2048 }] }) });
    render(<HealthSection paused={false} onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: "Make backup" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute("href", "/api/ws/backup/sb-2026.sbz");
    expect(screen.queryByText(/opt\/render/)).toBeNull();
    expect(screen.getByText(/disk is wiped/)).toBeTruthy();
  });
});
