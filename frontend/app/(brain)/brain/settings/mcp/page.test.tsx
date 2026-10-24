import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import McpSettingsPage from "./page";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const server = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, transport: "http", command: null, url: `https://${id}.dev/mcp`,
  enabled: true, trust_level: "read_only", created_at: "2026-10-24T09:00:00Z", ...over,
});

function stubApi(servers: unknown[], tools: Record<string, unknown>, stdio_allowed = false) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/mcp-servers" && !init?.method) return json({ servers, stdio_allowed });
    const m = url.match(/^\/api\/mcp-servers\/([^/]+)\/tools$/);
    if (m) return json(tools[m[1]]);
    return init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("MCP servers settings", () => {
  it("shows each server's live tools, or why it has none", async () => {
    stubApi([server("deepwiki"), server("broken")], {
      deepwiki: { tools: [{ name: "mcp.deepwiki.ask_wiki_question" }, { name: "mcp.deepwiki.read_wiki_structure" }], error: null },
      broken: { tools: [], error: "Name or service not known" },
    });
    render(<McpSettingsPage />);
    expect(await screen.findByText(/Connected · 2 tools/)).toBeTruthy();
    expect(screen.getByText(/ask_wiki_question, read_wiki_structure/)).toBeTruthy();
    expect(await screen.findByText(/Can't connect: Name or service not known/)).toBeTruthy();
  });

  it("offers stdio only where the backend allows it", async () => {
    stubApi([], {});
    const { unmount } = render(<McpSettingsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Add server/ }))[0]);
    expect(screen.queryByRole("button", { name: "Connection" })).toBeNull();
    unmount();

    stubApi([], {}, true);
    render(<McpSettingsPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Add server/ }))[0]);
    expect(await screen.findByRole("button", { name: "Connection" })).toBeTruthy();
  });

  it("removes through the in-app dialog, never window.confirm", async () => {
    const fetchMock = stubApi([server("deepwiki")], { deepwiki: { tools: [], error: null } });
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<McpSettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove deepwiki" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers/deepwiki", { method: "DELETE" }));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
