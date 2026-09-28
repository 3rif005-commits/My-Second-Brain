import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceTrigger } from "./SourceTrigger";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const OPTIONS = [{ skill: "study-guide", title: "Study guide", usd: 0.05, runnable: null },
  { skill: "flashcards", title: "Flashcards", usd: 0.02, runnable: null }];

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("SourceTrigger", () => {
  it("shows Suggest with no request while it has nothing to run and no trigger is set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ skill: null, skills: [] })));
    render(<SourceTrigger noteId="n1" />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(""));
    expect(screen.getByText(/Suggest/)).toBeTruthy();
  });

  it("turning it on sends the choice and shows the on state", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({ skill: "flashcards" }) : json({ skill: null, skills: OPTIONS }));
    vi.stubGlobal("fetch", f);
    render(<SourceTrigger noteId="n1" />);
    const select = await screen.findByRole("combobox");
    await waitFor(() => expect(select).not.toBeDisabled());
    await userEvent.selectOptions(select, "flashcards");
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/notes/n1/trigger",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ skill: "flashcards" }) }));
    expect(await screen.findByText(/New sources → Flashcards \(background\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /turn off/i })).toBeTruthy();
  });

  it("Turn off clears it", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === "PUT" ? json({ skill: null }) : json({ skill: "study-guide", skills: OPTIONS }));
    vi.stubGlobal("fetch", f);
    render(<SourceTrigger noteId="n1" />);
    await userEvent.click(await screen.findByRole("button", { name: /turn off/i }));
    expect(f).toHaveBeenCalledWith("/api/ws/jobs/notes/n1/trigger",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ skill: null }) }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /turn off/i })).toBeNull());
  });

  it("shows the price for one typical source next to each option", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ skill: null, skills: OPTIONS })));
    render(<SourceTrigger noteId="n1" />);
    const select = await screen.findByRole("combobox");
    await waitFor(() => expect(select).not.toBeDisabled());
    expect(screen.getByRole("option", { name: /Flashcards.*\$0\.02/ })).toBeTruthy();
  });

  it("says why when nothing can run here yet, instead of failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Could not load")));
    render(<SourceTrigger noteId="n1" />);
    expect(await screen.findByText(/Could not load/)).toBeTruthy();
  });
});
