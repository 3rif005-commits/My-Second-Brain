// A note → a standalone LaTeX document (ArtCraft study item 14, after wordcraft's formats/latex.rs:
// unnumbered sections, itemize/enumerate, tabular, math kept as math, only packages every TeX
// distribution ships). Pictures can't live in one .tex file, so each becomes its caption + link.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const SPECIAL: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "#": "\\#", "$": "\\$", "%": "\\%",
  "&": "\\&", "_": "\\_", "^": "\\textasciicircum{}", "~": "\\textasciitilde{}",
};

export function escapeTex(s: string): string {
  return s.replace(/[\\{}#$%&_^~]/g, (c) => SPECIAL[c]);
}

function inline(content: unknown): string {
  if (typeof content === "string") return escapeTex(content);
  if (!Array.isArray(content)) return "";
  return content.map((c: AnyBlock) => {
    if (!c) return "";
    if (c.type === "text") {
      let t = escapeTex(c.text ?? "");
      const st = c.styles ?? {};
      if (st.code) t = `\\texttt{${t}}`;
      if (st.bold) t = `\\textbf{${t}}`;
      if (st.italic) t = `\\emph{${t}}`;
      if (st.underline) t = `\\uline{${t}}`;
      if (st.strike) t = `\\sout{${t}}`;
      return t;
    }
    if (c.type === "link") return `\\href{${(c.href ?? "").replace(/[%#\\]/g, (x: string) => "\\" + x)}}{${inline(c.content)}}`;
    if (c.type === "inlineMath") return `$${c.props?.latex ?? ""}$`;
    return inline(c.content ?? c.text ?? "");
  }).join("");
}

const SECTION = ["\\section*", "\\section*", "\\subsection*", "\\subsubsection*", "\\paragraph*", "\\paragraph*", "\\paragraph*"];
const LIST_ENV: Record<string, string> = { bulletListItem: "itemize", numberedListItem: "enumerate", checkListItem: "itemize" };

function table(block: AnyBlock): string {
  const rows: AnyBlock[] = block.content?.rows ?? [];
  if (!rows.length) return "";
  const cells = (r: AnyBlock) => (r.cells ?? []).map((c: AnyBlock) => inline(Array.isArray(c) ? c : c?.content));
  const width = Math.max(...rows.map((r) => (r.cells ?? []).length), 1);
  const lines = rows.map((r) => { const cs = cells(r); while (cs.length < width) cs.push(""); return cs.join(" & ") + " \\\\"; });
  return `\\begin{tabular}{|${"l|".repeat(width)}}\n\\hline\n${lines.join("\n\\hline\n")}\n\\hline\n\\end{tabular}\n`;
}

function blocks(list: AnyBlock[], depth = 0): string {
  const out: string[] = [];
  let i = 0;
  while (i < list.length) {
    const b = list[i];
    const env = LIST_ENV[b?.type];
    if (env) {
      const items: string[] = [];
      while (i < list.length && LIST_ENV[list[i]?.type] === env) {
        const it = list[i];
        const box = it.type === "checkListItem" ? (it.props?.checked ? "[$\\boxtimes$] " : "[$\\square$] ") : "";
        items.push(`  \\item ${box}${inline(it.content)}` + (it.children?.length ? "\n" + blocks(it.children, depth + 1) : ""));
        i++;
      }
      out.push(`\\begin{${env}}\n${items.join("\n")}\n\\end{${env}}\n`);
      continue;
    }
    out.push(block(b, depth));
    i++;
  }
  return out.filter(Boolean).join("\n");
}

function block(b: AnyBlock, depth: number): string {
  if (!b) return "";
  const kids = b.children?.length ? "\n" + blocks(b.children, depth + 1) : "";
  switch (b.type) {
    case "heading": {
      const lvl = Math.min(Math.max(Number(b.props?.level) || 1, 1), 6);
      return `${SECTION[lvl]}{${inline(b.content)}}\n` + kids;
    }
    case "paragraph": {
      const t = inline(b.content);
      return (t.trim() ? t + "\n" : "") + kids;
    }
    case "quote": return `\\begin{quote}\n${inline(b.content)}\n\\end{quote}\n` + kids;
    case "callout": {
      const label = String(b.props?.calloutType ?? b.props?.type ?? "Note");
      return `\\begin{quote}\n\\textbf{${escapeTex(label.charAt(0) + label.slice(1).toLowerCase())}.} ${inline(b.content)}${kids}\n\\end{quote}\n`;
    }
    case "codeBlock": {
      const code = (Array.isArray(b.content) ? b.content.map((c: AnyBlock) => c.text ?? "").join("") : "").replace(/\\end\{verbatim\}/g, "\\end {verbatim}");
      return `\\begin{verbatim}\n${code}\n\\end{verbatim}\n`;
    }
    case "math": return b.props?.latex?.trim() ? `\\[\n${b.props.latex.trim()}\n\\]\n` : "";
    case "table": return table(b);
    case "divider": return "\\noindent\\rule{\\linewidth}{0.4pt}\n";
    case "image": case "video": case "audio": case "file": {
      const cap = b.props?.caption || b.props?.name || b.type;
      const url = b.props?.url && !String(b.props.url).startsWith("data:") ? ` (\\url{${b.props.url}})` : "";
      return `\\textit{[${escapeTex(String(cap))}]}${url}\n`;
    }
    case "interactive": return `\\textit{[Interactive block: ${escapeTex(String(b.props?.title ?? ""))}]}\n`;
    case "checkpoint": return "";
    case "toggleListItem": return `${inline(b.content)}\n` + kids;
    default: {
      const t = inline(b.content);
      return (t.trim() ? t + "\n" : "") + kids;
    }
  }
}

export function blocksToLatex(title: string, doc: AnyBlock[]): string {
  return [
    "\\documentclass[11pt]{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{amsmath,amssymb}",
    "\\usepackage[normalem]{ulem}",
    "\\usepackage{hyperref}",
    "\\usepackage{url}",
    `\\title{${escapeTex(title || "Untitled")}}`,
    "\\date{}",
    "\\begin{document}",
    "\\maketitle",
    "",
    blocks(doc),
    "\\end{document}",
    "",
  ].join("\n");
}
