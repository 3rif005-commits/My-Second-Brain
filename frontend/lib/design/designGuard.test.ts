// Design guard: keeps the app on the Notion token system (docs/ui-audit/README.md §4.7).
//
// A ratchet, not a big-bang rule: each pattern below has a baseline count in
// designGuardBaseline.json. A count may go DOWN (update the baseline in the same
// change) but never UP, so no new raw colour or native control can creep back in
// while the redesign phases remove the existing ones. The final phase sets every
// baseline to 0.
//
// Allowed: the semantic token classes (surface-*, ink-*, line-*, accent, opt-*,
// blk-*) and gray-* (it IS the measured Notion neutral scale, tailwind.config.ts).
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import baseline from "./designGuardBaseline.json";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib"];
/** The kit itself is where native controls and raw values are allowed to live. */
const EXEMPT = [/^components\/ui\//, /^app\/(tokens|globals|editor)\.css$/, /\.test\.tsx?$/, /^lib\/design\//];

export const RULES: Record<string, { pattern: RegExp; why: string }> = {
  offPaletteColour: {
    pattern: /\b(?:[a-z-]+:)*(?:bg|text|border|ring|divide|from|via|to|outline|fill|stroke|decoration|placeholder|shadow|accent|caret)-(?:slate|zinc|neutral|stone|indigo|violet|sky|brand)(?:-\d{2,3})?(?:\/\d+)?\b/g,
    why: "use a semantic token (surface/ink/line/accent) or gray-*; indigo/violet/brand are the accent",
  },
  arbitraryColour: {
    pattern: /\b(?:bg|text|border|ring|from|to|fill|stroke|shadow)-\[(?:#|rgb|rgba|hsl)[^\]]*\]/g,
    why: "no hard-coded colours in classes; add a token to app/tokens.css",
  },
  nativeSelect: { pattern: /<select\b/g, why: "use components/ui Select" },
  nativeCheckbox: { pattern: /type=["']checkbox["']/g, why: "use components/ui Checkbox or Toggle" },
  nativeDialog: { pattern: /window\.(?:confirm|alert|prompt)\(/g, why: "use components/ui Dialog" },
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function countViolations(): Record<string, { total: number; files: Record<string, number> }> {
  const result: Record<string, { total: number; files: Record<string, number> }> = {};
  for (const name of Object.keys(RULES)) result[name] = { total: 0, files: {} };
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (EXEMPT.some((re) => re.test(rel))) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const [name, { pattern }] of Object.entries(RULES)) {
      const n = text.match(pattern)?.length ?? 0;
      if (n) {
        result[name].total += n;
        result[name].files[rel] = n;
      }
    }
  }
  return result;
}

describe("design guard (ratchet)", () => {
  const counts = countViolations();
  for (const [name, { why }] of Object.entries(RULES)) {
    it(`${name} does not grow past its baseline`, () => {
      const allowed = (baseline as Record<string, number>)[name] ?? 0;
      const { total, files } = counts[name];
      if (total > allowed) {
        const worst = Object.entries(files).sort((a, b) => b[1] - a[1]).slice(0, 10);
        throw new Error(
          `${name}: ${total} > baseline ${allowed} (${why}).\nTop files:\n` +
            worst.map(([f, n]) => `  ${n}  ${f}`).join("\n"),
        );
      }
      expect(total).toBeLessThanOrEqual(allowed);
    });
  }
});
