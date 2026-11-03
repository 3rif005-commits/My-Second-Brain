// Copy from this app → paste into Notion.
//
// The clipboard's `text/html` is what Notion reads when the paste does not come
// from Notion itself. BlockNote's external HTML is fine for most blocks
// (headings, paragraphs, bullets, numbered lists, quotes, code, dividers,
// tables), but three shapes come out wrong in Notion:
//
//   to-do    BlockNote: <ul><li><input type="checkbox"><p>Todo</p></li></ul>
//            Notion: an EMPTY to-do (its "To-do" placeholder) with "Todo" as a
//            separate line under it: the <p> inside the item is read as a child.
//            Here:   <ul><li><input type="checkbox">Todo</li></ul>
//
//   toggle   BlockNote: <ul><li><details><summary><p>Title</p></summary>…</li></ul>
//            Notion: a BULLET whose text is the title and the children glued
//            together ("Open toggleChild of open toggle").
//            Here:   <details><summary>Title</summary>…children…</details>
//            — not inside a list, and the summary holds the text itself.
//
//   callout  BlockNote (this app's callout has no toExternalHTML): the icon's
//            <span> and then the body's <p>s as loose siblings.
//            Notion: an emoji-only line, then the body as plain paragraphs.
//            Here:   <aside>🧭 first line…</aside> — the element Notion itself
//            uses for a callout in its Markdown/HTML exports.
//
// Everything else passes through untouched. The rewrite works on the HTML
// string so it can sit on top of BlockNote's own exporter without forking it.

const INLINE = "bn-inline-content";

/** Clipboard type holding BlockNote's export as it was, before the rewrite
 *  below — what this app's own paste handler reads (BlockEditor.tsx). */
export const APP_HTML_MIME = "text/x-second-brain-html";

/** Replaces `el` with its children. */
function unwrap(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

/** <li><input type="checkbox"><p>text</p></li> → <li><input …>text</li>. */
function flattenTodos(root: ParentNode): void {
  root.querySelectorAll("li").forEach((li) => {
    const box = li.querySelector(":scope > input[type='checkbox']");
    if (!box) return;
    const p = li.querySelector(`:scope > p.${INLINE}, :scope > p:first-of-type`);
    if (p && p.previousElementSibling === box) unwrap(p);
  });
}

/** A toggle list item → a <details> of its own, out of its list. */
function liftToggles(root: ParentNode, doc: Document): void {
  root.querySelectorAll("li").forEach((li) => {
    const details = li.querySelector(":scope > details");
    if (!details) return;
    const list = li.parentElement;
    if (!list || !/^(UL|OL)$/.test(list.tagName)) return;
    // Split the list around this item so neighbouring bullets stay bullets.
    const before = doc.createElement(list.tagName.toLowerCase());
    const after = doc.createElement(list.tagName.toLowerCase());
    let node = list.firstElementChild;
    let seen = false;
    while (node) {
      const next = node.nextElementSibling;
      if (node === li) seen = true;
      else (seen ? after : before).appendChild(node);
      node = next;
    }
    const parts: Node[] = [];
    if (before.childElementCount) parts.push(before);
    parts.push(details);
    if (after.childElementCount) parts.push(after);
    list.replaceWith(...parts);
  });
  // The summary carries the title text itself, not a paragraph (a toggle
  // heading keeps its <h1>-<h3>: that is what makes it a heading).
  root.querySelectorAll("summary > p").forEach(unwrap);
}

/** The callout's icon <span> plus the body that follows → one <aside>. */
function wrapCallouts(root: ParentNode, doc: Document): void {
  root.querySelectorAll("span.callout-icon, [data-callout-icon].callout-icon").forEach((icon) => {
    const aside = doc.createElement("aside");
    const emoji = (icon.getAttribute("data-callout-icon") || icon.textContent || "").trim();
    // The body: the nested blocks BlockNote exported right after the icon
    // (they carry data-nesting-level, being the callout's children).
    const body: Element[] = [];
    let next = icon.nextElementSibling;
    while (next && next.hasAttribute("data-nesting-level")) {
      body.push(next);
      next = next.nextElementSibling;
    }
    const first = body[0];
    if (first && first.tagName === "P") {
      // The emoji leads the first line, as Notion writes it.
      if (emoji) first.prepend(doc.createTextNode(`${emoji} `));
      aside.append(...Array.from(first.childNodes));
      first.remove();
      body.shift();
    } else if (emoji) {
      aside.append(doc.createTextNode(emoji));
    }
    for (const el of body) {
      if (el.tagName === "P") {
        aside.appendChild(doc.createElement("br"));
        aside.append(...Array.from(el.childNodes));
        el.remove();
      } else {
        aside.appendChild(el); // a list or other block inside the callout
      }
    }
    icon.replaceWith(aside);
  });
}

/** Rewrites BlockNote's external HTML into shapes Notion pastes correctly. */
export function toNotionClipboardHtml(html: string): string {
  if (typeof DOMParser === "undefined" || !html) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const root = doc.body;
  flattenTodos(root);
  liftToggles(root, doc);
  wrapCallouts(root, doc);
  return root.innerHTML;
}
