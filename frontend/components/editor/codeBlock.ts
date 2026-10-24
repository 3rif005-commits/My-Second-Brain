// The code block, Notion-style: syntax colours (lib/codeHighlight.ts) and, instead of
// BlockNote's always-visible <select>, a small pill in the top-right corner that shows on
// hover: the language (opens a searchable menu), Copy and, for long lines, Wrap. Parsing
// pastes, Tab/Enter keys and the highlighter plugin are BlockNote's own codeBlock; the
// ``` shortcut is ours (codeFenceRule, below).
//
// One prop is added: `wrap` (default false), so long lines wrap per block like Notion's
// "Wrap code". Notes saved before it simply read as not wrapped.
import {
  createBlockSpec,
  createCodeBlockSpec,
  createExtension,
  getBlockInfoFromTransaction,
  updateBlockTr,
} from "@blocknote/core";
import { InputRule, inputRules } from "@handlewithcare/prosemirror-inputrules";
import { TextSelection } from "prosemirror-state";
import { CODE_LANGUAGES, createCodeHighlighter, resolveCodeLanguage } from "@/lib/codeHighlight";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v7A1.5 1.5 0 0 0 4.5 12H5v-1.25h-.5a.25.25 0 0 1-.25-.25v-7a.25.25 0 0 1 .25-.25h6a.25.25 0 0 1 .25.25V4h1.25v-.5A1.5 1.5 0 0 0 10.5 2h-6Zm2 3A1.5 1.5 0 0 0 5 6.5v7A1.5 1.5 0 0 0 6.5 15h6a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 5h-6Zm-.25 1.5a.25.25 0 0 1 .25-.25h6a.25.25 0 0 1 .25.25v7a.25.25 0 0 1-.25.25h-6a.25.25 0 0 1-.25-.25v-7Z"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M13.03 4.47a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6 10.44l5.97-5.97a.75.75 0 0 1 1.06 0Z"/></svg>';
const WRAP_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h8.5a2.75 2.75 0 0 1 0 5.5H9.56l.72.72a.75.75 0 1 1-1.06 1.06l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 1 1 1.06 1.06l-.72.72h1.69a1.25 1.25 0 0 0 0-2.5h-8.5A.75.75 0 0 1 2 7.75ZM2.75 11a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z"/></svg>';
const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"/></svg>';

const options = {
  defaultLanguage: "text",
  supportedLanguages: CODE_LANGUAGES,
  createHighlighter: createCodeHighlighter,
};

function iconButton(icon: string, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sb-code-btn";
  button.innerHTML = icon;
  button.title = label;
  button.setAttribute("aria-label", label);
  // Keep the caret where it is: a click on the pill must not move the text selection.
  button.addEventListener("mousedown", (e) => e.preventDefault());
  return button;
}

// ── Language menu ─────────────────────────────────────────────────────────────
// Notion's picker, not the OS <select>: a popover (menu primitive in
// docs/notion-reference/surfaces/menus-overlays.md) with an auto-focused search field, 28px
// rows and a check on the current language. It lives on <body>, outside ProseMirror, so
// typing in the search never reaches the note. One open at a time.

let closeOpenMenu: (() => void) | null = null;

const CHECK_SMALL_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12.53 4.97a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06L6.5 9.94l4.97-4.97a.75.75 0 0 1 1.06 0Z"/></svg>';

/** Menu ids matching a search, by name, id or alias; names that start with it come first. */
export function filterLanguages(query: string): string[] {
  const q = query.trim().toLowerCase();
  const ids = Object.keys(CODE_LANGUAGES);
  if (!q) return ids;
  const hits = ids.filter((id) => {
    const { name, aliases } = CODE_LANGUAGES[id];
    return name.toLowerCase().includes(q) || id.includes(q) || aliases?.some((a) => a.includes(q));
  });
  const starts = (id: string) => CODE_LANGUAGES[id].name.toLowerCase().startsWith(q);
  return [...hits.filter(starts), ...hits.filter((id) => !starts(id))];
}

