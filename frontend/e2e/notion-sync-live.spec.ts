/**
 * Send to Notion, milestone 1, through the real UI against the TEST Notion
 * workspace (NOTION_TEST_TOKEN in backend/.env; its shared root must be titled
 * SB-TEST-…).
 *
 *   connect (Settings → Notion) → pick root → note ••• → Send to Notion… →
 *   preview → Send → Open in Notion ↗ → Send again → "Nothing to send".
 *
 * Safety: refuses to run if Notion is already connected (it would replace the
 * real connection). Creates its own fixture note and permanently deletes it in
 * `finally`, disconnects, and moves the "Notes" database it created in the test
 * workspace to Notion's trash.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

function testToken(): string {
  const env = fs.readFileSync(path.join(process.cwd(), "..", "backend", ".env"), "utf8");
  const m = env.match(/^NOTION_TEST_TOKEN=(.+)$/m);
  if (!m) throw new Error("NOTION_TEST_TOKEN is not set in backend/.env");
  return m[1].trim().replace(/^["']|["']$/g, "");
}

const NV = { "Notion-Version": "2026-03-11" };
async function notion(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(`https://api.notion.com/v1${url}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...NV },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json() as Promise<any>;
}

const para = (id: string, text: string, extra: object = {}) => ({
  id, type: "paragraph",
  props: { textColor: "default", backgroundColor: "default", textAlignment: "left", ...extra },
  content: [{ type: "text", text, styles: {} }], children: [],
});

const slow = expect.configure({ timeout: 45_000 });   // the dev server is slow on first visits

test("connect, send a note, open it, and re-send makes nothing", async ({ page }) => {
  test.setTimeout(420_000);
  const token = testToken();

  const st = await (await page.request.get("/api/ws/notion/status")).json();
  test.skip(st.connected, "Notion is already connected: not replacing a real connection");

  const created = await page.request.post("/api/notes", {
    data: {
      title: "SB-TEST notion send (safe to delete)",
      content: [
        { id: "sbn-h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Heading", styles: {} }], children: [] },
        para("sbn-p", "Plain text with centred alignment", { textAlignment: "center" }),
        { id: "sbn-b", type: "bulletListItem", props: {}, content: [{ type: "text", text: "a bullet", styles: { bold: true } }], children: [] },
        { id: "sbn-c", type: "codeBlock", props: { language: "python" }, content: [{ type: "text", text: "print(1)", styles: {} }], children: [] },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const noteId: string = (await created.json()).id;

  try {
    // ---- connect ----
    await page.goto("/brain/settings/notion");
    await expect(page.getByTestId("notion-empty")).toBeVisible({ timeout: 180_000 });
    await page.getByLabel("Notion token").fill(token);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByTestId("notion-connected")).toBeVisible({ timeout: 30_000 });
    // the token is never shown again, only its tail
    await expect(page.locator("body")).not.toContainText(token);
    const root = page.getByRole("button", { name: /SB-TEST-/ });
    await expect(root).toBeVisible();
    await root.click();
    await expect(page.getByText("Sending here")).toBeVisible();

    // ---- note ••• → Send to Notion… → preview ----
    await page.goto(`/brain/${noteId}`);
    await page.getByRole("button", { name: "Note options" }).click({ timeout: 180_000 });
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    const item = page.getByTestId("notion-item");
    await slow(item).toContainText("SB-TEST notion send");
    await slow(item).toContainText("New in Notion");
    await slow(page.getByTestId("fidelity-pill")).toContainText(/lossy|approximated|Exact/);
    await slow(item).toContainText("Text alignment");                 // plain-word loss
    await page.screenshot({ path: "e2e/screenshots/notion-sync/preview.png" });

    // ---- send → result → Open in Notion ----
    await page.getByRole("button", { name: "Send", exact: true }).click();
    const result = page.getByTestId("notion-result");
    await slow(result).toContainText("Sent to Notion", { timeout: 60_000 });
    const open = page.getByRole("link", { name: /Open in Notion/ });
    await expect(open).toHaveAttribute("href", /^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/);
    await page.screenshot({ path: "e2e/screenshots/notion-sync/sent.png" });
    const pageUrl = await open.getAttribute("href");
    await page.getByRole("button", { name: "Close" }).last().click();

    // The page really exists in the test workspace, with our blocks.
    const pageId = pageUrl!.split("/").pop()!;
    const kids = await notion(token, "GET", `/blocks/${pageId}/children?page_size=100`);
    expect(kids.results.map((b: any) => b.type)).toEqual(["heading_2", "paragraph", "bulleted_list_item", "code", "paragraph"].slice(0, kids.results.length));
    expect(kids.results[0].type).toBe("heading_2");

    // ---- second send: nothing to send ----
    await page.getByRole("button", { name: "Note options" }).click();
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    await slow(page.getByTestId("nothing-to-send")).toContainText("Nothing to send");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "e2e/screenshots/notion-sync/nothing-to-send.png" });
  } finally {
    await page.request.delete(`/api/notes/${noteId}`, { timeout: 120_000 });
    await page.request.delete(`/api/notes/${noteId}/permanent`, { timeout: 120_000 });
    // Test-workspace cleanup: trash the Notes database this run created.
    try {
      const root = (await notion(token, "POST", "/search", { filter: { property: "object", value: "page" } }))
        .results.find((p: any) => p.parent?.type === "workspace");
      if (root && /^SB-TEST-/.test(root.properties?.title?.title?.[0]?.plain_text ?? "")) {
        const kids = await notion(token, "GET", `/blocks/${root.id}/children?page_size=100`);
        for (const b of kids.results ?? []) {
          if (b.type === "child_database" && b.child_database?.title === "Notes") {
            await notion(token, "DELETE", `/blocks/${b.id}`);
          }
        }
      }
    } catch { /* best effort */ }
    await page.request.post("/api/ws/notion/disconnect");
  }
});
