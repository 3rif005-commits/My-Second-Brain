// Parity check: opens the running app (http://localhost:3000) in light and dark,
// reads COMPUTED styles from the real DOM and compares them with the values measured
// from live Notion (docs/notion-reference/checklist.md). Writes
// docs/ui-audit/parity-report.md and exits non-zero if any check fails.
//
// Usage (app running, logged-in storage state from shoot.mjs):
//   AUDIT_TMP=/tmp/ui-audit node docs/ui-audit/scripts/parity.mjs
import { chromium } from "../../../frontend/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { mock } from "./mockdb.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = process.env.AUDIT_TMP ?? "/tmp/ui-audit";
const BASE = process.env.APP_URL ?? "http://localhost:3000";

// [checklist #, description, selector, property, expected light, expected dark (or same)]
const CHECKS = {
  shell: [
    [1, "UI font is Notion's system stack", "body", "font-family", (v) => v.startsWith("ui-sans-serif")],
    [2, "App background", "body", "background-color", "rgb(255, 255, 255)", "rgb(25, 25, 25)"],
    [3, "Primary text", "body", "color", "rgb(44, 44, 43)", "rgb(240, 239, 237)"],
    [18, "Sidebar width 270px", "aside", "width", "270px"],
    [19, "Sidebar background", "aside", "background-color", "rgb(249, 248, 247)", "rgb(32, 32, 32)"],
    [25, "Nav pill row 32px tall", "nav[aria-label='Main navigation']", "height", "32px"],
    [30, "Section header 12px grey", "aside [data-section-header]", "font-size", "12px"],
    [44, "Top bar 44px tall", "header", "height", "44px"],
  ],
  database: [
    [81, "Full-page database title 32px", "input[aria-label='Database title']", "font-size", "32px"],
    [81, "Full-page database title weight 700", "input[aria-label='Database title']", "font-weight", "700"],
    [128, "View tab 32px tall", "[role=tab][aria-selected], button[aria-label$='view options']", "height", "32px"],
    [128, "View tab radius 20px", "button[aria-label$='view options']", "border-top-left-radius", "20px"],
    [132, "Toolbar buttons 28px", "[role=toolbar] button", "height", "28px"],
    [139, "Table header 36px", "table.db-table thead th:nth-child(2)", "height", "36px"],
    [141, "Header labels secondary grey", "table.db-table thead th:nth-child(2)", "color", "rgb(125, 122, 117)", "rgb(173, 169, 163)"],
    [145, "Grid line colour", "table.db-table tbody td:nth-child(2)", "border-bottom-color", "rgba(42, 28, 0, 0.07)", "rgba(255, 255, 243, 0.082)"],
    [146, "Cell text 14px", "table.db-table tbody td:nth-child(2)", "font-size", "14px"],
    [143, "Title column 280px", "table.db-table thead th:nth-child(2)", "width", "280px"],
    [158, "Select pill 20px tall", "table.db-table tbody td:nth-child(4) span[style*='--opt-']", "height", "20px"],
    [158, "Select pill radius 4px", "table.db-table tbody td:nth-child(4) span[style*='--opt-']", "border-top-left-radius", "4px"],
    [159, "Status pill radius 10px", "table.db-table tbody td:nth-child(3) span[style*='--opt-']", "border-top-left-radius", "10px"],
  ],
  page: [
    [80, "Page title 40px", "#note-title", "font-size", "40px"],
    [80, "Page title weight 700", "#note-title", "font-weight", "700"],
    [88, "Paragraph text 16px", ".notion-editor .bn-editor", "font-size", "16px"],
  ],
  settings: [
    [305, "Settings modal radius 12px", "[data-settings-modal]", "border-top-left-radius", "12px"],
    [311, "Settings nav 240px", "nav[aria-label='Settings sections']", "width", "240px"],
    [311, "Settings nav background", "nav[aria-label='Settings sections']", "background-color", "rgb(249, 248, 247)", "rgb(32, 32, 32)"],
    [318, "Settings page title 26px", ".settings-content h1", "font-size", "26px"],
    [314, "Settings nav item 28px", "nav[aria-label='Settings sections'] [role=tab]", "height", "28px"],
    [322, "Select button 28px", ".settings-content button[aria-haspopup=listbox]", "height", "28px"],
    [200, "Toggle 30×18", ".settings-content [role=switch]", "width", "30px"],
  ],
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const results = [];
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 649 }, storageState: `${TMP}/auth.json` });
  await ctx.addInitScript((t) => localStorage.setItem("sb-prefs", JSON.stringify({ theme: t })), theme);
  const page = await ctx.newPage();
  await mock(page);
  const run = async (group, url) => {
    await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    for (const [n, label, sel, prop, light, dark] of CHECKS[group]) {
      const actual = await page
        .$eval(sel, (el, p) => getComputedStyle(el).getPropertyValue(p), prop)
        .catch(() => null);
      const want = theme === "dark" && dark !== undefined ? dark : light;
      const pass = actual !== null && (typeof want === "function" ? want(actual) : actual.replace(/\s+/g, " ") === want);
      results.push({ theme, group, n, label, prop, want: typeof want === "function" ? "(rule)" : want, actual, pass });
    }
  };
  await run("shell", "/brain");
  await run("database", "/brain/db/db-1?view=v-table");
  const noteHref = await page.$eval("aside a[href^='/brain/']", (a) => a.getAttribute("href")).catch(() => null);
  if (noteHref) await run("page", noteHref);
  await run("settings", "/brain/settings/preferences");
  await ctx.close();
}
await browser.close();

const passed = results.filter((r) => r.pass).length;
const lines = [
  "# Parity report",
  "",
  `Computed styles of the running app vs. the values measured from live Notion (checklist numbers in the first column). Generated by \`scripts/parity.mjs\` on ${new Date().toISOString().slice(0, 10)}.`,
  "",
  `**${passed} of ${results.length} checks pass.**`,
  "",
  "| # | Theme | Check | Expected | Actual | |",
  "|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.n} | ${r.theme} | ${r.label} | \`${r.want}\` | \`${r.actual ?? "not found"}\` | ${r.pass ? "✅" : "❌"} |`),
  "",
];
fs.writeFileSync(path.join(HERE, "..", "parity-report.md"), lines.join("\n"));
console.log(`${passed}/${results.length} parity checks pass`);
for (const r of results.filter((x) => !x.pass)) console.log("FAIL", r.theme, r.n, r.label, "want", r.want, "got", r.actual);
process.exit(passed === results.length ? 0 : 1);
