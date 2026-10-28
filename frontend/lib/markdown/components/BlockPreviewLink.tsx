"use client";

/**
 * A chat citation you can look at without leaving the conversation.
 *
 * The agent cites `/brain/{noteId}#{blockId}`. Hovering such a link for a
 * moment opens a small card rendering that exact block, with the same
 * BlockNote schema the note itself uses (BlockPreview → noteSchema.tsx), so
 * the preview looks like what you'd see if you followed the link. Clicking
 * still follows it — the destination already scrolls to and highlights the
 * block (useBlockHashScroll + scrollToBlock).
 *
 * Anything that isn't a block deep link — an external URL, a plain
 * `/brain/{id}` note link, a bare `#anchor` — renders exactly as it did
 * before this component existed: a plain `<a>` with the same classes.
 *
 * Accessibility: the card is a `role="tooltip"` referenced by the link's
 * `aria-describedby`, opens on focus as well as hover, and closes on Escape.
 * It is `pointer-events: none` and contains nothing focusable, so it can
 * neither trap focus nor intercept the click meant for the link.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BlockPreview, preloadBlockPreview } from "@/components/editor/BlockPreview";
import { timeAgo } from "@/lib/time";
import {
  fetchBlockPreview,
  parseBlockLink,
  type BlockPreviewData,
} from "../blockPreview";

/** Long enough that a pointer crossing a link on its way somewhere else
 *  never opens (or fetches) anything; short enough to feel like a hover. */
export const HOVER_DELAY_MS = 200;

const CARD_WIDTH = 360;
const VIEWPORT_MAX_HEIGHT = 220;
/** The least passage worth showing. On a window too short even for this the
 *  card may have to overlap the link — which still beats a card too small to
 *  read. */
const MIN_VIEWPORT_HEIGHT = 72;
/** First-placement guesses, before the card has rendered anything to measure. */
const GUESS_HEADER_HEIGHT = 34;
const GUESS_CONTENT_HEIGHT = 120;
const GAP = 8;
const VIEWPORT_MARGIN = 8;

export const LINK_CLASS = "text-accent-600 dark:text-accent-400 hover:underline";

interface Props {
  href?: string;
  children?: React.ReactNode;
}

interface CardPosition {
  top: number;
  left: number;
  /** Height cap for the passage viewport. The default, unless the card has
   *  to shrink to fit beside the link on a short window. */
  viewportMaxHeight: number;
}

/** Where the card goes: beside the link, never on top of it.
 *
 *  Below the link if the whole card fits there, above if it fits there
 *  instead. On a window too short for either — found testing in a real
 *  780×389 browser, where a 254px card had 214px below the link and 159px
 *  above — the card used to be clamped to the top of the window and land
 *  squarely over the link it was previewing. It now takes the roomier side
 *  and shrinks its passage to fit: the viewport already centres the cited
 *  block and fades what it clips, so a shorter card loses context, not the
 *  citation.
 *
 *  `contentHeight` is the passage's full height (the viewport's
 *  scrollHeight), which a height cap does not change — so re-measuring a
 *  capped card reproduces the same placement instead of oscillating.
 *
 *  `position: fixed` coordinates — the card is portaled to `document.body`,
 *  which is what lets it escape the chat panel's `overflow` clipping. */
export function positionFor(
  rect: Pick<DOMRect, "top" | "bottom" | "left">,
  headerHeight: number,
  contentHeight: number
): CardPosition {
  const natural = Math.min(VIEWPORT_MAX_HEIGHT, contentHeight);
  const roomBelow = window.innerHeight - rect.bottom - GAP - VIEWPORT_MARGIN;
  const roomAbove = rect.top - GAP - VIEWPORT_MARGIN;
  const whole = headerHeight + natural;

  let below: boolean;
  let viewport: number;
  if (whole <= roomBelow) {
    below = true;
    viewport = natural;
  } else if (whole <= roomAbove) {
    below = false;
    viewport = natural;
  } else {
    below = roomBelow >= roomAbove;
    viewport = Math.max(MIN_VIEWPORT_HEIGHT, (below ? roomBelow : roomAbove) - headerHeight);
  }

  const cardHeight = headerHeight + viewport;
  const top = below
    ? rect.bottom + GAP
    : Math.max(VIEWPORT_MARGIN, rect.top - GAP - cardHeight);
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, rect.left),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN)
  );
  return {
    top,
    left,
    viewportMaxHeight: viewport === natural ? VIEWPORT_MAX_HEIGHT : viewport,
  };
}

