// Paste-from-Notion, the lossless path: Notion's OWN block tree.
//
// Notion's clipboard carries a complete JSON description of the copied blocks
// alongside the flat `text/html` that notionPaste.ts parses. Everything the
// HTML throws away is in here, explicitly:
//
//   - `toggle` is its own block type, distinct from `bulleted_list`. In the
//     HTML both are `<li>` and NOTHING tells them apart.
//   - a toggle HEADING is `format.toggleable: true` on a `sub_header` /
//     `sub_sub_header`. In the HTML it is a bare `<h2>`/`<h3>`, identical to a
//     plain heading, with its children flattened out as siblings.
//   - a callout carries `format.page_icon` (any emoji) and
//     `format.block_color`. The HTML has only a literal "<aside>" text marker
//     and no colour at all.
//   - inline equations are an `e` annotation carrying real LaTeX, rather than
//     literal `$…$` text that has to be guessed apart from prices.
//
// Which MIME type holds it depends on how the copy was made — both observed
// directly, by patching `DataTransfer.prototype.setData` on a real Notion page
// and copying:
//
//   block selection (e.g. ctrl+A ctrl+A)  -> text/_notion-blocks-v3-production
//   text selection across blocks          -> text/_notion-multi-text-production
//
// and both survive to the paste event's clipboardData intact (verified with a
// real ctrl+v: a 125,318-character payload arrived whole). `text/html` is kept
// as the fallback for pastes that carry no JSON at all — a partial selection
// inside one block, or a non-Notion source.
//
// The two envelopes differ only in their outer wrapper and in one extra level
// of `value` nesting; `collectRecords` below flattens both to the same map.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

/** One Notion block record, as it appears inside `blockSubtree.block`. */
interface NotionValue {
  id: string;
  type: string;
  /** Rich text and per-type fields. `title` is the block's own text. */
  properties?: Record<string, unknown>;
  /** Ids of this block's child blocks, in order. */
  content?: string[];
  format?: Record<string, unknown>;
}

/** The clipboard types that carry the block tree, richest first. */
export const NOTION_JSON_TYPES = [
  "text/_notion-blocks-v3-production",
  "text/_notion-multi-text-production",
] as const;

// ---- envelope unwrapping ---------------------------------------------------

/** Both envelopes reduce to a flat id -> value map plus the ids of the roots.
 *  v3:         { blocks: [ { blockId, blockSubtree: { block: { id: { value } } } } ] }
 *  multi-text: { blockSelection: { blocks: [ …same… ] }, … } with the record
 *              nested one `value` deeper.
 *  Rather than branch on the envelope name, this accepts either and unwraps
 *  `value.value` when present, so a future third variant with the same shape
 *  keeps working. */
function collectRecords(parsed: unknown): {
  byId: Map<string, NotionValue>;
  entryRoots: string[];
} {
  const byId = new Map<string, NotionValue>();
  const entryRoots: string[] = [];
  const root = parsed as Record<string, unknown> | null;
  if (!root || typeof root !== "object") return { byId, entryRoots };

  const selection = root.blockSelection as Record<string, unknown> | undefined;
  const entries = (Array.isArray(root.blocks)
    ? root.blocks
    : Array.isArray(selection?.blocks)
      ? selection!.blocks
      : []) as Array<Record<string, unknown>>;

  for (const entry of entries) {
    if (typeof entry?.blockId === "string") entryRoots.push(entry.blockId);
    const subtree = entry?.blockSubtree as Record<string, unknown> | undefined;
    const records = subtree?.block as Record<string, unknown> | undefined;
    if (!records || typeof records !== "object") continue;
    for (const record of Object.values(records)) {
      const outer = (record as Record<string, unknown>)?.value as Record<string, unknown> | undefined;
      if (!outer) continue;
      // multi-text nests the block one `value` deeper than blocks-v3 does.
      const value = ((outer.value as Record<string, unknown>) ?? outer) as unknown as NotionValue;
      if (value && typeof value.id === "string" && typeof value.type === "string") {
        byId.set(value.id, value);
      }
    }
  }
  return { byId, entryRoots };
}

