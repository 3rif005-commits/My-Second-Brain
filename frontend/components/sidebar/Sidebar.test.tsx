import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const navigateMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigateMock, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/brain",
}));

vi.mock("@/app/providers", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: vi.fn() } }),
}));

vi.mock("@/lib/hooks/useNotes", () => ({
  useNotes: () => ({
    notes: [],
    loading: false,
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    toggleFavorite: vi.fn(),
    reorderNotes: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/useCollections", () => ({
  useCollections: () => ({ collections: [], loading: false }),
}));
vi.mock("@/lib/hooks/useTrash", () => ({
  useTrash: () => ({ trashedNotes: [], restoreNote: vi.fn(), permanentDelete: vi.fn() }),
}));
vi.mock("./NoteTree", () => ({ NoteTree: () => <div /> }));

import { Sidebar } from "./Sidebar";

const LIST = {
  databases: [
    { database: { id: "db-1", title: "Tasks", icon: null } },
    { database: { id: "db-2", title: "Reading list", icon: "📚" } },
  ],
};

beforeEach(() => {
  navigateMock.mockClear();
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/api/db/databases")) {
      return { ok: true, json: async () => LIST } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe("Sidebar — Databases section", () => {
  it("lists the user's databases from GET /db/databases", async () => {
    render(<Sidebar />);
    expect(await screen.findByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Reading list")).toBeInTheDocument();
    // The section header only renders when there is at least one database.
    expect(screen.getByText("Databases")).toBeInTheDocument();
  });

  it("navigates to a database's own page when one is clicked", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(await screen.findByText("Tasks"));
    expect(navigateMock).toHaveBeenCalledWith("/brain/db/db-1");
  });

  it("keeps the Databases section with an empty state when the user has none — it carries the only create affordance", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ databases: [] }),
    })) as unknown as typeof fetch;
    render(<Sidebar />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(screen.getByText("No databases yet")).toBeInTheDocument();
  });

  it("stays rendered when the databases request fails — a sidebar list is not worth breaking the sidebar", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    render(<Sidebar />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    // The rest of the nav is still there.
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("No databases yet")).toBeInTheDocument();
  });

  it("collapses and expands the Databases section", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(await screen.findByRole("button", { name: /Databases/ }));
    expect(screen.queryByText("Tasks")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Databases/ }));
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });
});

describe("Sidebar — database creation menu", () => {
  it("offers both a blank database and CSV import behind one '+' — neither is a top-level nav row any more", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await screen.findByText("Tasks");

    // Removed entirely: their features are gone from the app.
    expect(screen.queryByText("AI Tutor")).not.toBeInTheDocument();
    expect(screen.queryByText("Import Knowledge")).not.toBeInTheDocument();
    expect(screen.queryByText("All Notes")).not.toBeInTheDocument();
    // Folded into the menu below rather than sitting in the nav.
    expect(screen.queryByText("New Database")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "New database" }));
    expect(screen.getByRole("menuitem", { name: /Blank database/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Import CSV/ })).toBeInTheDocument();
  });

  it("creates a blank database and navigates to it", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/api/db/databases") && init?.method === "POST") {
        return { ok: true, json: async () => ({ database: { id: "db-new" } }) } as Response;
      }
      return { ok: true, json: async () => LIST } as Response;
    }) as unknown as typeof fetch;

    render(<Sidebar />);
    await screen.findByText("Tasks");
    await user.click(screen.getByRole("button", { name: "New database" }));
    await user.click(screen.getByRole("menuitem", { name: /Blank database/ }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/brain/db/db-new"));
  });

  it("closes the menu on Escape", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await screen.findByText("Tasks");
    await user.click(screen.getByRole("button", { name: "New database" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
