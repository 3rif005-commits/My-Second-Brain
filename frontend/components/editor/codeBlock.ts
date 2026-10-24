// The code block, Notion-style: syntax colours (lib/codeHighlight.ts) and, instead of
// BlockNote's always-visible <select>, a small pill in the top-right corner that shows on
// hover with the language, Copy and Wrap. Everything else (parsing pastes, ``` input rule,
// Tab/Enter keys, the highlighter plugin) is BlockNote's own codeBlock, reused as-is.
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

function render(block: AnyBlock, editor: AnyBlock) {
  const fragment = document.createDocumentFragment();
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  pre.appendChild(code);
  if (block.props.wrap) pre.classList.add("sb-code-wrap");

  const toolbar = document.createElement("div");
  toolbar.className = "sb-code-toolbar";
  toolbar.setAttribute("contenteditable", "false");

  const raw: string = block.props.language || "text";
  const languageId = resolveCodeLanguage(raw);
  const languageName = languageId ? CODE_LANGUAGES[languageId].name : raw;

  const language = document.createElement("label");
  language.className = "sb-code-lang";
  const languageText = document.createElement("span");
  languageText.textContent = languageName;
  language.appendChild(languageText);

  const cleanups: (() => void)[] = [];
  const on = (el: HTMLElement, type: string, fn: (e: Event) => void) => {
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };

  if (editor.isEditable) {
    language.insertAdjacentHTML("beforeend", CHEVRON_ICON);
    // A native <select> laid invisibly over the label: keyboard- and screen-reader-
    // friendly, and it opens the OS picker, so no popover of our own to position.
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Code language");
    // A language we don't list (from an import, say) stays selected, not lost.
    if (!languageId) select.add(new Option(raw, raw));
    for (const [id, { name }] of Object.entries(CODE_LANGUAGES)) {
      select.add(new Option(name, id));
    }
    select.value = languageId ?? raw;
    on(select, "change", () => {
      editor.updateBlock(block.id, { props: { language: select.value } });
    });
    language.appendChild(select);
  }
  toolbar.appendChild(language);

  const copy = iconButton(COPY_ICON, "Copy");
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  on(copy, "click", () => {
    navigator.clipboard?.writeText(code.textContent ?? "").then(() => {
      copy.innerHTML = CHECK_ICON;
      copy.title = "Copied";
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        copy.innerHTML = COPY_ICON;
        copy.title = "Copy";
      }, 1500);
    }, () => {});
  });
  cleanups.push(() => clearTimeout(copiedTimer));
  toolbar.appendChild(copy);

  if (editor.isEditable) {
    const wrap = iconButton(WRAP_ICON, block.props.wrap ? "Unwrap code" : "Wrap code");
    wrap.setAttribute("aria-pressed", String(!!block.props.wrap));
    on(wrap, "click", () => {
      const current = editor.getBlock(block.id);
      editor.updateBlock(block.id, { props: { wrap: !current?.props.wrap } });
    });
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
