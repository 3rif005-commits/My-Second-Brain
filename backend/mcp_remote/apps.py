"""MCP Apps (SEP-1865, ratified January 2026): the one view this server
offers — a read-only card for a change `update_note`/`delete_note` just
asked for, shown inline in the host's chat instead of plain text.

It is deliberately READ-ONLY. The Approve/Reject decision still happens only
in Settings → Connected apps, over the user's own logged-in session — the
sandboxed view has no such session and no way to get one, and even if the
host's `postMessage` bridge could reach a tool, the MCP Apps spec's
`visibility` field is a HOST-side rendering hint, not something this server
can enforce. Building a real "approve" tool here would mean the connected
app's own OAuth token could approve its own request — precisely the
short-circuit `[[project_harness_direction]]` flagged. So the card only
previews the change and opens the real approval page with `ui/open-link`;
the actual write goes through `services.connected_apps.decide`, exactly as
it does today, unchanged.

No SDK support for this extension exists yet in the Python `mcp` package
(1.27.1) — this hand-rolls the small `ui/initialize` handshake described in
the spec's Appendix, not a full client library. A host with no MCP Apps
support ignores the resource entirely and shows the tool's plain-text
result instead (the spec's own graceful-degradation guarantee), so
`update_note`/`delete_note` keep their existing text unconditionally.
"""
from __future__ import annotations

RESOURCE_URI = "ui://second-brain/pending-change"
MIME_TYPE = "text/html;profile=mcp-app"

#: no external scripts, fonts or images — the spec's restrictive default CSP
#: (script-src/style-src 'self' 'unsafe-inline', connect-src 'none') is enough.
PENDING_CHANGE_HTML = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 14px; font: 13px/1.5 -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif; color: #1f2937; background: transparent; }
  @media (prefers-color-scheme: dark) { body { color: #e5e7eb; } }
  .head { display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 6px; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; font-weight: 500; }
  .badge.update { background: #e0e7ff; color: #4338ca; }
  .badge.delete { background: #fee2e2; color: #b91c1c; }
  .reason { color: #6b7280; margin-bottom: 8px; }
  .box { border: 1px solid rgba(127,127,127,.25); border-radius: 8px; padding: 8px 10px;
    margin-bottom: 6px; white-space: pre-wrap; word-break: break-word; }
  .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em;
    color: #9ca3af; margin-bottom: 3px; }
  .after { border-color: rgba(99,102,241,.4); background: rgba(99,102,241,.06); }
  button { margin-top: 8px; padding: 6px 12px; border-radius: 999px; border: none;
    background: #4f46e5; color: #fff; font: inherit; font-weight: 500; cursor: pointer; }
  button:hover { background: #4338ca; }
  .wait { color: #6b7280; }
</style>
</head>
<body>
  <div id="root" class="wait">Waiting for the change…</div>
<script>
(function () {
  // A minimal MCP Apps view: the "ui/initialize" handshake from the SEP-1865
  // appendix, plus the two notifications this card actually needs
  // (tool-input for the request, tool-result for the confirmation). No
  // library — the whole exchange is five message types.
  var seq = 1;
  function send(method, params) {
    var id = seq++;
    window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params || {} }, "*");
    return id;
  }
  function notify(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params || {} }, "*");
  }

  // `tool-input` gives the ORIGINAL CALL ARGUMENTS (note_id, content_markdown,
  // title, reason) — only `reason` is shown before the real result arrives.
  // `tool-result` gives update_note/delete_note's own returned dict
  // (services/connected_apps.py's propose()) — change_id, action, note_title,
  // current_text_preview, new_text_preview, review_url — everything the card
  // actually renders, exactly what the model itself was shown.
  var reasonSoFar = "", result = null;
  function render() {
    var root = document.getElementById("root");
    if (!result) {
      if (reasonSoFar) root.innerHTML = 'Asking to change this note… <div class="reason">“' + esc(reasonSoFar) + '”</div>';
      return;
    }
    var action = result.action === "delete" ? "delete" : "update";
    var html = '<div class="head">' + esc(result.note_title || "this note") +
      '<span class="badge ' + action + '">' + (action === "delete" ? "Delete" : "Update") + '</span></div>';
    if (result.reason || reasonSoFar) html += '<div class="reason">“' + esc(result.reason || reasonSoFar) + '”</div>';
    if (result.current_text_preview) {
      html += '<div class="label">Now</div><div class="box">' + esc(result.current_text_preview) + '</div>';
    }
    if (action === "update" && result.new_text_preview) {
      html += '<div class="label">After</div><div class="box after">' + esc(result.new_text_preview) + '</div>';
    }
    if (action === "delete") {
      html += '<div class="reason">Goes to the Trash — you can restore it there.</div>';
    }
    html += '<button id="review">Review in Second Brain</button>';
    root.className = "";
    root.innerHTML = html;
    document.getElementById("review").onclick = function () {
      var base = result.review_url || "";
      var url = base + (result.change_id ? (base.indexOf("?") >= 0 ? "&" : "?") + "change=" + encodeURIComponent(result.change_id) : "");
      send("ui/open-link", { url: url });
    };
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (msg.id !== undefined && msg.result && msg.result.hostInfo !== undefined) {
      notify("ui/notifications/initialized", {});
      return;
    }
    if (msg.method === "ui/notifications/tool-input") {
      reasonSoFar = ((msg.params && msg.params.arguments) || {}).reason || "";
      render();
    } else if (msg.method === "ui/notifications/tool-result") {
      result = (msg.params && msg.params.structuredContent) || {};
      render();
    }
  });

  send("ui/initialize", {
    protocolVersion: "2026-01-26",
    capabilities: { experimental: {} },
    clientInfo: { name: "second-brain-pending-change", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] },
  });
})();
</script>
</body>
</html>"""
