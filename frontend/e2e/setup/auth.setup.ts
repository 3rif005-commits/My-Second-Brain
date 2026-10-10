/**
 * Playwright auth setup — logs in once, saves session to e2e/.auth/user.json.
 * All tests that depend on this project reuse the cookie without re-logging in.
 */
import { test as setup, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

export const AUTH_FILE = path.join(process.cwd(), "e2e/.auth/user.json");

/** E2E_EMAIL / E2E_PASSWORD come from the environment, else from frontend/.env.local. Never hardcode them. */
function login(name: string): string {
  let v = process.env[name];
  if (!v) {
    try {
      const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
      v = env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
    } catch {
      /* no .env.local */
    }
  }
  if (!v) throw new Error(`${name} is not set (environment or frontend/.env.local)`);
  return v;
}

setup("authenticate", async ({ page }) => {
  await page.goto("/login");
  await page.waitForSelector('button[type="submit"]');

  await page.fill('[placeholder="you@example.com"]', login("E2E_EMAIL"));
  await page.fill('[placeholder="••••••••"]', login("E2E_PASSWORD"));
  await page.click('button[type="submit"]');

  // Wait for redirect to /brain — confirms login succeeded
  // 60s: the dev server compiles /brain on first visit, which takes longer
  // than 15s on a 2-core machine.
  await page.waitForURL("**/brain", { timeout: 60_000 });
  expect(page.url()).toContain("/brain");

  // Save auth cookies + localStorage
  await page.context().storageState({ path: AUTH_FILE });
});
