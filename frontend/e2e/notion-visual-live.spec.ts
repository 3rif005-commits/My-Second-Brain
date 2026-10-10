/**
 * Send to Notion: visual + keyboard pass against the TEST Notion workspace.
 * Screenshots (light/dark × 1280/390 px) go to e2e/screenshots/notion-sync/visual/.
 * Safety: refuses to run if Notion is already connected; creates only "SB-TEST …" notes and one
 * "SB-TEST visual" folder, deletes them in `finally`, trashes what it made in Notion, disconnects.
 */
import { test, expect, type Page } from "@playwright/test";
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
const para = (id: string, text: string) => ({
  id, type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
  content: [{ type: "text", text, styles: {} }], children: [],
});
const slow = expect.configure({ timeout: 45_000 });
test.use({ actionTimeout: 60_000 });
const OUT = "e2e/screenshots/notion-sync/visual";

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => { localStorage.setItem("sb-theme", t); document.documentElement.classList.toggle("dark", t === "dark"); }, theme);
}
async function noHorizontalScroll(page: Page, what: string) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(o.sw, `${what}: page scrolls sideways (${o.sw} > ${o.cw})`).toBeLessThanOrEqual(o.cw + 1);
}
/** The sidebar may be closed (desktop: floating "Open sidebar" button; phone: a drawer). */
async function showSidebar(page: Page) {
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(500);                         // let the slide transition settle
    const box = await page.getByRole("button", { name: "Collapse sidebar" }).boundingBox().catch(() => null);
    if (box && box.x >= 0 && box.x < 260) return;           // on screen (a closed drawer is translated off-screen)
    const open = page.getByRole("button", { name: "Open sidebar" });          // desktop: floating button
    const menu = page.getByRole("button", { name: "Open menu" });             // phone: header hamburger
    if (await open.isVisible().catch(() => false)) await open.click();
    else if (await menu.isVisible().catch(() => false)) await menu.click();
  }
}
/** Phone: the drawer stays open across navigation and covers the page, so close it before page shots. */
async function hideDrawer(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) >= 768) return;
  await page.waitForTimeout(800);
  const box = await page.getByRole("button", { name: "Collapse sidebar" }).boundingBox().catch(() => null);
  if (box && box.x >= 0 && box.x < 260) { await page.mouse.click(350, 420); await page.waitForTimeout(800); }   // the backdrop closes it
}
async function openFolderPanel(page: Page) {
  await showSidebar(page);
  await page.getByText("SB-TEST visual", { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
  await slow(page.getByTestId("notion-item").first()).toBeVisible();
}

test("Send to Notion: visual pass (light/dark, desktop/phone) and keyboard use", async ({ page }) => {
  test.setTimeout(900_000);
  const token = testToken();
  const st = await (await page.request.get("/api/ws/notion/status")).json();
  test.skip(st.connected, "Notion is already connected: not replacing a real connection");

  const col = await (await page.request.post("/api/collections", { data: { name: "SB-TEST visual", icon: "🧪" } })).json();
  const mk = async (title: string, text: string, inFolder = true) => (await (await page.request.post("/api/notes", {
    data: { title, ...(inFolder ? { collection_id: col.id } : {}), content: [para(`p-${title}`, text)] } })).json()).id as string;
  const ids = [await mk("SB-TEST visual one", "first note"), await mk("SB-TEST visual two", "second note")];
  const findings: string[] = [];

  try {
    // ---- Settings → Notion, all four sections, before and after connecting ----
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/brain/settings/notion");
    await slow(page.getByTestId("notion-empty")).toBeVisible({ timeout: 180_000 });
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await page.screenshot({ path: `${OUT}/settings-empty-${theme}.png` });
    }
    await setTheme(page, "light");
    await page.getByLabel("Notion token").fill(token);
    await page.getByRole("button", { name: "Connect" }).click();
    await slow(page.getByTestId("notion-connected")).toBeVisible();
    await page.getByRole("button", { name: /SB-TEST-/ }).click();
    await slow(page.getByText("Sending here")).toBeVisible();
    for (const name of ["Mirror status", "Auto-sync", "Activity", "Health"]) await slow(page.getByRole("region", { name })).toBeVisible();

    // send the folder once so the sidebar dots exist, then make one note "changed" and add a "new" one
    await page.goto("/brain");
    await openFolderPanel(page);
    await page.getByRole("button", { name: /Send 3 items/ }).click();
    await slow(page.getByTestId("notion-result")).toContainText("3 sent to Notion", { timeout: 120_000 });
    await page.getByRole("button", { name: "Close" }).last().click();
    await page.request.patch(`/api/notes/${ids[0]}`, { data: { content: [para("p2", "first note, edited")], content_text: "first note, edited" } });
    ids.push(await mk("SB-TEST visual three (new)", "third note"));

    const viewports = [{ n: "desktop", w: 1280, h: 800 }, { n: "phone", w: 390, h: 844 }];
    for (const vp of viewports) {
      for (const theme of ["light", "dark"] as const) {
        const tag = `${vp.n}-${theme}`;
        await page.setViewportSize({ width: vp.w, height: vp.h });
        // Settings page, whole page, all sections
        await page.goto("/brain/settings/notion");
        await setTheme(page, theme);
        await slow(page.getByTestId("notion-connected")).toBeVisible({ timeout: 120_000 });
        await slow(page.getByTestId("health")).toContainText("2026-03-11");           // loaded, not the skeleton
        await hideDrawer(page);
        await page.screenshot({ path: `${OUT}/settings-${tag}.png`, fullPage: true });
        for (const name of ["Mirror status", "Auto-sync", "Activity", "Health"]) {       // the page scrolls inside a container, so shoot each section
          await page.getByRole("region", { name }).screenshot({ path: `${OUT}/settings-${name.toLowerCase().replace(/\W+/g, "-")}-${tag}.png` });
        }
        await noHorizontalScroll(page, `settings ${tag}`).catch((e) => findings.push(String(e.message)));
        // sidebar with dots + folder context menu + review panel
        await page.goto("/brain");
        await setTheme(page, theme);
        await page.getByRole("navigation", { name: "Main navigation" }).waitFor({ state: "attached", timeout: 120_000 });
        await showSidebar(page);
        const header = page.getByText("SB-TEST visual", { exact: true }).first();
        await header.waitFor({ timeout: 120_000 });
        await page.screenshot({ path: `${OUT}/sidebar-${tag}.png` });
        await header.click({ button: "right" });
        await page.getByRole("menuitem", { name: /Send to Notion/ }).waitFor();
        await page.screenshot({ path: `${OUT}/folder-menu-${tag}.png` });
        await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
        await slow(page.getByTestId("notion-item").first()).toBeVisible();
        await page.screenshot({ path: `${OUT}/review-${tag}.png` });
        const box = await page.getByRole("dialog").boundingBox();
        if (box && (box.x < -1 || box.x + box.width > vp.w + 1)) findings.push(`review panel ${tag} overflows the viewport (${JSON.stringify(box)})`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    }

    // ---- keyboard only: focus lands in the dialog, Tab cycles inside it, Esc closes and gives focus back ----
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/brain");
    await setTheme(page, "light");
    await showSidebar(page);
    await page.getByText("SB-TEST visual", { exact: true }).first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /Send to Notion/ }).click();
    const dialog = page.getByRole("dialog");
    await slow(page.getByTestId("notion-item").first()).toBeVisible();
    const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    const label = () => page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      return e ? `${e.tagName.toLowerCase()}:${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}` : "none";
    });
    expect(await inDialog(), "focus is inside the dialog on open").toBe(true);
    const order: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if (!(await inDialog())) { findings.push(`Tab ${i + 1} left the dialog (focus on ${await label()})`); break; }
      order.push(await label());
    }
    await page.keyboard.press("Shift+Tab");
    if (!(await inDialog())) findings.push("Shift+Tab left the dialog");
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(`${OUT}/tab-order.txt`, order.join("\n") + "\n");
    await page.screenshot({ path: `${OUT}/keyboard-focus.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const back = await label();
    if (back === "body:" || back === "none") findings.push(`after Esc focus is not returned to anything (${back})`);
    fs.writeFileSync(`${OUT}/findings.txt`, findings.join("\n") + "\n");
    expect(findings, findings.join("\n")).toEqual([]);
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
