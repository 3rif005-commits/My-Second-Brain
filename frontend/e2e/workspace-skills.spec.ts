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
import { openPanel, waitSourcesReady } from "./helpers/panel";

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
  // The first request after login can come back as an error body: ask again.
  let rows: { note_id: string; source_count: number }[] = [];
  for (let i = 0; i < 3 && !rows.length; i++) {
    const body = await (await page.request.get("/api/ws/sessions/recent?limit=200")).json().catch(() => null);
    if (Array.isArray(body)) rows = body;
    else await page.waitForTimeout(1500);
  }
  const hit = rows.find((r) => match.test(`${r.source_count} source${r.source_count === 1 ? "" : "s"}`));
  expect(hit, `no workspace session with ${match}`).toBeTruthy();
  await page.goto(`/brain/workspace/${hit!.note_id}`, { waitUntil: "domcontentloaded" });
  await openPanel(page);           // the app's one AI panel, bound to this note
}

const aiPanel = (page: Page) => page.getByRole("textbox", { name: /message the ai/i });

test.describe("workspace: sources · note · AI", () => {
  test.setTimeout(120_000);

  test("sources · note, and the jobs live in the app's AI panel", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openRecent(page, /2 sources/);

    // The old buttons are gone.
    await expect(page.getByRole("button", { name: /generate note|re-synthesize/i })).toHaveCount(0);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });

    // The empty panel is just the question; "/" lists every job.
    await aiPanel(page).click();
    await page.keyboard.type("/");
    for (const job of ["/study-guide", "/flashcards", "/compare-sources"]) {
      await expect(page.getByRole("option", { name: new RegExp(job) })).toBeVisible({ timeout: 30_000 });
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
    await aiPanel(page).click();
    await page.keyboard.type("/comp");
    const compare = page.getByRole("option", { name: /\/compare-sources/ });
    await expect(compare).toBeVisible({ timeout: 30_000 });
    await expect(compare).toContainText(/two sources|failed|waiting/i);
    await ss(page, "03-blocked-with-reason");
  });

  test("both side panels collapse and come back; the note stays", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".bn-editor").first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Close AI panel" }).click();
    await expect(aiPanel(page)).toHaveCount(0);
    // On a narrow screen the sources may already have stepped aside for the AI.
    if (await page.getByTitle("Collapse the sources panel").count())
      await page.getByTitle("Collapse the sources panel").click();
    await expect(page.locator(".bn-editor").first()).toBeVisible();
    await ss(page, "04-collapsed");
    await page.getByRole("button", { name: "Open AI panel", exact: true }).click();
    await page.getByTitle("Show the sources").click();
    await expect(aiPanel(page)).toBeVisible();
  });

  test("the editor's slash menu offers the same jobs", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await expect(aiPanel(page)).toBeVisible({ timeout: 30_000 });
    await page.locator(".bn-editor[contenteditable='true']").first().click();
    await page.keyboard.type("/flash");
    try {
      await expect(page.getByText(/^Flashcards$/).first()).toBeVisible({ timeout: 10_000 });
      await ss(page, "05-slash-menu");
    } finally {
      // This is a real note: take the typed "/flash" back out — even when the
      // check above failed (it once left four of them in a user's title).
      await page.keyboard.press("Escape");      // runs nothing: free
      for (let i = 0; i < "/flash".length; i++) await page.keyboard.press("Backspace");
    }
  });

  test("dropping a source indexes it without generating anything", async ({ page }) => {
    await page.goto("/brain/workspace", { waitUntil: "networkidle" });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /choose files/i }).click(),
    ]);
    await chooser.setFiles(FIXTURE);
    await page.waitForURL(/\/brain\/workspace\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await waitSourcesReady(page, page.url().split("/").pop()!, 90_000);
    await expect(page.locator(".bn-editor h1")).toHaveCount(0);   // nothing was written
    await ss(page, "06-offered-not-fired");
    await page.request.delete(`/api/notes/${page.url().split("/").pop()}`);   // its own note
  });
});

test.describe("one AI for the whole app", () => {
  test.setTimeout(120_000);

  test("the workspace uses the app's own AI panel; ⌘K opens and focuses it", async ({ page }) => {
    await openRecent(page, /2 sources/);
    // Exactly one AI: the app panel. The workspace draws none of its own.
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).toHaveCount(1);
    await expect(aiPanel(page)).toHaveCount(1);
    // No prices: the model may be any provider, or a local one.
    await expect(page.getByRole("log").getByText(/\$\d/)).toHaveCount(0);
    await page.getByRole("button", { name: "Close AI panel" }).click();
    await expect(aiPanel(page)).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(aiPanel(page)).toBeFocused({ timeout: 10_000 });
    await ss(page, "07-one-ai");
  });

  test("elsewhere ⌘K opens the same panel — no separate quick-ask box", async ({ page }) => {
    await page.goto("/brain", { waitUntil: "networkidle" });
    await page.keyboard.press("Control+k");
    await expect(aiPanel(page)).toBeFocused({ timeout: 10_000 });
    await expect(page.getByRole("complementary", { name: "AI assistant panel" })).toHaveCount(1);
  });
});

test.describe("the AI button: bottom-right, covering nothing", () => {
  test.setTimeout(120_000);
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  test("workspace header and note page menu stay clear of it while the panel is closed", async ({ page }) => {
    await openRecent(page, /2 sources/);
    await page.getByRole("button", { name: "Close AI panel" }).click();
    const ai = page.getByRole("button", { name: "Open AI panel", exact: true });
    await expect(ai).toBeVisible();
    // Notion-style: bottom-right, away from the page's own actions at the top.
    const vp = page.viewportSize()!;
    const b = (await ai.boundingBox())!;
    expect(b.y).toBeGreaterThan(vp.height / 2);
    expect(b.x).toBeGreaterThan(vp.width / 2);
    const own = page.getByTitle("Open this note on its own page");
    expect(overlaps((await ai.boundingBox())!, (await own.boundingBox())!)).toBe(false);
    await own.click();                                  // reachable, not under the AI button
    await page.waitForURL(/\/brain\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const menu = page.getByRole("button", { name: "Note options" });
    await expect(menu).toBeVisible({ timeout: 30_000 });
    expect(overlaps((await ai.boundingBox())!, (await menu.boundingBox())!)).toBe(false);
  });
});
