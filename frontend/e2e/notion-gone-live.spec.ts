/**
 * The page we made in Notion was deleted by hand. Sending again must not dead-end:
 * the panel offers "Create it again", and the note is back in Notion.
 * TEST workspace only (NOTION_TEST_TOKEN); refuses to run if Notion is already connected; cleans up.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

function testToken(): string {
  const env = fs.readFileSync(path.join(process.cwd(), "..", "backend", ".env"), "utf8");
  return env.match(/^NOTION_TEST_TOKEN=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "");
}
async function notion(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(`https://api.notion.com/v1${url}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Notion-Version": "2026-03-11" }, body: body ? JSON.stringify(body) : undefined });
  return r.json() as Promise<any>;
}
const slow = expect.configure({ timeout: 45_000 });
const para = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] });
const OUT = "e2e/screenshots/notion-sync/onenote";

test("page deleted in Notion → the next send offers Create it again", async ({ page }) => {
  test.setTimeout(420_000);
  const token = testToken();
  const st = await (await page.request.get("/api/ws/notion/status")).json();
  test.skip(st.connected, "Notion is already connected");
  const note = await (await page.request.post("/api/notes", { data: { title: "SB-TEST gone page", content: [para("a", "first version")] } })).json();
  try {
    await page.goto("/brain/settings/notion");
    await slow(page.getByTestId("notion-empty")).toBeVisible({ timeout: 180_000 });
    await page.getByLabel("Notion token").fill(token);
    await page.getByRole("button", { name: "Connect" }).click();
    await slow(page.getByTestId("notion-connected")).toBeVisible();
    await page.getByRole("button", { name: /SB-TEST-/ }).click();
    await slow(page.getByText("Sending here")).toBeVisible();

    await page.goto(`/brain/${note.id}`);
    await page.getByRole("button", { name: "Note options" }).click({ timeout: 180_000 });
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await slow(page.getByTestId("notion-result")).toContainText("Sent to Notion", { timeout: 90_000 });
    const href = await page.getByRole("dialog").getByRole("link", { name: /Open in Notion/ }).getAttribute("href");
    const pageId = href!.split("/").pop()!;
    await page.getByRole("button", { name: "Close" }).last().click();

    // someone deletes the page in Notion, and the note is edited
    await notion(token, "DELETE", `/blocks/${pageId}`);
    await page.request.patch(`/api/notes/${note.id}`, { data: { content: [para("a", "second version")], content_text: "second version" } });

    await page.getByRole("button", { name: "Note options" }).click();
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    await slow(page.getByTestId("notion-item")).toBeVisible();
    await page.screenshot({ path: `${OUT}/5-gone-review.png` });
    const again = page.getByRole("button", { name: /Create (it )?again/i });
    if (await again.count() === 0) {
      // not flagged at preview: the send itself must lead to the same choice
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await slow(page.getByRole("button", { name: /Create it again/ })).toBeVisible({ timeout: 90_000 });
      await page.screenshot({ path: `${OUT}/6-gone-result.png` });
      await page.getByRole("button", { name: /Create it again/ }).click();
    } else {
      await again.first().click();
      await page.getByRole("button", { name: "Send", exact: true }).click();
    }
    await slow(page.getByTestId("notion-result")).toContainText("Sent to Notion", { timeout: 90_000 });
    const href2 = await page.getByRole("dialog").getByRole("link", { name: /Open in Notion/ }).getAttribute("href");
    expect(href2).not.toEqual(href);
    const kids = await notion(token, "GET", `/blocks/${href2!.split("/").pop()}/children?page_size=20`);
    expect(JSON.stringify(kids.results)).toContain("second version");
  } finally {
    await page.request.delete(`/api/notes/${note.id}`, { timeout: 120_000 });
    await page.request.delete(`/api/notes/${note.id}/permanent`, { timeout: 120_000 });
    try {
      const root = (await notion(token, "POST", "/search", { filter: { property: "object", value: "page" } })).results.find((p: any) => p.parent?.type === "workspace");
      if (root && /^SB-TEST-/.test(root.properties?.title?.title?.[0]?.plain_text ?? "")) {
        for (const b of (await notion(token, "GET", `/blocks/${root.id}/children?page_size=100`)).results ?? []) {
          const t = b.child_page?.title ?? b.child_database?.title ?? "";
          if (b.type === "child_database" || t.startsWith("SB-TEST")) await notion(token, "DELETE", `/blocks/${b.id}`);
        }
      }
    } catch { /* best effort */ }
    await page.request.post("/api/ws/notion/disconnect");
  }
});
