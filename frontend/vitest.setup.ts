// Global vitest setup — registered via test.setupFiles in vitest.config.ts.
// Two things every component test in this repo now needs (added alongside
// the database feature's first React-rendering tests; nothing previously
// used @testing-library/react, so neither existed yet):
//   1. jest-dom matchers (toBeInTheDocument, toBeDisabled, ...) on `expect`.
//   2. Unmounting each rendered component after its test. @testing-library/
//      react's own auto-cleanup only self-registers when it finds a global
//      `afterEach` (Jest-style globals); this project's vitest.config.ts
//      does not set `test.globals: true`, so it's wired up explicitly here
//      instead of flipping on Jest-style globals repo-wide for one feature.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// jsdom shims for Radix (added with the database-UI primitive layer).
//
// Radix's popper/dismissable-layer code calls browser APIs jsdom does not
// implement. Without these, every Popover/Dialog test throws before it can
// assert anything. Guarded so a real browser env (Playwright) is untouched.
// ---------------------------------------------------------------------------
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.DOMRect === "undefined") {
  globalThis.DOMRect = class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 0,
      public height = 0
    ) {}
    top = 0;
    left = 0;
    right = 0;
    bottom = 0;
    toJSON() {
      return this;
    }
    static fromRect(r?: DOMRectInit) {
      return new (globalThis.DOMRect as never)(r?.x, r?.y, r?.width, r?.height);
    }
  } as unknown as typeof DOMRect;
}

for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
  if (!(method in Element.prototype)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any)[method] = () => false;
  }
}

if (!("scrollIntoView" in Element.prototype)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).scrollIntoView = () => {};
}
