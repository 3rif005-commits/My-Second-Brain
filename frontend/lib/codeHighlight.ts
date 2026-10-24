// Syntax colours for the editor's code block, matched to Notion's (which is Prism's default
// theme in light mode; measured in docs/notion-reference/surfaces/blocks.md on the
// ui-audit/notion-reference branch). Each token colour is a CSS variable, so light and dark
// mode come from editor.css and one highlighter serves both.
import { createBundledHighlighter } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import type {
  DynamicImportLanguageRegistration,
  ThemeRegistration,
} from "@shikijs/types";

/** The languages in the code block's menu, in Notion's order (alphabetical, Plain Text first
 *  is ours). Ids are Shiki language ids; aliases let `js`, `py`, ```` ```sh ```` and the like
 *  that come in from pastes and the AI resolve to the same entry. */
export const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = {
  text: { name: "Plain Text", aliases: ["text", "txt", "plain", "plaintext", "none", "plain text"] },
  shellscript: { name: "Bash", aliases: ["bash", "sh", "shell", "zsh", "console"] },
  c: { name: "C" },
  cpp: { name: "C++", aliases: ["c++"] },
  csharp: { name: "C#", aliases: ["c#", "cs"] },
  css: { name: "CSS" },
  dart: { name: "Dart" },
  diff: { name: "Diff", aliases: ["patch"] },
  docker: { name: "Docker", aliases: ["dockerfile"] },
  go: { name: "Go", aliases: ["golang"] },
  graphql: { name: "GraphQL", aliases: ["gql"] },
  haskell: { name: "Haskell", aliases: ["hs"] },
  html: { name: "HTML", aliases: ["htm"] },
  java: { name: "Java" },
  javascript: { name: "JavaScript", aliases: ["js", "mjs", "cjs"] },
  json: { name: "JSON" },
  jsx: { name: "JSX" },
  julia: { name: "Julia", aliases: ["jl"] },
  kotlin: { name: "Kotlin", aliases: ["kt", "kts"] },
  latex: { name: "LaTeX", aliases: ["tex"] },
  lua: { name: "Lua" },
  markdown: { name: "Markdown", aliases: ["md"] },
  matlab: { name: "MATLAB" },
  mermaid: { name: "Mermaid", aliases: ["mmd"] },
  php: { name: "PHP" },
  powershell: { name: "PowerShell", aliases: ["ps1", "ps"] },
  python: { name: "Python", aliases: ["py"] },
  r: { name: "R" },
  ruby: { name: "Ruby", aliases: ["rb"] },
  rust: { name: "Rust", aliases: ["rs"] },
  scala: { name: "Scala" },
  sql: { name: "SQL" },
  swift: { name: "Swift" },
  tsx: { name: "TSX" },
  typescript: { name: "TypeScript", aliases: ["ts"] },
  xml: { name: "XML", aliases: ["svg"] },
  yaml: { name: "YAML", aliases: ["yml"] },
};

/** The menu id for whatever a block's `language` prop holds (an id, an alias, any case),
 *  or undefined when it isn't one we know. */