/** The blocks to render, in document order. A subtree's declared root is
 *  usually the PAGE itself (a select-all copies the page block), which must not
 *  become a block of its own — its `content` is the real top level. Anything
 *  never referenced as someone's child is also a root, which covers the
 *  text-selection envelope where no page block is included. */
function findRoots(byId: Map<string, NotionValue>, entryRoots: string[]): string[] {
  const referenced = new Set<string>();
  for (const value of byId.values()) {
    for (const childId of value.content ?? []) referenced.add(childId);
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    roots.push(id);
  };

  for (const id of entryRoots) {
    const value = byId.get(id);
    if (!value) continue;
    if (value.type === "page") (value.content ?? []).forEach(push);
    else push(id);
  }
  // Anything the entry roots didn't reach (and that nothing owns) still belongs.
  for (const [id, value] of byId) {
    if (!referenced.has(id) && value.type !== "page") push(id);
  }
  return roots;
}

// ---- rich text -------------------------------------------------------------

/** Notion rich text is an array of spans; each span is `[text]` or
 *  `[text, annotations]`, and each annotation is `[code]` or `[code, value]`.
 *  Codes observed on a real page: b/i/_/s/c (bold, italic, underline,
 *  strikethrough, code), h (colour), a (link href), e (inline equation LaTeX). */
type NotionSpan = [string] | [string, Array<[string, string?]>];

function plainText(rich: unknown): string {
  if (!Array.isArray(rich)) return "";
  return (rich as NotionSpan[]).map((span) => (typeof span?.[0] === "string" ? span[0] : "")).join("");
}

/** Notion's colour names onto BlockNote's palette. Notion suffixes background
 *  colours with `_background`; `teal` has no BlockNote equivalent and reads as
 *  green, and `default` means "no colour" rather than a colour called default. */
const NOTION_COLORS: Record<string, string> = {
  gray: "gray", brown: "brown", orange: "orange", yellow: "yellow",
  green: "green", teal: "green", blue: "blue", purple: "purple",
  pink: "pink", red: "red",
};

function colorStyles(rawColor: string): Record<string, string> {
  const background = rawColor.endsWith("_background");
  const name = NOTION_COLORS[rawColor.replace(/_background$/, "")];
  if (!name) return {};
  return background ? { backgroundColor: name } : { textColor: name };
}

/** Converts one Notion rich-text array into BlockNote inline content.
 *  An `e` annotation becomes a real `inlineMath` node (customBlocks.tsx) rather
 *  than the literal `$…$` text the HTML path has to guess at, and an `a`
 *  annotation becomes a link node wrapping the styled text. */
function toInlineContent(rich: unknown): AnyBlock[] {
  if (!Array.isArray(rich)) return [];
  const out: AnyBlock[] = [];
  for (const span of rich as NotionSpan[]) {
    const text = typeof span?.[0] === "string" ? span[0] : "";
    const annotations = Array.isArray(span?.[1]) ? span[1] : [];

    const equation = annotations.find((a) => a?.[0] === "e");
    if (equation) {
      // The span's own text is Notion's placeholder glyph, not content.
      out.push({ type: "inlineMath", props: { latex: equation[1] ?? "" } });
      continue;
    }
    if (!text) continue;

    const styles: Record<string, unknown> = {};
    let href: string | undefined;
    for (const annotation of annotations) {
      switch (annotation?.[0]) {
        case "b": styles.bold = true; break;
        case "i": styles.italic = true; break;
        case "_": styles.underline = true; break;
        case "s": styles.strike = true; break;
        case "c": styles.code = true; break;
        case "h": Object.assign(styles, colorStyles(annotation[1] ?? "")); break;
        case "a": href = annotation[1]; break;
        default: break; // unknown annotation: keep the text, drop the styling
      }
    }
    if (href) out.push({ type: "link", href, content: [{ type: "text", text, styles }] });
    else out.push({ type: "text", text, styles });
  }
  return out;
}

// ---- callouts --------------------------------------------------------------

