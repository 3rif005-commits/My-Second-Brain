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

test("a folder with notes: right-click → review with tabs → send → dots → Activity → Health", async ({ page }) => {
  test.setTimeout(480_000);
  const token = testToken();
  const st = await (await page.request.get("/api/ws/notion/status")).json();
  test.skip(st.connected, "Notion is already connected: not replacing a real connection");

  const col = await (await page.request.post("/api/collections", { data: { name: "SB-TEST folder", icon: "🧪" } })).json();
  const mk = async (title: string, text: string) => (await (await page.request.post("/api/notes", {
    data: { title, collection_id: col.id, content: [para(`p-${title}`, text)] } })).json()).id as string;
  const ids = [await mk("SB-TEST one", "first note"), await mk("SB-TEST two", "second note")];

  try {
    await page.goto("/brain/settings/notion");
    await slow(page.getByTestId("notion-empty")).toBeVisible({ timeout: 180_000 });
    await page.getByLabel("Notion token").fill(token);
    await page.getByRole("button", { name: "Connect" }).click();
    await slow(page.getByTestId("notion-connected")).toBeVisible();
    await page.getByRole("button", { name: /SB-TEST-/ }).click();
    await slow(page.getByText("Sending here")).toBeVisible();
    // the sections of M3-M11 are on the page
    for (const name of ["Mirror status", "Auto-sync", "Activity", "Health"]) await slow(page.getByRole("region", { name })).toBeVisible();
    await slow(page.getByTestId("activity-empty")).toBeVisible();

    // right-click the folder in the sidebar
    await page.goto("/brain");
    const header = page.getByText("SB-TEST folder", { exact: true });
    await header.waitFor({ timeout: 180_000 });
    await header.click({ button: "right" });
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    await slow(page.getByTestId("notion-item").first()).toBeVisible();
    const tabs = page.getByRole("tab");
    await expect(tabs.first()).toContainText("New 3");                       // the folder + its 2 notes
    await page.screenshot({ path: "e2e/screenshots/notion-sync/folder-review.png" });
    await page.getByRole("button", { name: "Send 3 items" }).click();
    await slow(page.getByTestId("notion-result")).toContainText("3 sent to Notion", { timeout: 120_000 });
    await page.screenshot({ path: "e2e/screenshots/notion-sync/folder-sent.png" });
    await page.getByRole("button", { name: "Close" }).last().click();

    // they now show an in-sync state (the ring is only drawn on hover, so look at the attribute)
    await expect.poll(async () => (await (await page.request.get("/api/ws/notion/mirror")).json()).collections[col.id]).toBe("synced");

    // Activity lists the run, Retry failed absent because nothing failed
    await page.goto("/brain/settings/notion?tab=activity");
    await slow(page.getByTestId("activity-list")).toBeVisible();
    await page.getByTestId("activity-list").getByRole("button").first().click();
    await slow(page.getByText("SB-TEST one").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry failed" })).toHaveCount(0);
    // Health shows the pinned version and the kill switch
    await expect(page.getByTestId("health")).toContainText("2026-03-11");
    await page.screenshot({ path: "e2e/screenshots/notion-sync/settings-full.png", fullPage: true });
    // the kill switch pauses and resumes
    await page.getByRole("button", { name: "Pause all syncing" }).click();
    await slow(page.getByRole("button", { name: "Resume syncing" })).toBeVisible();
    await page.getByRole("button", { name: "Resume syncing" }).click();
    await slow(page.getByRole("button", { name: "Pause all syncing" })).toBeVisible();

    // edit one note → it shows as changed and the panel offers just that one
    await page.request.patch(`/api/notes/${ids[0]}`, { data: { content: [para("p2", "first note, edited")], content_text: "first note, edited" } });
    await expect.poll(async () => (await (await page.request.get("/api/ws/notion/mirror")).json()).notes[ids[0]]).toBe("changed");
    const plan = await (await page.request.post("/api/ws/notion/plan", { data: { collection_ids: [col.id] } })).json();
    expect(plan.items.filter((i: any) => i.state === "changed").map((i: any) => i.title)).toEqual(["SB-TEST one"]);
  } finally {
    for (const id of ids) {
      await page.request.delete(`/api/notes/${id}`, { timeout: 120_000 });
      await page.request.delete(`/api/notes/${id}/permanent`, { timeout: 120_000 });
    }
    await page.request.delete(`/api/collections/${col.id}`);
    try {
      const root = (await notion(token, "POST", "/search", { filter: { property: "object", value: "page" } }))
        .results.find((p: any) => p.parent?.type === "workspace");
      if (root && /^SB-TEST-/.test(root.properties?.title?.title?.[0]?.plain_text ?? "")) {
        const kids = await notion(token, "GET", `/blocks/${root.id}/children?page_size=100`);
        for (const b of kids.results ?? []) {
          const title = b.child_page?.title ?? b.child_database?.title ?? "";
          if (b.type === "child_database" || title.startsWith("SB-TEST")) await notion(token, "DELETE", `/blocks/${b.id}`);
        }
      }
    } catch { /* best effort */ }
    await page.request.post("/api/ws/notion/disconnect");
  }
});

test("interactive blocks move from this browser's localStorage into the note (ledger B1)", async ({ page }) => {
  test.setTimeout(300_000);
  const created = await page.request.post("/api/notes", { data: { title: "SB-TEST interactive (safe to delete)", content: [para("p1", "text")] } });
  const noteId: string = (await created.json()).id;
  try {
    await page.goto("/brain");
    await page.evaluate(([id]) => localStorage.setItem(`interactive-${id}`, JSON.stringify([{ title: "My quiz", html: "<p>old browser-only block</p>" }])), [noteId]);
    await page.goto(`/brain/${noteId}`);
    await expect.poll(async () => {
      const c = (await (await page.request.get(`/api/notes/${noteId}`)).json()).content as any[];
      return c.some((b) => b.type === "interactive" && b.props?.html === "<p>old browser-only block</p>");
    }, { timeout: 120_000 }).toBe(true);
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`interactive-${id}`), noteId)).toBeNull();   // only after it was saved
    await slow(page.getByText("My quiz")).toBeVisible();
    await page.reload();
    await slow(page.getByText("My quiz")).toBeVisible();                       // it comes from the note now
  } finally {
    await page.request.delete(`/api/notes/${noteId}`, { timeout: 120_000 });
    await page.request.delete(`/api/notes/${noteId}/permanent`, { timeout: 120_000 });
  }
});
