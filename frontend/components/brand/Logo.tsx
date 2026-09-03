"use client";

import { useId } from "react";

/**
 * The app mark: two arcs around a single amber node.
 *
 * The literal 🧠 emoji used to stand in for a logo in five different places
 * (sidebar, mobile top bar, the share and form headers, the empty state), which
 * meant the brand was whatever emoji font the viewer happened to have. This is
 * one drawn mark instead, and the reason it is abstract rather than a drawn
 * brain: the dominant size on screen is 22px in the sidebar, where fold detail
 * turns to mush. Two arcs and a dot survive that.
 *
 * The arcs are deliberately unequal — the solid one is the brain you were born
 * with, the lighter one the second you are building here.
 *
 * The gradient needs a document-unique id: several Logos can render on the same
 * page (sidebar + mobile top bar), and duplicate SVG ids make every instance
 * resolve `url(#…)` to whichever one mounted first.
 */
export function Logo({
  size = 24,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  /** Give this only where the mark is the sole naming of the app; next to a
   * "My Second Brain" wordmark it should stay decorative. */
  title?: string;
}) {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#${gradientId})`} />
      <path
        d="M236 128 C 146 128 110 190 110 256 C 110 322 146 384 236 384"
        fill="none"
        stroke="#fff"
        strokeWidth="44"
        strokeLinecap="round"
      />
      <path
        d="M290 160 C 358 160 386 208 386 256 C 386 304 358 352 290 352"
        fill="none"
        stroke="#fff"
        strokeWidth="44"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="258" cy="256" r="38" fill="#FBBF24" />
    </svg>
  );
}
