/**
 * Settings → Skills, the Notion-style editor (user decision, 2026-09-24) —
 * free, and it leaves the user's skills as it found them: it only edits a
 * built-in the user has NOT edited (and resets it), and deletes what it makes.
 *
 *   npx playwright test --project=settings-skills
 */
import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const OUT = path.join(process.cwd(), "e2e/screenshots/settings-skills");
const TEMP = "e2e-exam-questions";

async function ss(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function skills(page: Page) {
  return (await (await page.request.get("/api/skills")).json()).skills as
    { name: string; source: string; where: string; files: string[] }[];
}

test.afterEach(async ({ page }) => {
  await page.request.delete(`/api/skills/${TEMP}`).catch(() => {});
});

test("the layout: sections on top, skills grouped on the left, a skill as a page", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/brain/settings", { waitUntil: "networkidle" });
  await page.waitForURL(/\/brain\/settings\/skills/);
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  for (const g of [/AI panel jobs/i, /Actions on selected text/i, /Assistant rules/i])
    await expect(page.getByRole("heading", { name: g })).toBeVisible({ timeout: 60_000 });

  // The study guide as a page: its properties, and its reference files.
  await page.getByRole("button", { name: /^Study guide/ }).first().click();
  await page.waitForURL(/skill=study-guide/);
  await expect(page.getByRole("heading", { level: 1, name: "Study guide" })).toBeVisible();
  for (const p of ["where", "command", "shows-up", "description", "version"])
    await expect(page.getByTestId(`property-${p}`)).toBeVisible();
  await expect(page.getByTestId("property-command")).toContainText("/study-guide");
  await expect(page.getByTestId("property-result")).toHaveCount(0);        // a job has no result choice
  await expect(page.getByRole("tab", { name: /Files/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).not.toHaveValue("");
  // No prices, no model picker: nothing that would not change anything.
  await expect(page.getByText(/\$\d/)).toHaveCount(0);
  await ss(page, "01-skill-page");

  // Search narrows the list.
  await page.getByLabel("Search skills").fill("compare");
  await expect(page.getByRole("button", { name: /^Compare sources/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Study guide/ })).toHaveCount(0);
});

test("new from a template → write → ⌘S → try it → unsaved guard → delete", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/brain/settings/skills", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^New$/ }).click();
  await expect(page.getByRole("dialog", { name: "New skill" })).toBeVisible();
  await ss(page, "02-templates");
  await page.getByTestId("template-exam-questions").click();
  await page.getByLabel("Command").fill(TEMP);
  await page.getByRole("button", { name: "Create skill" }).click();
  await page.waitForURL(new RegExp(`skill=${TEMP}`), { timeout: 30_000 });
  await expect(page.getByTestId("property-command")).toContainText(`/${TEMP}`);

  // Write, see the save bar, save with ⌘S.
  const body = page.getByRole("textbox", { name: "Instructions", exact: true });
  await body.click();
  await page.keyboard.press("End");
  await body.fill((await body.inputValue()) + "\n- E2E extra rule.");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await ss(page, "03-unsaved");
  await page.keyboard.press("Control+s");
  await expect(page.getByText("Unsaved changes")).toHaveCount(0, { timeout: 15_000 });
  const saved = await (await page.request.get(`/api/skills/${TEMP}`)).json();
  expect(saved.body).toContain("E2E extra rule.");

  // Try it: the one AI panel opens with the command typed, nothing sent.
  await page.getByRole("button", { name: /Try it/ }).click();
  await expect(page.getByRole("textbox", { name: /message the ai/i })).toHaveValue(`/${TEMP} `);
  await page.getByRole("button", { name: "Close AI panel" }).click();

  // An unsaved edit is not lost by clicking away: the guard asks.
  await body.fill((await body.inputValue()) + "\nnot saved");
  await page.getByRole("button", { name: /^Compare sources/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Discard unsaved changes?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(body).toHaveValue(/not saved/);
  await page.getByRole("button", { name: "Discard" }).click();

  // Delete from the ⋯ menu.
  await page.getByRole("button", { name: new RegExp(`More actions for ${TEMP.replace(/-/g, " ")}`, "i") }).last().click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect.poll(async () => (await skills(page)).some((s) => s.name === TEMP)).toBe(false);
});

test("a built-in: edit → saved as your version → compare with original → reset", async ({ page }) => {
  test.setTimeout(180_000);
  // Only a built-in the user has not edited, so Reset cannot touch their work.
  const target = (await skills(page)).find((s) => s.source === "bundled" && s.where === "selection");
  test.skip(!target, "every selection built-in is already edited by the user");
  const name = target!.name;
  await page.goto(`/brain/settings/skills?skill=${name}`, { waitUntil: "networkidle" });
  await expect(page.getByText(/A built-in skill\./)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("property-result")).toBeVisible();          // a selection action chooses its result

  try {
    const body = page.getByRole("textbox", { name: "Instructions", exact: true });
    await body.fill((await body.inputValue()) + "\nE2E marker line.");
    await expect(page.getByText(/saving creates your own version/)).toBeVisible();
    await page.getByRole("button", { name: /^Save/ }).click();
    await expect(page.getByTestId("property-version")).toContainText("Your version", { timeout: 15_000 });
    await page.getByRole("tab", { name: /Compare with original/ }).click();
    await expect(page.getByText("+1")).toBeVisible();
    await expect(page.getByText("E2E marker line.").last()).toBeVisible();
    await ss(page, "04-compare");
  } finally {
    await page.request.delete(`/api/skills/${name}`);          // Reset, whatever happened
  }
  const after = (await skills(page)).find((s) => s.name === name);
  expect(after?.source).toBe("bundled");
});

test("the save bar stays clear of the AI button", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/brain/settings/skills?skill=study-guide", { waitUntil: "networkidle" });
  const desc = page.getByRole("textbox", { name: "Description" });
  await expect(desc).toBeVisible({ timeout: 60_000 });
  const before = await desc.inputValue();
  await desc.fill(before + " x");                                  // only to show the bar — never saved
  const save = page.getByRole("button", { name: /^Save/ });
  const ai = page.getByRole("button", { name: "Open AI panel", exact: true });
  const a = (await save.boundingBox())!, b = (await ai.boundingBox())!;
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(desc).toHaveValue(before);
});

test("the study guide: Several sources and Your style — learn suggests, nothing is saved", async ({ page }) => {
  // E9 + E12. Free: with no edited guides the learner answers without a model.
  await page.goto("/brain/settings/skills?skill=study-guide", { waitUntil: "networkidle" });
  await expect(page.getByTestId("property-several-sources")).toContainText("Automatic", { timeout: 30_000 });
  await page.getByRole("tab", { name: /your style/i }).click();
  const style = page.getByRole("textbox", { name: "Your style" });
  await expect(style).toBeVisible();
  await expect(style).toHaveValue(/<!--/);                 // the explanation, never sent
  await page.getByRole("button", { name: "Learn from my edits" }).click();
  await expect(page.getByTestId("style-suggestions")).toBeVisible({ timeout: 60_000 });
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, "05-your-style.png") });
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();   // nothing changed
});
