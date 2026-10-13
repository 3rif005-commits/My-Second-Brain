// The fake "Projects" database the audit and parity scripts render the real database
// UI against (the cloud box used for the audit had no DATABASE_URL). It mirrors the
// Notion fixture in docs/notion-reference: every property type, all option colours,
// one view of each layout, and an empty database.
const NOW = "2026-10-01T00:00:00Z";
const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

const prop = (key, name, type, position, config = {}) => ({
  id: key, data_source_id: "ds-1", user_id: "u", key, name, type, config, description: null,
  storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position, created_at: NOW,
  convertible_to: ["rich_text", "select", "multi_select", "number"],
});
const STATUS_NAMES = { s0: "Not started", s1: "In progress", s2: "Blocked", s3: "Done" };
const PRIO = COLORS.map((c) => c[0].toUpperCase() + c.slice(1));
const TAGS = ["Design", "Backend", "Research", "Marketing", "Mobile", "AI"];
const PROPS = [
  prop("title", "Name", "title", 0),
  prop("status", "Status", "status", 1, { options: [
    { id: "Not started", name: "Not started", color: "gray", group: "To-do" },
    { id: "In progress", name: "In progress", color: "blue", group: "In progress" },
    { id: "Blocked", name: "Blocked", color: "red", group: "In progress" },
    { id: "Done", name: "Done", color: "green", group: "Complete" }] }),
  prop("prio", "Priority", "select", 2, { options: PRIO.map((n, i) => ({ id: n, name: n, color: COLORS[i] })) }),
  prop("tags", "Tags", "multi_select", 3, { options: TAGS.map((n, i) => ({ id: n, name: n, color: COLORS[(i * 3 + 2) % 10] })) }),
  prop("budget", "Budget", "number", 4, { format: "dollar" }),
  prop("due", "Due", "date", 5),
  prop("ok", "Approved", "checkbox", 6),
  prop("site", "Website", "url", 7),
  prop("mail", "Contact", "email", 8),
  prop("sum", "Summary", "rich_text", 9),
];
const TITLES = ["Website redesign", "Mobile app v2", "Q4 marketing plan", "Data warehouse", "Onboarding flow", "AI search", "Brand refresh", "Payment provider", "Customer portal", "Docs overhaul", "Analytics dashboard", "Hiring plan", "Security audit", "Partner API", "Holiday campaign"];
const ST = ["s0", "s1", "s3", "s2", "s1", "s1", "s3", "s0", "s1", "s3", "s2", "s0", "s1", "s3", "s0"];
const ROWS = TITLES.map((t, i) => {
  const p = { title: { type: "title", title: t }, status: { type: "status", status: STATUS_NAMES[ST[i]] }, ok: { type: "checkbox", checkbox: i % 3 === 0 } };
  if (i % 5 !== 4) p.prio = { type: "select", select: PRIO[i % 10] };
  if (i % 4 !== 3) p.tags = { type: "multi_select", multi_select: [TAGS[i % 6], TAGS[(i + 2) % 6]].slice(0, 1 + (i % 2)) };
  if (i % 6 !== 5) p.budget = { type: "number", number: 1500 * (i + 3) };
  if (i % 7 !== 6) p.due = { type: "date", date: { start: `2026-10-${String(3 + i * 2).padStart(2, "0")}`, end: i % 4 === 0 ? `2026-10-${String(6 + i * 2).padStart(2, "0")}` : null, time_zone: null } };
  if (i % 3 !== 2) p.site = { type: "url", url: `https://example.com/${t.toLowerCase().replace(/ /g, "-")}` };
  if (i % 4 === 1) p.mail = { type: "email", email: `team${i}@example.com` };
  if (i % 2 === 0) p.sum = { type: "rich_text", rich_text: `Short summary for ${t}` };
  return { id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, properties: p, cover_image_url: null };
});
const view = (id, name, type, position, config = {}) => ({ id, data_source_id: "ds-1", user_id: "u", name, icon: null, type, config, filter: null, sorts: [], is_locked: false, position });
const VIEWS = [
  view("v-table", "Table", "table", 0),
  view("v-board", "Board", "board", 1, { group_by: { property_key: "status" } }),
  view("v-gallery", "Gallery", "gallery", 2),
  view("v-list", "List", "list", 3),
  view("v-calendar", "Calendar", "calendar", 4, { date_property_id: "due" }),
  view("v-timeline", "Timeline", "timeline", 5, { date_property_id: "due" }),
  view("v-chart", "Chart", "chart", 6, { x_axis: { property_key: "status" } }),
  view("v-grouped", "Grouped", "table", 7, { group_by: { property_key: "status" } }),
];
const DB = { id: "db-1", user_id: "u", title: "Projects", description: [], icon: "🚀", cover_url: null, is_inline: false, parent_note_id: null, is_locked: false, position: 0, created_at: NOW, updated_at: NOW, deleted_at: null };
const DS = { id: "ds-1", database_id: "db-1", user_id: "u", name: "Projects", system_kind: null, position: 0, created_at: NOW, is_virtual: false };
const EMPTY_DB = { ...DB, id: "db-2", title: "Empty DB", icon: null };
const EMPTY_DS = { ...DS, id: "ds-2", database_id: "db-2", name: "Empty DB" };

function group(rows, key) {
  const p = PROPS.find((x) => x.key === key);
  return (p.config.options || []).map((o) => {
    const r = rows.filter((row) => row.properties[key]?.[p.type] === o.id);
    return { key: o.id, label: o.name, row_count: r.length, rows: r, subgroups: null };
  });
}

export async function mock(page) {
  await page.route("**/api/db/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/db", "");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/databases" && req.method() === "GET") return json({ databases: [{ database: DB, data_source: DS }, { database: EMPTY_DB, data_source: EMPTY_DS }] });
    if (path === "/databases/db-1") return json({ database: DB, data_source: DS, properties: PROPS, views: VIEWS });
    if (path === "/databases/db-2") return json({ database: EMPTY_DB, data_source: EMPTY_DS, properties: [PROPS[0], PROPS[1]], views: [view("v-e", "Table", "table", 0)] });
    if (path.endsWith("/query")) {
      const body = JSON.parse(req.postData() || "{}");
      const rows = path.includes("ds-2") ? [] : ROWS;
      if (body.group_by?.property_key) return json({ groups: group(rows, body.group_by.property_key) });
      return json({ rows });
    }
    if (path.endsWith("/templates") || path.endsWith("/automations") || path === "/notifications") return json([]);
    if (path.startsWith("/views/") && req.method() === "PATCH") {
      const v = VIEWS.find((x) => path.endsWith(x.id));
      return json({ ...v, ...JSON.parse(req.postData() || "{}") });
    }
    if (/\/notes\/.+\/row$/.test(path)) {
      const id = path.split("/")[2];
      const row = ROWS.find((r) => r.id === id);
      return row ? json({ data_source: DS, database: DB, properties: PROPS, row }) : json({ detail: "not a row" }, 404);
    }
    return json({});
  });
}

