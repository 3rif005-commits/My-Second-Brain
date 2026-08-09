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