export function BlockPreviewLink({ href, children }: Props) {
  const target = parseBlockLink(href);
  if (!target) {
    return (
      <a href={href} className={LINK_CLASS}>
        {children}
      </a>
    );
  }
  return (
    <BlockLink href={href as string} noteId={target.noteId} blockId={target.blockId}>
      {children}
    </BlockLink>
  );
}

function BlockLink({
  href,
  noteId,
  blockId,
  children,
}: Props & { href: string; noteId: string; blockId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<BlockPreviewData | null>(null);
  const [pos, setPos] = useState<CardPosition | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef(true);
  const pathname = usePathname();

  useEffect(() => {
    liveRef.current = true;
    // This answer contains a citation, so the renderer is worth having ready
    // before the reader reaches for it.
    preloadBlockPreview();
    return () => {
      liveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const close = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }, []);

  const openCard = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    // A rough first guess at the height; the card re-measures itself once its
    // real content is in the DOM (see the effect below).
    if (rect) setPos(positionFor(rect, GUESS_HEADER_HEIGHT, GUESS_CONTENT_HEIGHT));
    setOpen(true);

    fetchBlockPreview(noteId, blockId).then((result) => {
      if (!liveRef.current) return;
      setData(result);
      // A block that can't be fetched — deleted, edited away, backend down —
      // leaves a plain link behind rather than an error card.
      if (!result) setOpen(false);
    });
  }, [noteId, blockId]);

  const scheduleOpen = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      openCard();
    }, HOVER_DELAY_MS);
  }, [openCard]);

  // While the card is open: Escape dismisses it, and a scroll or resize of
  // the PAGE closes it rather than leaving it stranded at stale coordinates.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    // Not the card's own scrolling. The card scrolls itself to centre the
    // cited block, and that scroll bubbles to this capture-phase listener —
    // so without this guard the card closes itself the instant it opens, and
    // never appears at all. (Found live; no error, just a card that was there
    // and then wasn't.)
    function onScroll(e: Event) {
      const target = e.target;
      if (target instanceof Element && target.closest('[role="tooltip"]')) return;
      close();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const cardId = `block-preview-${noteId}-${blockId}`;
  const anchorProps = {
    ref: anchorRef,
    className: LINK_CLASS,
    onMouseEnter: scheduleOpen,
    onMouseLeave: close,
    onFocus: openCard, // no hover-intent problem to solve for keyboard
    onBlur: close,
    "aria-describedby": open && data ? cardId : undefined,
  };

  // Same note, different block: a plain `<a>` so the browser performs a real
  // in-page hash navigation (which fires `hashchange` — the only thing
  // useBlockHashScroll listens to for a second citation into the note already
  // open). A different note goes through next/link, so the client-side
  // navigation keeps the chat panel — and the conversation in it — alive
  // instead of reloading the page out from under it.
  const sameNote = pathname === `/brain/${noteId}`;

  return (
    <>
      {sameNote ? (
        <a href={href} {...anchorProps}>
          {children}
        </a>
      ) : (
        <Link href={href} {...anchorProps}>
          {children}
        </Link>
      )}
      {open && pos && (
        <BlockPreviewCard id={cardId} pos={pos} data={data} anchorRef={anchorRef} setPos={setPos} />
      )}
    </>
  );
}

