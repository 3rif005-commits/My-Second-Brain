import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { ImportFileButton, INGEST_FILE_EVENT } from "./ImportFileButton";

const FILE = new File(["hello"], "notes.txt", { type: "text/plain" });

afterEach(() => vi.restoreAllMocks());

describe("ImportFileButton", () => {
  it("announces the picked file on the window event the layout listens for", async () => {
    const heard = vi.fn();
    window.addEventListener(INGEST_FILE_EVENT, heard);

    const user = userEvent.setup();
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    await user.upload(screen.getByLabelText("Import a document"), FILE);

    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0][0] as CustomEvent<File>).detail).toBe(FILE);
    window.removeEventListener(INGEST_FILE_EVENT, heard);
  });

  it("never navigates — the old /brain/ingest link bounced straight back to /brain", () => {
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    // A button, not a link: nothing here can route anywhere.
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("clears the input so the same file can be picked twice in a row", async () => {
    const heard = vi.fn();
    window.addEventListener(INGEST_FILE_EVENT, heard);

    const user = userEvent.setup();
    render(<ImportFileButton className="x">Import</ImportFileButton>);
    const input = screen.getByLabelText("Import a document") as HTMLInputElement;

    await user.upload(input, FILE);
    expect(input.value).toBe("");
    await user.upload(input, FILE);

    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener(INGEST_FILE_EVENT, heard);
  });
});
