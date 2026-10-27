import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { OpenPicker, type PickerItem } from "./OpenPicker";

const SESSION: PickerItem[] = [
  { key: "n:home", kind: "note", title: "Cv (2)", hint: "session note" },
  { key: "n:two", kind: "note", title: "Untitled" },
  { key: "ask", kind: "ask", title: "Ask AI", keys: "Ctrl+J" },
];
const NOTES = [
  { id: "a", title: "Lecture 10", updated_at: "2026-10-18T10:00:00Z" },
  { id: "b", title: "Reading list", updated_at: "2026-10-12T10:00:00Z" },
];

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: true, json: async () => ({ id: "new1", title: JSON.parse(String(init.body)).title ?? null }) };
    if (url.startsWith("/api/notes")) return { ok: true, json: async () => NOTES };
    return { ok: true, json: async () => [] }; // library sources
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const props = {
    session: SESSION,
    sessionNoteIds: new Set(["home", "two"]),
    sessionSourceIds: new Set<string>(),
    onOpen: vi.fn(),
    onOpenNote: vi.fn(),
    onAddFiles: vi.fn(),
    onAddUrl: vi.fn(),
    onClose: vi.fn(),
  };
  const user = userEvent.setup();
  render(<OpenPicker {...props} />);
  return { props, user };
}

describe("OpenPicker", () => {
  it("is one list under one heading per kind, with the add actions in a bar", async () => {
    setup();
    expect(await screen.findByText("Lecture 10")).toBeInTheDocument();
    expect(screen.getByText("In this session")).toBeInTheDocument();
    expect(screen.getByText("Recent notes")).toBeInTheDocument();
    // the one-row "New" and "Add to this session" headings are gone
    expect(screen.queryByText("New")).not.toBeInTheDocument();
    expect(screen.queryByText("Add to this session")).not.toBeInTheDocument();
    // the bar, and no second "new note" button in the search box
    expect(screen.getByRole("button", { name: "New note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste link" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New note" })).toHaveLength(1);
  });

  it("Enter opens the highlighted row here, Alt+Enter beside", async () => {
    const { props, user } = setup();
    await screen.findByText("Lecture 10");
    expect(screen.getByText("Open here")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(props.onOpen).toHaveBeenLastCalledWith("n:home", false);
    await user.keyboard("{ArrowDown}{Alt>}{Enter}{/Alt}");
    expect(props.onOpen).toHaveBeenLastCalledWith("n:two", true);
  });

  it("the button on a row opens it beside", async () => {
    const { props, user } = setup();
    await screen.findByText("Lecture 10");
    await user.click(screen.getAllByTitle("Open beside (Alt+↵)", { exact: false })[0]);
    expect(props.onOpen).toHaveBeenCalledWith("n:home", true);
  });

  it("opens another note from the list", async () => {
    const { props, user } = setup();
    await user.click(await screen.findByText("Lecture 10"));
    expect(props.onOpenNote).toHaveBeenCalledWith("a", "Lecture 10", false);
  });

  it("arrows step down into the bar, and the footer says what Enter does there", async () => {
    const { user } = setup();
    await screen.findByText("Lecture 10");
    // 3 session rows + 2 notes = 5 rows; the 6th stop is New note, then Upload
    await user.keyboard("{ArrowDown}".repeat(6));
    expect(screen.getByText("Create here")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Choose files to add to this session")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByText(/web page or YouTube link/)).toBeInTheDocument();
    await user.keyboard("{ArrowUp}"); // out of the bar, onto the last row
    expect(screen.getByText("Open here")).toBeInTheDocument();
  });

  it("typing with no match leaves New note chosen, so Enter creates it", async () => {
    const { props, user } = setup();
    await screen.findByText("Lecture 10");
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(await screen.findByText("Nothing matches “zzz”")).toBeInTheDocument();
    expect(screen.getByText("Create “zzz” here")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(props.onOpenNote).toHaveBeenCalledWith("new1", "zzz", false));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body)).toEqual({ title: "zzz" });
  });

  it("bolds what you typed in the matching titles", async () => {
    const { user } = setup();
    await screen.findByText("Lecture 10");
    await user.type(screen.getByRole("combobox"), "lect");
    expect(screen.getByText("Lect").tagName).toBe("SPAN");
    expect(screen.queryByText("Reading list")).not.toBeInTheDocument();
  });

  it("Enter typed in the link dialog adds the link and nothing else", async () => {
    const { props, user } = setup();
    await screen.findByText("Lecture 10");
    await user.click(screen.getByRole("button", { name: "Paste link" }));
    await user.type(await screen.findByPlaceholderText(/https:/), "https://example.com{Enter}");
    expect(props.onAddUrl).toHaveBeenCalledWith("https://example.com");
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it("Esc closes", async () => {
    const { props, user } = setup();
    await screen.findByText("Lecture 10");
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});
