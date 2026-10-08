"""Code-block languages. Notion's `language` is a strict enum (T9: `jsx` and
unknown values -> 400), so every language goes through this table and falls
back to `plain text`. The enum is the list Notion itself returned in the T9
validation error (docs/notion-sync/evidence/live/.../T9.json)."""
from __future__ import annotations

NOTION_LANGUAGES = frozenset([
    "abap", "abc", "agda", "arduino", "ascii art", "assembly", "bash", "basic", "bnf", "c", "c#",
    "c++", "clojure", "coffeescript", "coq", "css", "dart", "dhall", "diff", "docker", "ebnf",
    "elixir", "elm", "erlang", "f#", "flow", "fortran", "gherkin", "glsl", "go", "graphql",
    "groovy", "haskell", "hcl", "html", "idris", "java", "javascript", "json", "julia", "kotlin",
    "latex", "less", "lisp", "livescript", "llvm ir", "lua", "makefile", "markdown", "markup",
    "matlab", "mathematica", "mermaid", "nix", "notion formula", "objective-c", "ocaml", "pascal",
    "perl", "php", "plain text", "powershell", "prolog", "protobuf", "purescript", "python", "r",
    "racket", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "smalltalk",
    "solidity", "sql", "swift", "toml", "typescript", "vb.net", "verilog", "vhdl", "visual basic",
    "webassembly", "xml", "yaml", "java/c/c++/c#",
])

#: our language id (BlockNote / Shiki names) -> Notion, same language
ALIASES = {
    "text": "plain text", "txt": "plain text", "plaintext": "plain text", "": "plain text",
    "js": "javascript", "mjs": "javascript", "cjs": "javascript",
    "ts": "typescript", "py": "python", "python3": "python",
    "sh": "shell", "zsh": "shell", "shellscript": "shell", "console": "shell",
    "yml": "yaml", "md": "markdown", "rb": "ruby", "rs": "rust", "kt": "kotlin",
    "cs": "c#", "csharp": "c#", "cpp": "c++", "objc": "objective-c", "objectivec": "objective-c",
    "fsharp": "f#", "golang": "go", "tex": "latex", "dockerfile": "docker", "make": "makefile",
    "vb": "visual basic", "vbnet": "vb.net", "gql": "graphql", "proto": "protobuf",
    "ps1": "powershell", "pwsh": "powershell", "hs": "haskell", "ml": "ocaml", "erl": "erlang",
    "ex": "elixir", "exs": "elixir", "wasm": "webassembly", "xhtml": "html", "svg": "xml",
    "terraform": "hcl", "tf": "hcl", "patch": "diff", "jsonc": "json", "json5": "json",
    "postgres": "sql", "mysql": "sql", "plsql": "sql",
}

#: a different language that highlights acceptably: approximated, with a note
CLOSE = {"jsx": "javascript", "tsx": "typescript", "vue": "html", "svelte": "html",
         "astro": "html", "handlebars": "html", "php-html": "php"}


def map_language(ours: str | None) -> tuple[str, str]:
    """-> (notion_language, kind) with kind in exact | close | unknown.
    Always returns a value Notion accepts."""
    key = (ours or "").strip().lower()
    if key in NOTION_LANGUAGES:
        return key, "exact"
    if key in ALIASES:
        return ALIASES[key], "exact"
    if key in CLOSE:
        return CLOSE[key], "close"
    return "plain text", "unknown"
