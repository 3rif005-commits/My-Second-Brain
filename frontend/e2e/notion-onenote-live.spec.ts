/**
 * Send ONE note when Notion is not connected yet: the whole thing happens in the panel
 * (paste token → pick page → review → Send → Open in Notion). The page must never go to Settings.
 * TEST workspace only (NOTION_TEST_TOKEN in backend/.env); refuses to run if already connected; cleans up.
 */
import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

function testToken(): string {
  const env = fs.readFileSync(path.join(process.cwd(), "..", "backend", ".env"), "utf8");
  return env.match(/^NOTION_TEST_TOKEN=(.+)$/m)![1].trim().replace(/^["']|["']$/g, "");
}
const NV = { "Notion-Version": "2026-03-11" };
async function notion(token: string, method: string, url: string, body?: unknown) {
  const r = await fetch(`https://api.notion.com/v1${url}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...NV }, body: body ? JSON.stringify(body) : undefined });
  return r.json() as Promise<any>;
}
const slow = expect.configure({ timeout: 45_000 });
const OUT = "e2e/screenshots/notion-sync/onenote";

test("one note, not connected: connect + pick page + send, all inside the panel", async ({ page }) => {
  test.setTimeout(420_000);
  const token = testToken();
  const st = await (await page.request.get("/api/ws/notion/status")).json();
  test.skip(st.connected, "Notion is already connected");
  const note = await (await page.request.post("/api/notes", { data: { title: "SB-TEST one note", content: [
    { id: "a", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Hello Notion", styles: {} }], children: [] },
    { id: "b", type: "paragraph", props: {}, content: [{ type: "text", text: "Sent from the panel, no Settings page.", styles: {} }], children: [] }] } })).json();
  try {
    await page.goto(`/brain/${note.id}`);
    await page.getByRole("button", { name: "Note options" }).click({ timeout: 180_000 });
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    await slow(page.getByTestId("notion-not-connected")).toBeVisible();
    await page.screenshot({ path: `${OUT}/1-connect.png` });
    await page.getByLabel("Notion token").fill(token);
    await page.getByRole("button", { name: "Connect" }).click();
    await slow(page.getByRole("button", { name: /SB-TEST-/ })).toBeVisible();
    await page.screenshot({ path: `${OUT}/2-pick-page.png` });
    await page.getByRole("button", { name: /SB-TEST-/ }).click();
    await slow(page.getByTestId("notion-item")).toContainText("SB-TEST one note");
    expect(page.url()).toContain(`/brain/${note.id}`);                       // never left the note
    await page.screenshot({ path: `${OUT}/3-review.png` });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await slow(page.getByTestId("notion-result")).toContainText("Sent to Notion", { timeout: 60_000 });
    const href = await page.getByRole("link", { name: /Open in Notion/ }).getAttribute("href");
    await page.screenshot({ path: `${OUT}/4-sent.png` });
    const kids = await notion(token, "GET", `/blocks/${href!.split("/").pop()}/children?page_size=50`);
    expect(JSON.stringify(kids.results)).toContain("Sent from the panel");
    expect(page.url()).toContain(`/brain/${note.id}`);
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
