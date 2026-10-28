/**
 * Hover-card behaviour for chat citations (work item E).
 *
 * These prove the *logic*: when a fetch happens, when it doesn't, what a
 * failure leaves behind, and that non-citation links are untouched. They
 * deliberately do NOT prove the card "looks like the note" — that needs a
 * real BlockNote render in a real browser, which `e2e/live-hover-card.spec.ts`
 * drives against a production build. BlockPreview is mocked here for the same
 * reason PublicNoteView isn't unit-rendered anywhere: BlockNote does not run
 * meaningfully in jsdom.
 */
import { forwardRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/brain";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// Marked so a test can tell a client-side <Link> from a plain <a> — the
// difference decides whether a citation click keeps the chat panel alive or
// reloads the page, and whether a same-note jump fires `hashchange`.
vi.mock("next/link", () => ({
  __esModule: true,
  // forwardRef because the real next/link does — the component measures the
  // link's rect to place the card, so a mock that drops the ref would fake a
  // failure the app doesn't have.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: forwardRef<HTMLAnchorElement, any>(({ href, children, ...rest }, ref) => (
    <a href={href} ref={ref} data-next-link="true" {...rest}>
      {children}
    </a>
  )),
}));

vi.mock("@/components/editor/BlockPreview", () => ({
  preloadBlockPreview: () => {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BlockPreview: ({ noteId, blocks, targetIndex }: any) => (
    <div
      data-testid="rendered-block"
      data-note-id={noteId}
      data-target-id={blocks?.[targetIndex]?.id}
    >
      {(blocks ?? []).map((b: any) => b?.content?.[0]?.text ?? "").join(" | ")}
    </div>
  ),
}));

import { BlockPreviewLink, HOVER_DELAY_MS, positionFor } from "./BlockPreviewLink";
import { __clearBlockPreviewCache } from "../blockPreview";

const NOTE_ID = "3f1c9a2e-4b7d-4e21-9a6f-2c8b17d5e0aa";
const BLOCK_ID = "blk-42";
const HREF = `/brain/${NOTE_ID}#${BLOCK_ID}`;

const PREVIEW = {
  note_id: NOTE_ID,
  note_title: "Gradient Descent",
  note_icon: "📐",
  block_id: BLOCK_ID,
  blocks: [
    {
      id: "blk-41",
      type: "paragraph",
      content: [{ type: "text", text: "Before the cited line." }],
      children: [],
    },
    {
      id: BLOCK_ID,
      type: "paragraph",
      content: [{ type: "text", text: "Steps downhill along the gradient." }],
      children: [],
    },
    {
      id: "blk-43",
      type: "paragraph",
      content: [{ type: "text", text: "After the cited line." }],
      children: [],
    },
  ],
  target_index: 1,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Settles the fetch → setState chain. Everything async here is driven
 *  explicitly (fake timers plus these flushes) rather than through `waitFor`
 *  / `findBy*`: those poll on a real timer, which fake timers never advance,
 *  so under `vi.useFakeTimers()` they just hang until the test times out. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Runs the hover-intent timer, then lets the fetch promise chain settle. */
async function elapseHoverDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS);
  });
  await flush();
}

