import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SkillDraftCard } from "./SkillDraftCard";

const DRAFT = {
  name: "weekly-review", description: "Review the week's notes.",
  body: "1. List notes.\n2. Summarise.", where: "assistant" as const, warnings: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("SkillDraftCard", () => {
  it("saves exactly what it shows, after the user's edits", async () => {
    const fetchMock = vi.fn(async () => json({ name: "weekly-review-2" }, 201));
    vi.stubGlobal("fetch", fetchMock);
    render(<SkillDraftCard draft={DRAFT} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "weekly-review-2" } });
    fireEvent.change(screen.getByLabelText("Instructions"), { target: { value: "1. Only this." } });
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/drafts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "weekly-review-2", description: DRAFT.description,
                             body: "1. Only this.", where: "assistant" }),
    }));
  });

  it("saves nothing on Dismiss", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SkillDraftCard draft={DRAFT} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByText(/Nothing was saved/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows warnings and the server's refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "A skill named 'weekly-review' already exists. Pick another name." }, 409)));
    render(<SkillDraftCard draft={{ ...DRAFT, warnings: ["tells the AI to ignore its instructions"], hidden_removed: true }} />);
    expect(screen.getByRole("alert").textContent).toMatch(/ignore its instructions.*Hidden characters were removed/);
    fireEvent.click(screen.getByRole("button", { name: "Save skill" }));
    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
  });
});