export function openLanguageMenu(anchor: HTMLElement, current: string | undefined, onPick: (id: string) => void) {
  closeOpenMenu?.();

  const menu = document.createElement("div");
  menu.className = "sb-lang-menu";
  const search = document.createElement("input");
  search.className = "sb-lang-search";
  search.placeholder = "Search for a language…";
  search.setAttribute("aria-label", "Search for a language");
  const list = document.createElement("div");
  list.className = "sb-lang-list";
  list.setAttribute("role", "listbox");
  menu.append(search, list);

  let ids: string[] = [];
  let active = 0;

  const paint = () => {
    ids = filterLanguages(search.value);
    active = Math.max(0, Math.min(active, ids.length - 1));
    list.replaceChildren();
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "sb-lang-empty";
      empty.textContent = "No results";
      list.appendChild(empty);
      return;
    }
    ids.forEach((id, i) => {
      const row = document.createElement("div");
      row.className = "sb-lang-row";
      row.setAttribute("role", "option");
      row.dataset.id = id;
      row.setAttribute("aria-selected", String(id === current));
      if (i === active) row.classList.add("sb-active");
      const label = document.createElement("span");
      label.textContent = CODE_LANGUAGES[id].name;
      row.appendChild(label);
      if (id === current) row.insertAdjacentHTML("beforeend", CHECK_SMALL_ICON);
      row.addEventListener("mousemove", () => {
        if (active === i) return;
        list.querySelector(".sb-active")?.classList.remove("sb-active");
        row.classList.add("sb-active");
        active = i;
      });
      row.addEventListener("click", () => pick(id));
      list.appendChild(row);
    });
  };

  const scrollActiveIntoView = () =>
    (list.querySelector(".sb-active") as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });

  const pick = (id: string) => {
    close();
    onPick(id);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!ids.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + ids.length) % ids.length;
      paint();
      scrollActiveIntoView();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (ids[active]) pick(ids[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      anchor.focus();
    }
  };

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const width = menu.offsetWidth || 240;
    const height = menu.offsetHeight || 320;
    const below = window.innerHeight - r.bottom;
    const top = below >= height + 8 || below >= r.top ? r.bottom + 4 : r.top - height - 4;
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${left}px`;
  };

  // Outside click, page scroll or resize closes it, like Notion's menus.
  const onDown = (e: Event) => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onScroll = (e: Event) => {
    if (!menu.contains(e.target as Node)) close();
  };

  function close() {
    menu.remove();
    document.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", close);
    anchor.setAttribute("aria-expanded", "false");
    if (closeOpenMenu === close) closeOpenMenu = null;
  }

  search.addEventListener("input", () => {
    active = 0;
    paint();
  });
  search.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDown, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", close);

  // Start on the current language, so Enter keeps it and arrows move from there.
  active = Math.max(0, Object.keys(CODE_LANGUAGES).indexOf(current ?? ""));
  paint();
  document.body.appendChild(menu);
  place();
  scrollActiveIntoView();
  search.focus();
  anchor.setAttribute("aria-expanded", "true");
  closeOpenMenu = close;
  return close;
}

// ── The block ─────────────────────────────────────────────────────────────────

function render(block: AnyBlock, editor: AnyBlock) {
  const fragment = document.createDocumentFragment();
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  // No red squiggles under `h1`, `const`… (Notion's code blocks don't spell-check either).
  code.setAttribute("spellcheck", "false");
  pre.appendChild(code);
  if (block.props.wrap) pre.classList.add("sb-code-wrap");

  const toolbar = document.createElement("div");
  toolbar.className = "sb-code-toolbar";
  toolbar.setAttribute("contenteditable", "false");

  const raw: string = block.props.language || "text";
  const languageId = resolveCodeLanguage(raw);
  const languageName = languageId ? CODE_LANGUAGES[languageId].name : raw;

  const cleanups: (() => void)[] = [];
  const on = (el: EventTarget, type: string, fn: (e: Event) => void) => {
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };

  let language: HTMLElement;
  if (editor.isEditable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sb-code-lang";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", `Code language: ${languageName}`);
    button.textContent = languageName;
    button.insertAdjacentHTML("beforeend", CHEVRON_ICON);
    button.addEventListener("mousedown", (e) => e.preventDefault());
    let closeMenu: (() => void) | null = null;
    on(button, "click", () => {
      if (button.getAttribute("aria-expanded") === "true") {
        closeMenu?.();
        return;
      }
      closeMenu = openLanguageMenu(button, languageId, (id) => {
        // A language we don't list (from an import, say) is only replaced when you pick one.
        if (id !== languageId) editor.updateBlock(block.id, { props: { language: id } });
      });
    });
    cleanups.push(() => closeMenu?.());
    language = button;
  } else {
    language = document.createElement("span");
    language.className = "sb-code-lang sb-readonly";
    language.textContent = languageName;
  }
  toolbar.appendChild(language);

  // Copy says so in words for a moment: an icon swap alone was too easy to miss.
  const copy = iconButton(COPY_ICON, "Copy code");
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  on(copy, "click", () => {
    navigator.clipboard?.writeText(code.textContent ?? "").then(() => {
      copy.innerHTML = `${CHECK_ICON}<span>Copied</span>`;
      copy.classList.add("sb-copied");
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copy.innerHTML = COPY_ICON;
        copy.classList.remove("sb-copied");
      }, 1500);
    }, () => {});
  });
  cleanups.push(() => clearTimeout(copiedTimer));
  toolbar.appendChild(copy);

  if (editor.isEditable) {
    const wrap = iconButton(WRAP_ICON, block.props.wrap ? "Unwrap code" : "Wrap long lines");
    wrap.setAttribute("aria-pressed", String(!!block.props.wrap));
    on(wrap, "click", () => {
      const current = editor.getBlock(block.id);
      editor.updateBlock(block.id, { props: { wrap: !current?.props.wrap } });
    });
    // Only offered when it would change something: a line too long for the box, or wrap
    // already on (to turn it off). On short code the button did nothing visible.
    const sync = () => {
      wrap.hidden = !block.props.wrap && pre.scrollWidth <= pre.clientWidth;
    };
    wrap.hidden = !block.props.wrap;
    on(pre, "pointerenter", sync);
    on(toolbar, "pointerenter", sync);
    const frame = requestAnimationFrame(sync);
    cleanups.push(() => cancelAnimationFrame(frame));
    if (typeof MutationObserver !== "undefined") {
      let queued = 0;
      const observer = new MutationObserver(() => {
        cancelAnimationFrame(queued);
        queued = requestAnimationFrame(sync);
      });
      observer.observe(code, { childList: true, characterData: true, subtree: true });
      cleanups.push(() => {
        observer.disconnect();
        cancelAnimationFrame(queued);
      });
    }
    toolbar.appendChild(wrap);
  }

  fragment.appendChild(toolbar);
  fragment.appendChild(pre);
  return {
    dom: fragment,
    contentDOM: code,
    destroy: () => cleanups.forEach((fn) => fn()),
  };
}

// Same as BlockNote's: the pill is editor chrome, so copies and exports get a bare <pre><code>.
function toExternalHTML(block: AnyBlock) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = `language-${block.props.language}`;
  code.dataset.language = block.props.language;
  pre.appendChild(code);
  return { dom: pre, contentDOM: code };
}

export function createNotionCodeBlockSpec() {
  // BlockNote's spec supplies parsing, keys, the ``` rule and the highlighter plugin. It is
  // rebuilt through createBlockSpec (not just spread) because its wrapped render/export
  // remember the prop list they were made with, and that list now has `wrap` in it.
  const base = createCodeBlockSpec(options);
  const { meta, parse, parseContent } = base.implementation;
  // BlockNote's ``` rule is swapped for ours (codeFenceRule); its keys and highlighter stay.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extensions = (base.extensions ?? []).map((ext: any) => {
    const extension = typeof ext === "function" ? ext() : ext;
    if (!extension?.inputRules) return ext;
    return createExtension({ ...extension, inputRules: undefined });
  });
  return createBlockSpec(
    { ...base.config, propSchema: { ...base.config.propSchema, wrap: { default: false } } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { meta, parse, parseContent, render, toExternalHTML } as any,
    [...extensions, codeFenceRule],
  )();
}

/** "```lang " at the start of a line turns it into a code block. Same as BlockNote's rule,
 *  except the caret goes INTO the new block: BlockNote's leaves the selection to be mapped,
 *  and when another block follows, the mapping drops it at the start of that block, so
 *  whatever you type next lands under the code block. */
const codeFenceRule = createExtension({
  key: "code-block-fence",
  prosemirrorPlugins: [
    inputRules({
      rules: [
        new InputRule(/^```(.*?)\s$/, (state, match, start, end) => {
          const info = getBlockInfoFromTransaction(state.tr);
          if (!info.isBlockContainer || info.blockContent.node.type.spec.content !== "inline*") {
            return null;
          }
          const name = match[1].trim();
          const language = resolveCodeLanguage(name) ?? (name || "text");
          const tr = state.tr.deleteRange(start, end);
          updateBlockTr(tr, info.bnBlock.beforePos, { type: "codeBlock", props: { language }, content: [] } as AnyBlock);
          // beforePos → inside the blockContainer (+1) → inside the codeBlock (+2).
          tr.setSelection(TextSelection.create(tr.doc, info.bnBlock.beforePos + 2));
          return tr;
        }),
      ],
    }),
  ],
});