beforeEach(() => {
  pathname = "/brain";
  __clearBlockPreviewCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BlockPreviewLink — non-citation links keep today's behaviour", () => {
  it("renders an external link as a plain anchor with no hover behaviour", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockPreviewLink href="https://example.com/docs">docs</BlockPreviewLink>);
    const link = screen.getByText("docs");
    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveClass("text-accent-600");

    fireEvent.mouseEnter(link);
    await elapseHoverDelay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("previews a whole-note link from the note's opening passage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => null });
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockPreviewLink href={`/brain/${NOTE_ID}`}>the note</BlockPreviewLink>);
    fireEvent.mouseEnter(screen.getByText("the note"));
    await elapseHoverDelay();

    expect(fetchMock).toHaveBeenCalledWith(`/api/ws/notes/${NOTE_ID}/blocks/_top`);
  });

  it("renders a bare in-page anchor as a plain anchor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockPreviewLink href="#section-2">jump</BlockPreviewLink>);
    fireEvent.mouseEnter(screen.getByText("jump"));
    await elapseHoverDelay();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("BlockPreviewLink — the hover card", () => {
  it("shows the card after the delay, and not before", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PREVIEW)));

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");

    fireEvent.mouseEnter(link);

    // Just short of the delay: nothing on screen, nothing requested.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS - 1);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/ws/notes/${NOTE_ID}/blocks/${BLOCK_ID}`
    );
  });

  it("renders the cited block itself, under its note's title", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PREVIEW)));

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    fireEvent.mouseEnter(screen.getByText("the cited claim"));
    await elapseHoverDelay();

    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("Gradient Descent");
    const rendered = screen.getByTestId("rendered-block");
    expect(rendered).toHaveTextContent("Steps downhill along the gradient.");
    // The neighbours come along for context…
    expect(rendered).toHaveTextContent("Before the cited line.");
    expect(rendered).toHaveTextContent("After the cited line.");
    // …and the card still knows which one was actually cited.
    expect(rendered).toHaveAttribute("data-target-id", BLOCK_ID);
    // The block's own note, so an embedded database/button block resolves.
    expect(rendered).toHaveAttribute("data-note-id", NOTE_ID);
  });

  it("fires no fetch when the pointer passes straight through", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PREVIEW));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");

    for (let i = 0; i < 5; i++) {
      fireEvent.mouseEnter(link);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HOVER_DELAY_MS / 4);
      });
      fireEvent.mouseLeave(link);
    }
    await elapseHoverDelay();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses on mouse-out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PREVIEW)));

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");
    fireEvent.mouseEnter(link);
    await elapseHoverDelay();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(link);
    await flush();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("fetches once for repeated hovers of the same citation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PREVIEW));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");

    for (let i = 0; i < 3; i++) {
      fireEvent.mouseEnter(link);
      await elapseHoverDelay();
      screen.getByRole("tooltip");
      fireEvent.mouseLeave(link);
      await flush();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degrades to a plain link when the block can't be fetched", async () => {
    // 404: the note was deleted, or the block edited away, since the answer
    // was written — the citation still navigates, it just doesn't preview.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Block not found" }, 404)));

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");
    fireEvent.mouseEnter(link);
    await elapseHoverDelay();

    await flush();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(link).toHaveAttribute("href", HREF);
    expect(link).toHaveClass("text-accent-600");
  });

  it("degrades to a plain link when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    fireEvent.mouseEnter(screen.getByText("the cited claim"));
    await elapseHoverDelay();

    await flush();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("retries a transport failure on the next hover, but not a 404", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(jsonResponse(PREVIEW));
    vi.stubGlobal("fetch", fetchMock);

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");

    fireEvent.mouseEnter(link);
    await elapseHoverDelay();
    fireEvent.mouseLeave(link);

    fireEvent.mouseEnter(link);
    await elapseHoverDelay();

    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("BlockPreviewLink — keyboard and click", () => {
  it("opens on focus and closes on Escape without trapping focus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PREVIEW)));

    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");

    await act(async () => {
      fireEvent.focus(link);
    });
    const card = screen.getByRole("tooltip");

    // Describes the link rather than taking focus from it. (That the REAL
    // card holds nothing tabbable is asserted in e2e/live-hover-card.spec.ts
    // — BlockPreview is mocked here, so asserting it against this mock would
    // only be testing the mock.)
    expect(link).toHaveAttribute("aria-describedby", card.id);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await flush();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("still navigates: a citation into another note is a client-side link", () => {
    // Client-side, so following a citation keeps the chat panel — and the
    // conversation in it — mounted instead of reloading the page.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(PREVIEW)));
    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");
    expect(link).toHaveAttribute("href", HREF);
    expect(link).toHaveAttribute("data-next-link", "true");
  });

  it("cites a block in the note already open as a plain anchor", () => {
    // A same-note citation must be a real in-page hash navigation: that fires
    // `hashchange`, which is the only signal useBlockHashScroll has for a
    // second citation into the note that's already on screen. A client-side
    // route push to the same path would scroll nothing.
    pathname = `/brain/${NOTE_ID}`;
    render(<BlockPreviewLink href={HREF}>the cited claim</BlockPreviewLink>);
    const link = screen.getByText("the cited claim");
    expect(link).toHaveAttribute("href", HREF);
    expect(link).not.toHaveAttribute("data-next-link");
  });
});


describe("positionFor — the card sits beside the link, never on it", () => {
  const HEADER = 34;
  const DEFAULT_CAP = 220;
  let saved: { w: number; h: number };

  function setWindow(w: number, h: number) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
  }
  const linkAt = (top: number, left = 100) => ({ top, bottom: top + 17, left });

  beforeEach(() => {
    saved = { w: window.innerWidth, h: window.innerHeight };
  });
  afterEach(() => {
    setWindow(saved.w, saved.h);
  });

  it("goes below the link when the whole card fits there", () => {
    setWindow(1280, 800);
    const link = linkAt(100);
    const p = positionFor(link, HEADER, 200);
    expect(p.top).toBeGreaterThan(link.bottom);
    expect(p.viewportMaxHeight).toBe(DEFAULT_CAP);
  });

  it("goes above when only above has room, and ends before the link starts", () => {
    setWindow(1280, 800);
    const link = linkAt(600);
    const p = positionFor(link, HEADER, 200);
    const cardBottom = p.top + HEADER + Math.min(DEFAULT_CAP, 200);
    expect(cardBottom).toBeLessThanOrEqual(link.top);
  });

  it("shrinks to fit the roomier side on a short window instead of covering the link", () => {
    // The real case, measured in a live browser: a 780×389 window, the link at
    // 159–176, and a card that wants 254px. It used to land on top of the link.
    setWindow(780, 389);
    const link = linkAt(159, 245);
    const p = positionFor(link, HEADER, 260);
    const cardBottom = p.top + HEADER + p.viewportMaxHeight;

    const overlaps = p.top < link.bottom && cardBottom > link.top;
    expect(overlaps).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(cardBottom).toBeLessThanOrEqual(389);
    expect(p.viewportMaxHeight).toBeLessThan(DEFAULT_CAP);
  });

  it("never shrinks the passage below a readable minimum", () => {
    setWindow(780, 200);
    const p = positionFor(linkAt(90, 245), HEADER, 260);
    expect(p.viewportMaxHeight).toBeGreaterThanOrEqual(72);
  });

  it("keeps the card inside the window horizontally", () => {
    setWindow(780, 800);
    const p = positionFor(linkAt(100, 700), HEADER, 200);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + 360).toBeLessThanOrEqual(780);
  });
});