/** Notion's callout colour onto this app's callout types, which is how the
 *  callout's box colour is chosen (CALLOUT_PALETTE in customBlocks.tsx assigns
 *  each type a distinct colour). Colour is the faithful signal here — the emoji
 *  is preserved separately and verbatim in `calloutIcon`, so nothing is lost by
 *  letting the colour pick the type. */
const COLOR_TO_CALLOUT_TYPE: Record<string, string> = {
  blue: "OVERVIEW", gray: "NOTE", green: "TIP", yellow: "IMPORTANT",
  orange: "WARNING", red: "CAUTION", purple: "FORMULA", brown: "ANALOGY",
  pink: "EXAM",
};

function calloutTypeFor(format: Record<string, unknown> | undefined): string {
  const raw = typeof format?.block_color === "string" ? format.block_color : "";
  const name = NOTION_COLORS[raw.replace(/_background$/, "")];
  return (name && COLOR_TO_CALLOUT_TYPE[name]) || "NOTE";
}

/** Notion's block_color as this app's colour props — applied uniformly to any
 *  ordinary text-bearing block (paragraph, heading, quote, lists, to-do; the
 *  only block types Notion's own colour menu offers it on). Colour is always
 *  just a prop on whatever TYPE a block already is; it never picks the type,
 *  which is what let a coloured quote get reinterpreted as a callout instead
 *  of staying a quote with a nested toggle — the actual bug reported. Reuses
 *  `colorStyles` (same colour codes, same background-vs-text split) rather
 *  than a second copy of that mapping. */
function blockColorProps(format: Record<string, unknown> | undefined): Record<string, string> {
  return colorStyles(typeof format?.block_color === "string" ? format.block_color : "");
}

// ---- tables ----------------------------------------------------------------

/** Notion stores a table's cells on its `table_row` children, keyed by opaque
 *  column ids, with the column ORDER held on the table's own format. Without
 *  that order the columns would come out in whatever order the object happens
 *  to enumerate, so it is read explicitly and only falls back to the keys
 *  present on the first row. */
function tableToBlock(value: NotionValue, byId: Map<string, NotionValue>): AnyBlock {
  const rowIds = value.content ?? [];
  const rows = rowIds.map((id) => byId.get(id)).filter((r): r is NotionValue => !!r);
  const declaredOrder = value.format?.table_block_column_order;
  const columns: string[] = Array.isArray(declaredOrder)
    ? (declaredOrder as string[])
    : Object.keys(rows[0]?.properties ?? {});

  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((row) => ({
        cells: columns.map((columnId) => toInlineContent(row.properties?.[columnId])),
      })),
    },
    children: [],
  };
}

// ---- block conversion ------------------------------------------------------

const HEADING_LEVELS: Record<string, number> = {
  header: 1,
  sub_header: 2,
  sub_sub_header: 3,
};

/** Notion block types this app has no equivalent for and that carry no text of
 *  their own — dropping them silently is correct, not lossy. */
const IGNORED_TYPES = new Set(["table_of_contents", "breadcrumb", "page"]);

