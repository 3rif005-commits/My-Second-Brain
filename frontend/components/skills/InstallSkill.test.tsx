import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InstallSkillDialog } from "./InstallSkillDialog";
import { InstalledNotice } from "./InstalledNotice";
import type { Skill } from "@/lib/skills";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const PREVIEW = {
  name: "summarise", description: "Summarise a note.", body: "Summarise in 5 bullets.",
  files: ["SKILL.md", "references/style.md"], skipped: ["scripts/"], warnings: [],
  source: "https://github.com/acme/skills/tree/main/summarise", pin: "a".repeat(40), content_hash: "h1",
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Install a skill", () => {
  it("shows the whole skill first, then installs exactly the previewed content", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/skills/install-preview" ? json(PREVIEW) : json({ name: "summarise", title: "Summarise" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const onInstalled = vi.fn();
    render(<InstallSkillDialog open onClose={() => {}} onInstalled={onInstalled} />);
    fireEvent.change(screen.getByLabelText("Skill link"), { target: { value: PREVIEW.source } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Summarise in 5 bullets.")).toBeTruthy();
    expect(screen.getByText(/Not installed: scripts\//)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);                  // nothing saved yet
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/skills/install", expect.objectContaining({
      body: JSON.stringify({ url: PREVIEW.source, content_hash: "h1" }),
    }));
  });

  it("shows warnings and refusals", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/skills/install-preview"
      ? json({ ...PREVIEW, warnings: ["sends something to an outside address"] })
      : json({ detail: "The skill changed since you previewed it. Preview it again." }, 400)));
    render(<InstallSkillDialog open onClose={() => {}} onInstalled={() => {}} />);
    fireEvent.change(screen.getByLabelText("Skill link"), { target: { value: PREVIEW.source } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/outside address/);
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(await screen.findByText(/changed since you previewed/)).toBeTruthy();
  });
});

describe("An installed skill's updates", () => {
  const skill = { name: "summarise", title: "Summarise", origin: "installed", source_url: PREVIEW.source,
                  pin: "a".repeat(40) } as unknown as Skill;

  it("shows the change as a diff and applies it only on Update", async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/check-update")
      ? json({ ...PREVIEW, up_to_date: false, pin: "b".repeat(40), content_hash: "h2",
               diff: "--- before/SKILL.md\n+++ after/SKILL.md\n-5 bullets\n+3 bullets" })
      : json({ ...skill, pin: "b".repeat(40) }));
    vi.stubGlobal("fetch", fetchMock);
    const onUpdated = vi.fn();
    render(<InstalledNotice skill={skill} onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Check for update" }));
    expect(await screen.findByText("+3 bullets")).toBeTruthy();
    expect(onUpdated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/skills/summarise/update",
      expect.objectContaining({ body: JSON.stringify({ content_hash: "h2" }) }));
  });

  it("says when it is up to date", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ up_to_date: true })));
    render(<InstalledNotice skill={skill} onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Check for update" }));
    expect(await screen.findByText("Up to date.")).toBeTruthy();
  });
});