export function resolveCodeLanguage(language: string | undefined): string | undefined {
  const value = (language ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (CODE_LANGUAGES[value]) return value;
  return Object.entries(CODE_LANGUAGES).find(([, { aliases }]) => aliases?.includes(value))?.[0];
}

// Each import is spelled out so the bundler splits one small chunk per language; a note
// only downloads the grammars its code blocks use.
const bundledLanguages: Record<string, DynamicImportLanguageRegistration> = {
  shellscript: () => import("@shikijs/langs-precompiled/shellscript"),
  c: () => import("@shikijs/langs-precompiled/c"),
  cpp: () => import("@shikijs/langs-precompiled/cpp"),
  csharp: () => import("@shikijs/langs-precompiled/csharp"),
  css: () => import("@shikijs/langs-precompiled/css"),
  dart: () => import("@shikijs/langs-precompiled/dart"),
  diff: () => import("@shikijs/langs-precompiled/diff"),
  docker: () => import("@shikijs/langs-precompiled/docker"),
  go: () => import("@shikijs/langs-precompiled/go"),
  graphql: () => import("@shikijs/langs-precompiled/graphql"),
  haskell: () => import("@shikijs/langs-precompiled/haskell"),
  html: () => import("@shikijs/langs-precompiled/html"),
  java: () => import("@shikijs/langs-precompiled/java"),
  javascript: () => import("@shikijs/langs-precompiled/javascript"),
  json: () => import("@shikijs/langs-precompiled/json"),
  jsx: () => import("@shikijs/langs-precompiled/jsx"),
  julia: () => import("@shikijs/langs-precompiled/julia"),
  kotlin: () => import("@shikijs/langs-precompiled/kotlin"),
  latex: () => import("@shikijs/langs-precompiled/latex"),
  lua: () => import("@shikijs/langs-precompiled/lua"),
  markdown: () => import("@shikijs/langs-precompiled/markdown"),
  matlab: () => import("@shikijs/langs-precompiled/matlab"),
  mermaid: () => import("@shikijs/langs-precompiled/mermaid"),
  php: () => import("@shikijs/langs-precompiled/php"),
  powershell: () => import("@shikijs/langs-precompiled/powershell"),
  python: () => import("@shikijs/langs-precompiled/python"),
  r: () => import("@shikijs/langs-precompiled/r"),
  ruby: () => import("@shikijs/langs-precompiled/ruby"),
  rust: () => import("@shikijs/langs-precompiled/rust"),
  scala: () => import("@shikijs/langs-precompiled/scala"),
  sql: () => import("@shikijs/langs-precompiled/sql"),
  swift: () => import("@shikijs/langs-precompiled/swift"),
  tsx: () => import("@shikijs/langs-precompiled/tsx"),
  typescript: () => import("@shikijs/langs-precompiled/typescript"),
  xml: () => import("@shikijs/langs-precompiled/xml"),
  yaml: () => import("@shikijs/langs-precompiled/yaml"),
};

const v = (name: string) => `var(--code-${name})`;

/** Prism's token classes mapped onto TextMate scopes. Shiki prefers the rule that matches
 *  the deepest scope, so e.g. a string's quote marks need their own rule to stay string-
 *  coloured instead of turning punctuation grey. */
export const NOTION_CODE_THEME: ThemeRegistration = {
  name: "notion",
  type: "light",
  fg: v("fg"),
  bg: "transparent",
  settings: [
    { settings: { foreground: v("fg") } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: v("comment") } },
    {
      scope: ["punctuation", "meta.brace", "punctuation.definition.tag", "punctuation.separator", "punctuation.terminator"],
      settings: { foreground: v("punctuation") },
    },
    {
      // Prism: property, tag, boolean, number, constant, symbol, deleted
      scope: [
        "entity.name.tag", "constant.numeric", "constant.language", "constant.other",
        "variable.other.constant", "support.type.property-name", "variable.other.property",
        "variable.other.object.property", "support.variable.property", "markup.deleted",
      ],
      settings: { foreground: v("tag") },
    },
    {
      // Prism: selector, attr-name, string, char, builtin, inserted
      scope: [
        "string", "punctuation.definition.string", "entity.other.attribute-name",
        "constant.character", "support.function.builtin", "support.type.builtin",
        "markup.inserted", "entity.name.tag.css", "meta.selector",
      ],
      settings: { foreground: v("string") },
    },
    {
      // Prism: operator, entity, url
      scope: ["keyword.operator", "constant.character.entity", "markup.underline.link", "string.other.link"],
      settings: { foreground: v("operator") },
    },
    {
      // Prism: atrule, attr-value, keyword
      scope: [
        "keyword", "storage", "storage.type", "storage.modifier", "keyword.control",
        "meta.attribute string", "meta.attribute punctuation.definition.string",
        "string.quoted.double.html", "string.quoted.single.html",
        "string.quoted.double.html punctuation.definition.string",
        "string.quoted.single.html punctuation.definition.string",
        "keyword.control.at-rule",
      ],
      settings: { foreground: v("keyword") },
    },
    {
      // Prism: function, class-name
      scope: [
        "entity.name.function", "support.function", "meta.function-call entity.name.function",
        "entity.name.type", "entity.name.class", "support.class", "entity.other.inherited-class",
      ],
      settings: { foreground: v("function") },
    },
    {
      // Prism: regex, important, variable
      scope: ["string.regexp", "keyword.other.important", "variable.parameter.function.language.special"],
      settings: { foreground: v("regex") },
    },
    // Mermaid's direction (TD, LR…) is plain in Notion (Prism), not a function name.
    { scope: ["entity.name.function.mermaid"], settings: { foreground: v("fg") } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.heading"], settings: { foreground: v("tag"), fontStyle: "bold" } },
  ],
};

const createHighlighter = createBundledHighlighter<string, string>({
  langs: bundledLanguages,
  themes: {},
  engine: () => createJavaScriptRegexEngine(),
});

/** Built once per page (BlockNote keeps the promise on globalThis); grammars load on first use. */
export function createCodeHighlighter() {
  return createHighlighter({ themes: [NOTION_CODE_THEME], langs: [] });
}

type ColouredToken = { content: string; color?: string };

/** Shiki's Mermaid grammar files the diagram keyword, arrows and brackets under one scope, so
 *  the theme alone colours them all as keywords. Notion (Prism) colours arrows as operators
 *  (`-->` brown/tan) and brackets as punctuation; this re-colours those tokens to match. */
export function refineMermaidTokens<T extends ColouredToken>(lines: T[][]): T[][] {
  const keyword = "var(--code-keyword)";
  return lines.map((line) =>
    line.map((t) => {
      if (t.color !== keyword) return t;
      const c = t.content.trim();
      if (/^[-=.ox<>]{2,}\|?$/.test(c) || /^\|$/.test(c)) return { ...t, color: "var(--code-operator)" };
      if (/^[[\](){}>]+$/.test(c)) return { ...t, color: "var(--code-punctuation)" };
      return t;
    }),
  );
}
