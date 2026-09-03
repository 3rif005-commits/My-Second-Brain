import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));

import { ImportFileButton } from "./ImportFileButton";
import { takeStagedSources } from "@/lib/workspace";

const PDF = new File(["%PDF-1.4"], "lecture.pdf", { type: "application/pdf" });
const NOTES = new File(["# notes"], "notes.md", { type: "text/markdown" });

beforeEach(() => {
  pushMock.mockClear();
  takeStagedSources(); // clear anything a previous test left staged
});
afterEach(() => vi.restoreAllMocks());

describe("ImportFileButton", () => {
  it("stages the picked files and routes into the workspace", async () => {
    const user = userEvent.setup();
    render(<ImportFileButton className="x">Import</ImportFileButton>);

    await user.upload(screen.getByLabelText("Import files into the workspace"), [PDF, NOTES]);

    expect(pushMock).toHaveBeenCalledWith("/brain/workspace");
    expect(takeStagedSources()).toEqual([PDF, NOTES]);
  });

  it("is a button, not a link — the old /brain/ingest link bounced straight back to /brain", () => {
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("offers the same file types the workspace's own picker does", () => {
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    const input = screen.getByLabelText("Import files into the workspace") as HTMLInputElement;
    expect(input.accept).toBe(".pdf,.md,.txt,.mp4,.webm,.mov,.mkv,.m4v");
    expect(input.multiple).toBe(true);
  });

  it("stages nothing and stays put when the picker is dismissed", async () => {
    const user = userEvent.setup();
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    await user.upload(screen.getByLabelText("Import files into the workspace"), []);
    expect(pushMock).not.toHaveBeenCalled();
    expect(takeStagedSources()).toEqual([]);
  });
});

describe("staged sources handoff", () => {
  it("hands the files over exactly once, so a remount cannot re-upload them", async () => {
    const user = userEvent.setup();
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    await user.upload(screen.getByLabelText("Import files into the workspace"), PDF);

    expect(takeStagedSources()).toEqual([PDF]);
    expect(takeStagedSources()).toEqual([]);
  });
});
