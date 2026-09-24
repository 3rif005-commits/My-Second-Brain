/**
 * The workspace's three panels and the jobs in its AI panel — free: nothing
 * here runs a model (user decision, 2026-09-24: jobs moved from buttons into
 * the AI panel, as /commands; results are previewed before they reach the note).
 *
 *   npx playwright test --project=workspace-skills
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const SCREENSHOT_DIR = path.join(process.cwd(), "e2e/screenshots/workspace-skills");
const FIXTURE = path.join(process.cwd(), "e2e/fixtures/test.pdf");

async function ss(page: Page, name: string) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

/** Open a workspace session whose source count matches. Looked up by API,
 *  not clicked on the landing strip: the strip shows only the 12 most recent,
 *  and every live run adds a one-source "test" note that pushes older ones off. */
async function openRecent(page: Page, match: RegExp) {
  const res = await page.request.get("/api/ws/sessions/recent?limit=200");
  const rows: { note_id: string; source_count: number }[] = await res.json();
  const hit = rows.find((r) => match.test(`${r.source_count} source${r.source_count === 1 ? "" : "s"}`));
  expect(hit, `no workspace session with ${match}`).toBeTruthy();
  await page.goto(`/brain/workspace/${hit!.note_id}`, { waitUntil: "domcontentloaded" });
}

const aiPanel = (page: Page) => page.getByRole("textbox", { name: /message the ai/i });

test.describe("workspace: sources · note · AI", () => {
  test.setTimeout(120_000);

  test("three panels, and the jobs live in the AI panel, priced", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openRecent(page, /2 sources/);

    // The old buttons are gone.
    await expect(page.getByRole("button", { name: /generate note|re-synthesize/i })).toHaveCount(0);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });

    // Every job is offered in the empty AI panel with its price.
    for (const job of ["/study-guide", "/flashcards", "/compare-sources"]) {
      await expect(page.getByRole("button", { name: new RegExp(job) })).toBeVisible({ timeout: 30_000 });
    }
    await ss(page, "01-three-panels");
    expect(errors, `page errors: ${errors.join(" | ")}`).toHaveLength(0);
  });

  test("typing / in the AI panel lists the jobs", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await aiPanel(page).click();
    await page.keyboard.type("/fl");
    await expect(page.getByRole("option", { name: /\/flashcards/ })).toBeVisible({ timeout: 15_000 });
    await ss(page, "02-slash-in-chat");
    await page.keyboard.press("Tab");
    await expect(aiPanel(page)).toHaveValue("/flashcards ");
  });

  test("a job that cannot run says why", async ({ page }) => {
    await openRecent(page, /1\s*source/);
    const compare = page.getByRole("button", { name: /\/compare-sources/ });
    await expect(compare).toBeVisible({ timeout: 30_000 });
    await expect(compare).toBeDisabled();
    await expect(compare).toContainText(/two sources|failed|waiting/i);
    await ss(page, "03-blocked-with-reason");
  });

  test("both side panels collapse and come back; the note stays", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".bn-editor").first()).toBeVisible({ timeout: 60_000 });
    await page.getByTitle("Collapse the AI panel").first().click();
    await expect(aiPanel(page)).toHaveCount(0);
    // On a narrow screen the sources may already have stepped aside for the AI.
    if (await page.getByTitle("Collapse the sources panel").count())
      await page.getByTitle("Collapse the sources panel").click();
    await expect(page.locator(".bn-editor").first()).toBeVisible();
    await ss(page, "04-collapsed");
    await page.getByTitle("Open the AI panel").first().click();
    await page.getByTitle("Show the sources").click();
    await expect(aiPanel(page)).toBeVisible();
  });

  test("the editor's slash menu offers the same jobs", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });
    await page.locator(".bn-editor[contenteditable='true']").first().click();
    await page.keyboard.type("/flash");
    await expect(page.getByText(/^Flashcards$/).first()).toBeVisible({ timeout: 10_000 });
    await ss(page, "05-slash-menu");
    await page.keyboard.press("Escape");        // runs nothing: free
  });

  test("dropping a source indexes it without generating anything", async ({ page }) => {
    await page.goto("/brain/workspace", { waitUntil: "networkidle" });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /choose files/i }).click(),
    ]);
    await chooser.setFiles(FIXTURE);
    await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: /\/study-guide/ })).toBeEnabled({ timeout: 90_000 });
    await expect(page.locator(".bn-editor h1")).toHaveCount(0);   // nothing was written
    await ss(page, "06-offered-not-fired");
  });
});

test.describe("one AI per screen", () => {
  test.setTimeout(120_000);

  test("on a workspace note the side panel steps aside and ⌘K focuses the workspace AI", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });
    // The app-wide assistant and its buttons are not on this screen.
    await expect(page.getByRole("button", { name: /thread history/i })).toHaveCount(0);
    await expect(page.getByPlaceholder("Ask anything about your notes…")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open AI panel", exact: true })).toHaveCount(0);
    // ⌘K reaches the workspace AI, even when collapsed.
    await page.getByTitle(/collapse the ai panel/i).first().click();
    await expect(aiPanel(page)).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(aiPanel(page)).toBeFocused({ timeout: 10_000 });
    await ss(page, "07-one-ai");
  });

  test("elsewhere the side panel is still there", async ({ page }) => {
    await page.goto("/brain", { waitUntil: "networkidle" });
    // Either the open panel or its reopen button is present on ordinary pages.
    const panel = page.getByPlaceholder("Ask anything about your notes…");
    const toggle = page.getByRole("button", { name: "Open AI panel", exact: true });
    await expect(panel.or(toggle).first()).toBeVisible({ timeout: 30_000 });
  });
});
