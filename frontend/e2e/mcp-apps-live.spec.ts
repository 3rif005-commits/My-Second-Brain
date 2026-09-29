/**
 * MCP Apps (SEP-1865, 5.4) on the real running remote MCP server — FREE, no
 * model call. Confirms, over the real wire (not the in-process test client):
 *   - update_note/delete_note carry `_meta.ui.resourceUri`; other tools don't
 *   - the `ui://` resource is really served, with the exact MIME type
 *   - a real update_note call's structuredContent has everything the card
 *     renders (action, previews, review_url) — the same data a compliant
 *     host would push into the card via ui/notifications/tool-result
 *   - the "Review in Second Brain" link (?change=<id>) lands on and
 *     highlights the exact waiting change, then Approve applies it for real
 * Reuses mcp-remote-live's own OAuth flow. Deletes its note, revokes its token.
 *
 *   npx playwright test --project=mcp-remote e2e/mcp-apps-live.spec.ts
 */
import { test, expect, APIRequestContext } from "@playwright/test";
import crypto from "crypto";
import path from "path";
import fs from "fs";

const MCP = process.env.MCP_E2E_URL ?? "http://localhost:8765";
const REDIRECT = "http://localhost:9999/callback";
const OUT = path.join(process.cwd(), "e2e/screenshots/mcp-apps-live");

async function rpc(request: APIRequestContext, token: string, method: string, params = {}) {
  const r = await request.post(`${MCP}/mcp`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream",
      "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(r.status(), await r.text()).toBe(200);
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}

function structured(msg: { result: { structuredContent?: Record<string, unknown> } }) {
  return msg.result.structuredContent ?? {};
}

// create_note/get_note were never given structured_output=True (only
// update_note/delete_note were, so their card gets real structuredContent) —
// same text-parsing fallback mcp-remote-live.spec.ts's own toolResult() uses.
function plainResult(msg: { result: { content: { text: string }[] } }) {
  return JSON.parse(msg.result.content[0].text);
}

test("update_note points at a real MCP Apps resource, and its own result is the card's data", async ({ page, request }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });

  const reg = await request.post(`${MCP}/register`, { data: {
    redirect_uris: [REDIRECT], client_name: "E2E MCP Apps test", token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } });
  const clientId = (await reg.json()).client_id as string;
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const auth = await request.get(`${MCP}/authorize`, { maxRedirects: 0, params: {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", state: "e2e", scope: "brain" } });
  let callback = "";
  await page.route("http://localhost:9999/**", (route) => { callback = route.request().url(); return route.fulfill({ body: "ok" }); });
  await page.goto(auth.headers()["location"]);
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => callback, { timeout: 30_000 }).toContain("code=");
  const tok = await (await request.post(`${MCP}/token`, { form: { grant_type: "authorization_code",
    code: new URL(callback).searchParams.get("code")!, redirect_uri: REDIRECT, client_id: clientId,
    code_verifier: verifier } })).json();
  const token = tok.access_token as string;

  let noteId = "";
  try {
    // ── the tool list, over the real wire, carries the UI meta ────────────
    const tools = await rpc(request, token, "tools/list");
    const byName = Object.fromEntries(
      (tools.result.tools as { name: string; _meta?: Record<string, unknown> }[]).map((t) => [t.name, t]));
    for (const name of ["update_note", "delete_note"]) {
      expect((byName[name]._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri)
        .toBe("ui://second-brain/pending-change");
    }
    for (const name of ["search_notes", "list_notes", "get_note", "create_note", "check_change"]) {
      expect((byName[name]._meta as { ui?: unknown } | undefined)?.ui).toBeFalsy();
    }

    // ── the resource itself is really served ──────────────────────────────
    const res = await rpc(request, token, "resources/read", { uri: "ui://second-brain/pending-change" });
    const content = res.result.contents[0] as { mimeType: string; text: string };
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("ui/initialize");
    expect(content.text).toContain("ui/notifications/tool-result");

    // ── a real edit, and the exact data a host would push into the card ───
    type Created = { note_id: string };
    const createdNote = plainResult(await rpc(request, token, "tools/call", { name: "create_note",
      arguments: { title: "E2E MCP Apps note (temporary)", content_markdown: "Some old text here." } })) as Created;
    noteId = createdNote.note_id;

    type Asked = { change_id: string; action: string; note_title: string; current_text_preview: string;
      new_text_preview: string; review_url: string };
    const asked = structured(await rpc(request, token, "tools/call", { name: "update_note",
      arguments: { note_id: noteId, content_markdown: "Brand new text from the app.", reason: "e2e mcp apps" } })) as Asked;
    expect(asked.action).toBe("update");
    expect(asked.note_title).toBe("E2E MCP Apps note (temporary)");
    expect(asked.current_text_preview).toBe("Some old text here.");
    expect(asked.new_text_preview).toBe("Brand new text from the app.");
    expect(asked.review_url).toBe("http://localhost:3000/brain/settings/connected-apps");

    // ── the review link lands on, and highlights, the exact waiting change ─
    await page.goto(`${asked.review_url}?change=${asked.change_id}`);
    const card = page.locator(`#change-${asked.change_id}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveClass(/ring-indigo-400/);
    await expect(card).toContainText("Brand new text from the app.");
    await page.screenshot({ path: path.join(OUT, "01-highlighted-card.png") });

    // approving it here is the SAME code path already live-tested
    // (mcp-remote-live's own approval test) — one more pass confirms the
    // MCP Apps card's own change_id is the one that actually gets approved.
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(card).toBeHidden({ timeout: 30_000 });
    const after = plainResult(await rpc(request, token, "tools/call",
      { name: "get_note", arguments: { note_id: noteId } })) as { text: string };
    expect(after.text).toContain("Brand new text from the app.");
  } finally {
    if (noteId) await page.request.delete(`/api/notes/${noteId}`, { timeout: 30_000 }).catch(() => {});
    await request.post(`${MCP}/revoke`, { form: { token: tok.refresh_token, client_id: clientId } });
    await request.post(`${MCP}/revoke`, { form: { token, client_id: clientId } });
  }
});