function convert(value: NotionValue, byId: Map<string, NotionValue>, seen: Set<string>): AnyBlock[] {
  if (seen.has(value.id)) return []; // cycles can't happen in valid data; don't hang if they do
  seen.add(value.id);

  const title = value.properties?.title;
  const children = (value.content ?? [])
    .map((id) => byId.get(id))
    .filter((child): child is NotionValue => !!child)
    .flatMap((child) => convert(child, byId, seen));

  const withChildren = (block: AnyBlock): AnyBlock[] => [{ ...block, children }];

  if (IGNORED_TYPES.has(value.type)) return children;

  const level = HEADING_LEVELS[value.type];
  if (level) {
    return withChildren({
      type: "heading",
      // The whole point of this path: a toggle heading stays a toggle heading,
      // and keeps its children instead of spilling them out as siblings.
      props: { level, isToggleable: value.format?.toggleable === true, ...blockColorProps(value.format) },
      content: toInlineContent(title),
    });
  }

  switch (value.type) {
    case "text":
      return withChildren({ type: "paragraph", props: blockColorProps(value.format), content: toInlineContent(title) });
    case "toggle":
      return withChildren({ type: "toggleListItem", props: blockColorProps(value.format), content: toInlineContent(title) });
    case "bulleted_list":
      return withChildren({ type: "bulletListItem", props: blockColorProps(value.format), content: toInlineContent(title) });
    case "numbered_list":
      return withChildren({ type: "numberedListItem", props: blockColorProps(value.format), content: toInlineContent(title) });
    case "to_do":
      return withChildren({
        type: "checkListItem",
        props: { checked: plainText(value.properties?.checked) === "Yes", ...blockColorProps(value.format) },
        content: toInlineContent(title),
      });
    case "quote":
      // A quote's own text is inline-only `content` (BlockNote's quote can't
      // hold a whole block mid-text), but its children nest normally
      // underneath it exactly like any other block type's — `children` is a
      // separate field from `content`, and every case in this switch treats
      // it the same way. Colour (Notion's usual way to turn a quote into a
      // tinted box, most often around a toggle) is carried as a prop below,
      // same as any other text-bearing block — it never changes what TYPE a
      // block becomes, so this stays a real quote instead of being
      // reinterpreted as a callout.
      return withChildren({ type: "quote", props: blockColorProps(value.format), content: toInlineContent(title) });
    case "callout":
      return [
        {
          type: "callout",
          props: {
            calloutType: calloutTypeFor(value.format),
            calloutIcon: typeof value.format?.page_icon === "string" ? value.format.page_icon : "",
          },
          // The callout block itself holds no inline content (its box is drawn
          // from the icon alone), so its own text becomes its first child.
          children: [
            ...(plainText(title) ? [{ type: "paragraph", content: toInlineContent(title), children: [] }] : []),
            ...children,
          ],
        },
      ];
    case "code":
      return withChildren({
        type: "codeBlock",
        props: { language: (plainText(value.properties?.language) || "text").toLowerCase() },
        content: toInlineContent(title),
      });
    case "equation":
      return withChildren({ type: "math", props: { latex: plainText(title) } });
    case "divider":
      return withChildren({ type: "divider" });
    case "table":
      return [tableToBlock(value, byId)];
    case "table_row":
      return []; // consumed by its parent table
    case "image":
    case "file":
    case "video":
    case "pdf": {
      // Notion's media sources are internal references, not fetchable URLs (see
      // notionPaste.ts) — the same honest placeholder the HTML path produces.
      const name = plainText(value.properties?.title) || "file";
      return withChildren({
        type: "paragraph",
        content: [
          { type: "text", text: `[${value.type} not available via copy-paste: ${name} — please re-add it manually]`, styles: {} },
        ],
      });
    }
    default:
      // Never drop content for a type this doesn't know yet: keep its text as a
      // paragraph and log the type so the mapping can be added.
      // eslint-disable-next-line no-console
      console.warn(`[notionBlocks] Unmapped Notion block type "${value.type}" — kept as a paragraph.`);
      return withChildren({ type: "paragraph", content: toInlineContent(title) });
  }
}

// ---- entry points ----------------------------------------------------------

/** The richest Notion JSON payload on the clipboard, or null when there is
 *  none (a partial selection inside a single block, or a non-Notion source). */
export function readNotionJson(clipboard: DataTransfer | null | undefined): string | null {
  if (!clipboard) return null;
  for (const type of NOTION_JSON_TYPES) {
    let data = "";
    try {
      data = clipboard.getData(type) || "";
    } catch {
      continue; // some browsers throw rather than return "" for unknown types
    }
    if (data.length > 0) return data;
  }
  return null;
}

/** Converts a Notion clipboard JSON payload into BlockNote blocks. Returns null
 *  — rather than throwing or returning a half-built document — whenever the
 *  payload isn't the shape this understands, so the caller can fall back to the
 *  HTML path with nothing lost. */
export function notionJsonToBlocks(raw: string): AnyBlock[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const { byId, entryRoots } = collectRecords(parsed);
  if (byId.size === 0) return null;

  const seen = new Set<string>();
  const blocks = findRoots(byId, entryRoots).flatMap((id) => {
    const value = byId.get(id);
    return value ? convert(value, byId, seen) : [];
  });
  return blocks.length > 0 ? blocks : null;
}
