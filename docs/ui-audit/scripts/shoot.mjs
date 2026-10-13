// Screenshot every main screen of the app in light and dark.
// Usage: node shoot.mjs <outDir>
import { chromium } from "/home/user/My-Second-Brain/frontend/node_modules/playwright/index.mjs";
import fs from "fs";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 649 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`);
await page.screenshot({ path: `${out}/login-light.png` });
await page.fill('[placeholder="you@example.com"]', process.env.E2E_EMAIL);
await page.fill('[placeholder="••••••••"]', process.env.E2E_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL("**/brain", { timeout: 120_000 });
await page.waitForTimeout(3000);

// Discover a note and a database from the sidebar.
const links = await page.$$eval("a[href^='/brain/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
fs.writeFileSync(`${out}/links.json`, JSON.stringify(links, null, 2));
const db = links.find((h) => h.startsWith("/brain/db/"));
const note = links.find((h) => /^\/brain\/[0-9a-f-]{36}$/.test(h));

const routes = [
  ["home", "/brain"],
  ["note", note],
  ["db", db],
  ["settings-skills", "/brain/settings/skills"],
  ["settings-ai-providers", "/brain/settings/ai-providers"],
  ["settings-routing", "/brain/settings/routing"],
  ["settings-notion", "/brain/settings/notion"],
  ["settings-mcp", "/brain/settings/mcp"],
  ["settings-connected-apps", "/brain/settings/connected-apps"],
  ["settings-background-jobs", "/brain/settings/background-jobs"],
  ["chat", "/brain/chat"],
  ["ingest", "/brain/ingest"],
  ["activity", "/brain/activity"],
  ["workspace", "/brain/workspace"],
].filter(([, r]) => r);

for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => localStorage.setItem("sb-theme", t), theme);
  for (const [name, route] of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${out}/${name}-${theme}.png` });
      if (name === "db" || name === "note") await page.screenshot({ path: `${out}/${name}-full-${theme}.png`, fullPage: true });
      console.log("ok", name, theme);
    } catch (e) {
      console.log("FAIL", name, theme, e.message.split("\n")[0]);
    }
  }
}
await ctx.storageState({ path: (process.env.AUDIT_TMP ?? "/tmp/ui-audit") + "/auth.json" });
await browser.close();
