import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// The Notion-parity floor only rises (docs/ui-audit/scripts/parity.mjs). The live run needs a
// browser; this catches the cheap way to "pass" it without one: deleting checks.
const AUDIT = path.join(__dirname, "..", "..", "docs", "ui-audit");

describe("Notion parity floor", () => {
  it("has at least as many checks as the floor demands", () => {
    const script = readFileSync(path.join(AUDIT, "scripts", "parity.mjs"), "utf8");
    const rows = script.match(/^\s*\[\d+, "/gm)?.length ?? 0;
    const { passing } = JSON.parse(readFileSync(path.join(AUDIT, "parity-floor.json"), "utf8"));
    expect(rows * 2).toBeGreaterThanOrEqual(passing); // every check runs in light and dark
  });
});
