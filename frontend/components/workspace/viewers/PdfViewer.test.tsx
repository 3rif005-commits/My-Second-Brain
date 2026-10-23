import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// react-pdf: a Document that reports its page count only when the test says the file loaded.
let loadPdf: (() => void) | null = null;
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ onLoadSuccess, children }: { onLoadSuccess: (d: { numPages: number }) => void; children: React.ReactNode }) => {
    loadPdf = () => onLoadSuccess({ numPages: 200 });
    return <div>{children}</div>;
  },
  Page: () => <div />,
}));
vi.mock("react-pdf/dist/Page/TextLayer.css", () => ({}));
vi.mock("react-pdf/dist/Page/AnnotationLayer.css", () => ({}));
vi.mock("@/app/providers", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/workspace", () => ({
  wsApi: { sourceFileUrl: () => Promise.resolve({ url: "https://s/file.pdf" }) },
}));

import { PdfViewer } from "./PdfViewer";
import type { NoteSource } from "@/lib/workspace";

const resource = {
  id: "s1", note_id: "n1", kind: "pdf", title: "big", source_url: null, storage_path: "p",
  status: "ready", error: null, order_index: 0, elements: [],
  meta: { pages: 200, page_sizes: Array.from({ length: 200 }, () => [612, 792]) },
} as unknown as NoteSource;

describe("PdfViewer jumps", () => {
  it("a jump asked for before the PDF has loaded (a 📍 p. 150 link) lands once the pages exist", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push((this as HTMLElement).dataset.page ?? "?");
    });
    const seekRef: { current: ((v: number) => void) | null } = { current: null };
    render(<PdfViewer resource={resource} onPosition={() => {}} onAction={() => {}} seekRef={seekRef} />);
    await act(async () => {});                    // file link arrives, Document mounts
    expect(seekRef.current).not.toBeNull();

    act(() => seekRef.current!(150));             // the deep link fires right away
    expect(scrolled).toEqual([]);                 // nothing to scroll to yet

    act(() => loadPdf!());                        // the file finishes loading
    expect(scrolled).toEqual(["150"]);

    act(() => seekRef.current!(7));               // later jumps go straight there
    expect(scrolled).toEqual(["150", "7"]);
  });
});