function BlockPreviewCard({
  id,
  pos,
  data,
  anchorRef,
  setPos,
}: {
  id: string;
  pos: CardPosition;
  data: BlockPreviewData | null;
  anchorRef: React.RefObject<HTMLAnchorElement | null>;
  setPos: (p: CardPosition) => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const targetId = data ? (data.blocks[data.target_index]?.id as string | undefined) : undefined;
  // Only when the timestamp actually parses: a missing or malformed one shows
  // nothing, rather than "Edited NaNd ago".
  const edited =
    data?.updated_at && !Number.isNaN(Date.parse(data.updated_at))
      ? timeAgo(data.updated_at)
      : null;

  // Centre the cited block in the viewport and fade whichever edge actually
  // continues. Runs off a ResizeObserver rather than once after render:
  // BlockNote mounts asynchronously and KaTeX and images resize it again
  // afterwards, so "when the content settles" is the only reliable moment.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !targetId) return;

    function settle() {
      const vp = viewportRef.current;
      if (!vp) return;
      const target = vp.querySelector<HTMLElement>(
        `.bn-block-outer[data-id="${CSS.escape(targetId as string)}"]`
      );
      if (target) {
        // Bring the cited block to the middle of the visible area. The reader
        // cannot scroll this themselves — pointer-events: none is what lets
        // their click through to the link — so the card has to do it.
        const centred =
          target.offsetTop - (vp.clientHeight - target.offsetHeight) / 2;
        vp.scrollTop = Math.max(0, Math.min(centred, vp.scrollHeight - vp.clientHeight));
      }
      const room = vp.scrollHeight - vp.clientHeight;
      vp.dataset.fadeTop = String(vp.scrollTop > 1);
      vp.dataset.fadeBottom = String(room - vp.scrollTop > 1);
      // Re-place the card now that its real size is known — the first
      // placement only had a guess to work with. Only when something actually
      // moved: setPos re-renders, and a re-render per ResizeObserver tick is
      // work for nothing.
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        const next = positionFor(rect, headerRef.current?.offsetHeight ?? 0, vp.scrollHeight);
        const cur = posRef.current;
        if (
          next.top !== cur.top ||
          next.left !== cur.left ||
          next.viewportMaxHeight !== cur.viewportMaxHeight
        ) {
          setPos(next);
        }
      }
    }

    settle();
    const observer = new ResizeObserver(settle);
    observer.observe(viewport);
    const inner = viewport.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={cardRef}
      id={id}
      role="tooltip"
      data-block-preview={data?.block_id ?? ""}
      // pointer-events:none is load-bearing, not cosmetic — it is what keeps
      // the card from stealing the click aimed at the link under it.
      className="block-preview-card pointer-events-none fixed z-50 overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.07] dark:bg-gray-800 dark:ring-white/10"
      style={{
        top: pos.top,
        left: pos.left,
        width: CARD_WIDTH,
        // Two layers, not one soft blur: a tight contact shadow to seat the
        // card on the page, and a wider, weaker one for depth.
        boxShadow: "0 1px 2px rgba(16,24,40,0.06), 0 12px 28px -8px rgba(16,24,40,0.18)",
      }}
    >
      {data ? (
        <>
          <div ref={headerRef} className="flex items-center gap-2 border-b border-gray-100 px-3.5 py-2 text-[11px] dark:border-gray-700/70">
            <span aria-hidden className="text-[12px] leading-none">{data.note_icon}</span>
            <span className="min-w-0 flex-1 truncate font-medium text-gray-600 dark:text-gray-300">
              {data.note_title}
            </span>
            {edited && (
              // How current the source is — worth a glance when judging
              // whether a citation still holds.
              <span className="shrink-0 text-gray-400 dark:text-gray-500">Edited {edited}</span>
            )}
          </div>
          <div
            ref={viewportRef}
            className="block-preview-viewport px-3.5 pb-3.5 pt-3 text-gray-800 dark:text-gray-100"
            style={{ maxHeight: pos.viewportMaxHeight }}
            data-fade-top="false"
            data-fade-bottom="false"
          >
            <BlockPreview
              noteId={data.note_id}
              blocks={data.blocks}
              targetIndex={data.target_index}
            />
          </div>
        </>
      ) : (
        <div className="space-y-2 px-3 py-3" aria-hidden>
          <div className="h-2.5 w-44 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-2.5 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      )}
    </div>,
    document.body
  );
}
