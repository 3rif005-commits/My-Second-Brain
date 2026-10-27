import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AboutYouPage from "./page";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const entry = (id: string, content: string, source = "user") =>
  ({ id, content, source, created_at: "2026-10-27T09:00:00Z" });

const LIMITS = { entry: 300, total: 2000, entries: 30 };

function stub(handler: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("About you", () => {
  it("lists what the AI knows, marking what the AI saved", async () => {
    stub(() => json({ entries: [entry("a", "Studies EE"), entry("b", "Prefers French", "assistant")], limits: LIMITS }));
    render(<AboutYouPage />);
    expect(await screen.findByText("Studies EE")).toBeTruthy();
    expect(screen.getByText("Prefers French")).toBeTruthy();
    expect(screen.getAllByText(/Saved by the AI/)).toHaveLength(1);
    expect(screen.getByText(/24\/2,000 used/)).toBeTruthy();
  });

  it("adds an entry and shows the server's reason when one is refused", async () => {
    const fetchMock = stub((url, init) => {
      if (init?.method === "POST") {
        const { content } = JSON.parse(String(init.body));
        return content === "Studies EE"
          ? json({ detail: "Already in About you." }, 400)
          : json(entry("n", content), 201);
      }
      return json({ entries: [entry("a", "Studies EE")], limits: LIMITS });
    });
    render(<AboutYouPage />);
    const input = await screen.findByLabelText("Something the AI should remember");
    fireEvent.change(input, { target: { value: "Prefers short answers" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Prefers short answers")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/memory", expect.objectContaining({ method: "POST" }));

    fireEvent.change(input, { target: { value: "Studies EE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Already in About you.");
  });

  it("removes an entry", async () => {
    const fetchMock = stub((url, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 204 })
        : json({ entries: [entry("a", "Studies EE")], limits: LIMITS }));
    render(<AboutYouPage />);
    fireEvent.click(await screen.findByRole("button", { name: 'Remove "Studies EE"' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/memory/a", { method: "DELETE" }));
    expect(screen.queryByText("Studies EE")).toBeNull();
  });

  it("disables Add when the list is full", async () => {
    stub(() => json({ entries: [entry("a", "x".repeat(1999))], limits: LIMITS }));
    render(<AboutYouPage />);
    const input = await screen.findByLabelText("Something the AI should remember");
    fireEvent.change(input, { target: { value: "ab" } });
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/The list is full/)).toBeTruthy();
  });

  it("explains a missing database migration instead of looking empty", async () => {
    stub(() => json({ detail: "About you needs database migration 032." }, 409));
    render(<AboutYouPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("032");
  });
});
