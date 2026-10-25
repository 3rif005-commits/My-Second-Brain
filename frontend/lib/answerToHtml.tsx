// An AI answer, made ready for the note: its [n] markers become the source
// they point at ("(Lecture 10, p. 3)" — a bare [1] means nothing inside a
// note), and its Markdown becomes the HTML the editor's insert path takes.
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { anchorLabel, type Citation } from "@/lib/workspace";

export function resolveCitations(md: string, citations: Citation[]): string {
  const byN = new Map(citations.map((c) => [c.n, c]));
  return md.replace(/\s*((?:\[\d{1,2}\])+)(?!\()/g, (run) => {
    const labels = [...run.matchAll(/\[(\d{1,2})\]/g)]
      .map((m) => byN.get(Number(m[1])))
      .filter((c): c is Citation => !!c)
      .map((c) => (c.kind === "note" ? `${c.title} (note)` : `${c.title}, ${anchorLabel(c.anchor_type, c.anchor_start)}`));
    return labels.length ? ` (${[...new Set(labels)].join("; ")})` : "";
  });
}

export function answerToHtml(md: string, citations: Citation[] = []): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{resolveCitations(md, citations)}</ReactMarkdown>,
  );
}
