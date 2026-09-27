/**
 * The remote MCP server (5.4), live against the running app: an app
 * registers, the user clicks Allow on the real Allow page, the app gets a
 * token and uses the tools. FREE (no model call). Deletes the note it
 * creates and revokes its token.
 *
 *   npx playwright test --project=mcp-remote e2e/mcp-remote-live.spec.ts
 */
import { test, expect, APIRequestContext } from "@playwright/test";
import crypto from "crypto";
import path from "path";
import fs from "fs";

const MCP = process.env.MCP_E2E_URL ?? "http://localhost:8765";
const REDIRECT = "http://localhost:9999/callback";
const OUT = path.join(process.cwd(), "e2e/screenshots/mcp-remote-live");

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

function toolResult(msg: { result: { structuredContent?: { result?: unknown }; content: { text: string }[] } }) {
  return msg.result.structuredContent?.result ?? JSON.parse(msg.result.content[0].text);
}

test("an app logs in with Allow and uses the tools as this user", async ({ page, request }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });

  // 1. the app registers itself
  const reg = await request.post(`${MCP}/register`, { data: {
    redirect_uris: [REDIRECT], client_name: "E2E test app", token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } });
  expect(reg.status()).toBe(201);
  const clientId = (await reg.json()).client_id as string;

  // 2. authorize → the Allow page, in the signed-in browser
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const auth = await request.get(`${MCP}/authorize`, { maxRedirects: 0, params: {
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge,
    code_challenge_method: "S256", state: "e2e", scope: "brain" } });
  expect(auth.status()).toBe(302);
  const allowPage = auth.headers()["location"];
  expect(allowPage).toContain("/mcp-connect?request=");

  let callback = "";
  await page.route("http://localhost:9999/**", (route) => {
    callback = route.request().url();
    return route.fulfill({ status: 200, body: "ok" });
  });
  await page.goto(allowPage);
  await expect(page.getByTestId("mcp-connect-title")).toHaveText("E2E test app wants to use your Second Brain",
    { timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, "01-allow-page.png") });
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => callback, { timeout: 30_000 }).toContain("code=");
  const code = new URL(callback).searchParams.get("code")!;
  expect(new URL(callback).searchParams.get("state")).toBe("e2e");

  // 3. code + PKCE verifier → token
  const tok = await request.post(`${MCP}/token`, { form: {
    grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId,
    code_verifier: verifier } });
  expect(tok.status(), await tok.text()).toBe(200);
  const { access_token: token, refresh_token: refresh } = await tok.json();

  // 4. the tools, as this user
  let created = "";
  try {
    const tools = await rpc(request, token, "tools/list");
    expect(tools.result.tools.map((t: { name: string }) => t.name).sort())
      .toEqual(["create_note", "get_note", "list_notes", "search_notes"]);

    const listed = toolResult(await rpc(request, token, "tools/call",
      { name: "list_notes", arguments: { limit: 5 } })) as { note_id: string }[];
    expect(listed.length).toBeGreaterThan(0);

    const made = toolResult(await rpc(request, token, "tools/call", { name: "create_note",
      arguments: { title: "E2E remote MCP note (temporary)", content_markdown: "# Saved from an app\n- one\n- two" } })) as
      { note_id: string; link: string };
    created = made.note_id;
    expect(made.link).toContain(`/brain/${created}`);

    const read = toolResult(await rpc(request, token, "tools/call",
      { name: "get_note", arguments: { note_id: created } })) as { title: string; text: string };
    expect(read.title).toBe("E2E remote MCP note (temporary)");
    expect(read.text).toContain("Saved from an app");                // plain text saved too

    const found = toolResult(await rpc(request, token, "tools/call",
      { name: "search_notes", arguments: { query: "Bellman equation", limit: 3 } })) as unknown[];
    expect(Array.isArray(found)).toBe(true);
  } finally {
    if (created) await page.request.delete(`/api/notes/${created}`);
    await request.post(`${MCP}/revoke`, { form: { token: refresh, client_id: clientId } });
    await request.post(`${MCP}/revoke`, { form: { token, client_id: clientId } });
  }
  // revoked: the token no longer works
  const after = await request.post(`${MCP}/mcp`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json, text/event-stream",
      "Content-Type": "application/json" },
    data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
  expect(after.status()).toBe(401);
});
