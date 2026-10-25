/**
 * Routing, live: Settings → Routing, the composer's "Auto" chip, and the route
 * badge on real answers. SPENDS A LITTLE (one one-word cloud answer). The
 * "bank account" question is routed on-device by the default rule, so it
 * costs nothing — with the local model stopped it shows the Local badge and
 * then an error, which is the point: the route was decided before any model.
 * Leaves no threads behind and saves no policy unless migration 029 exists
 * (then it restores what it found).
 *
 *   npx playwright test --project=routing-live
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import { openPanel } from "./helpers/panel";

const OUT = path.join(process.cwd(), "e2e/screenshots/routing-live");
const ss = (page: Page, name: string) => {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

async function threadIds(page: Page): Promise<Set<string>> {
  const r = await page.request.get("/api/threads");
  const body = await r.json().catch(() => []);
  const rows = Array.isArray(body) ? body : body.threads ?? [];
  return new Set(rows.map((t: { id: string }) => t.id));
}

test("Settings → Routing: tabs, targets, rules, test bench, privacy", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/brain/settings/routing", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Routing" })).toBeVisible();
  for (const t of ["Targets", "Rules", "Brain & instructions", "Privacy", "Activity"])
    await expect(page.getByRole("tab", { name: t })).toBeVisible();

  // Targets: every role says what it resolves to now.
  await expect(page.getByText(/^Now:/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("Local provider")).toBeDisabled();
  await ss(page, "01-targets");

  // Rules: the shipped defaults, and editing makes the draft dirty.
  await page.getByRole("tab", { name: "Rules" }).click();
  await expect(page.getByRole("textbox", { name: "Value", exact: true }).first()).toHaveValue(/password/);
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await ss(page, "02-rules");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);

  // Test bench: a sensitive word goes on-device by rule, before any model.
  await page.getByRole("tab", { name: "Brain & instructions" }).click();
  await page.getByLabel("Sample question").fill("what is my bank account number?");
  await page.getByRole("button", { name: "Route it" }).click();
  await expect(page.getByText(/Decided by a rule: message mentions/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/May read private notes/)).toBeVisible();
  await page.getByLabel("Sample question").fill("explain eigenvalues briefly");
  await page.getByRole("button", { name: "Route it" }).click();
  await expect(page.getByText(/May read (personal|open) notes/)).toBeVisible({ timeout: 30_000 });
  await ss(page, "03-test-bench");

  // Privacy tab.
  await page.getByRole("tab", { name: "Privacy" }).click();
  await expect(page.getByRole("radio", { name: /Ask me first/ })).toBeChecked();
  await ss(page, "04-privacy");

  // Activity loads (or says why: the migration).
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByText(/Requests|No routed requests|029/).first()).toBeVisible({ timeout: 30_000 });
  await ss(page, "05-activity");
});

test("chat: Auto chip, a rule routes on-device, a cloud answer shows its route", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/brain", { waitUntil: "networkidle" });
  const before = await threadIds(page);
  try {
    const box = await openPanel(page);
    const chip = page.getByRole("button", { name: /Where answers run/ });
    await expect(chip).toHaveText(/Auto/);
    await chip.click();
    await expect(page.getByText("Your rules decide · private stays home")).toBeVisible();
    await ss(page, "06-mode-menu");
    await page.keyboard.press("Escape");
    await chip.click();   // close

    // On-device by the default rule — free, and decided before any model ran.
    await box.fill("what is my bank account number?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: /Answered on this device/ }).last())
      .toBeVisible({ timeout: 60_000 });
    await ss(page, "07-local-by-rule");

    // A real (tiny) cloud answer, with its badge and the why-popover.
    await page.getByRole("button", { name: "New chat tab" }).click();
    await box.fill("Reply with exactly one word: pong");
    await page.getByRole("button", { name: "Send" }).click();
    const badge = page.getByRole("button", { name: /^Answered by .*Details$/ }).last();
    await expect(badge).toBeVisible({ timeout: 120_000 });
    await expect(badge).toContainText("Fast");
    await badge.click();
    const why = page.getByRole("dialog", { name: "Why this route" });
    await expect(why).toContainText("Decided by");
    await expect(why.getByRole("button", { name: "Strong" })).toBeVisible();
    await ss(page, "08-cloud-badge");
  } finally {
    // Leave the user's thread list as it was.
    for (const id of await threadIds(page)) {
      if (!before.has(id)) await page.request.delete(`/api/threads/${id}`);
    }
  }
});
