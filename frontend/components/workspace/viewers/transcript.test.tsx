import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, createRef } from "react";
import { activeLine, clock, readTranscript, transcriptRows, type TranscriptLine } from "./transcript";
import { TranscriptList } from "./TranscriptList";

const lines: TranscriptLine[] = [[0, "intro words"], [20, "the main idea"], [40, "the proof"]];

describe("transcript helpers", () => {
  it("finds the line being spoken", () => {
    expect(activeLine(lines, 0)).toBe(0);
    expect(activeLine(lines, 25)).toBe(1);
    expect(activeLine(lines, 999)).toBe(2);
    expect(activeLine([], 5)).toBe(-1);
  });
  it("puts chapter headings before their first line", () => {
    const rows = transcriptRows(lines, [{ start: 38, title: "Proof" }, { start: 0, title: "Intro" }]);
    expect(rows.map((r) => (r.kind === "chapter" ? `# ${r.title}` : r.start))).toEqual(["# Intro", 0, 20, "# Proof", 40]);
    // A chapter after the last line is kept, at the end.
    expect(transcriptRows(lines, [{ start: 300, title: "Q&A" }]).at(-1)).toMatchObject({ kind: "chapter", title: "Q&A" });
  });
  it("formats clocks and rejects malformed meta", () => {
    expect([clock(5), clock(65), clock(3725)]).toEqual(["0:05", "1:05", "1:02:05"]);
    expect(readTranscript({ transcript: [[1, "ok"], ["x", 2], null], chapters: [{ start: 1, title: "A" }, { t: 1 }] }))
      .toEqual({ lines: [[1, "ok"]], chapters: [{ start: 1, title: "A" }] });
    expect(readTranscript(undefined)).toEqual({ lines: [], chapters: [] });
    // Only a web link is kept as a chapter picture.
    expect(readTranscript({ chapters: [{ start: 1, title: "A", thumb_url: "javascript:x" }, { start: 2, title: "B", thumb_url: "https://s/b.jpg" }] }).chapters)
      .toEqual([{ start: 1, title: "A" }, { start: 2, title: "B", thumb_url: "https://s/b.jpg" }]);
  });
});

describe("TranscriptList", () => {
  it("is collapsed until opened; clicking a line seeks; the spoken line is highlighted", () => {
    const sink = createRef<((t: number) => void) | null>() as React.MutableRefObject<((t: number) => void) | null>;
    const onSeek = vi.fn();
    render(<TranscriptList lines={lines} chapters={[{ start: 0, title: "Intro" }]} timeSinkRef={sink} onSeek={onSeek} />);
    expect(screen.queryByText("the proof")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Transcript/ }));
    fireEvent.click(screen.getByText("the proof"));
    expect(onSeek).toHaveBeenCalledWith(40);
    fireEvent.click(screen.getByText("Intro"));
    expect(onSeek).toHaveBeenCalledWith(0);
    act(() => sink.current?.(22));
    expect(screen.getByText("the main idea").closest("button")!.className).toMatch(/bg-accent-50/);
  });
  it("shows an uploaded file's chapters with their pictures even without a transcript", () => {
    const sink = { current: null };
    const onSeek = vi.fn();
    const { container } = render(<TranscriptList lines={[]} timeSinkRef={sink} onSeek={onSeek}
      chapters={[{ start: 0, title: "Setup", thumb_url: "https://x/0.jpg" }, { start: 90, title: "Results" }]} />);
    fireEvent.click(screen.getByRole("button", { name: /Chapters/ }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://x/0.jpg");
    fireEvent.click(screen.getByText("Results"));
    expect(onSeek).toHaveBeenCalledWith(90);
  });
  it("renders nothing without a transcript", () => {
    const sink = { current: null };
    const { container } = render(<TranscriptList lines={[]} chapters={[]} timeSinkRef={sink} onSeek={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
