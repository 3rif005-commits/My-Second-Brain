"use client";

// An answer from a note's sources: [n] markers become source chips that jump
// to the cited page (Markdown everywhere else). Used by the AI panel when it
// sits in the workspace, where there is a source viewer to jump to.
import { Markdown } from "@/lib/markdown/Markdown";
import { anchorLabel, sourceColor, type Citation } from "@/lib/workspace";

export function Answer({ content, citations, colorIndex, onCitation }: {
  content: string;
  citations: Citation[];
  colorIndex: Map<string, number>;
  onCitation: (c: Citation) => void;
}) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const linked = content.replace(/\[(\d{1,2})\](?!\()/g, (m, n) => (byN.has(Number(n)) ? `[${n}](#cite-${n})` : m));
  const components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a: ({ href, children }: any) => {
      const m = /^#cite-(\d+)$/.exec(href ?? "");
      const c = m ? byN.get(Number(m[1])) : undefined;
      if (!c) return <a href={href} className="text-accent-600 dark:text-accent-400 hover:underline">{children}</a>;
      const idx = colorIndex.get(c.resource_id) ?? 0;
      return (
        <button type="button" onClick={() => onCitation(c)}
          title={`${c.title} — ${c.kind === "note" ? "your note" : anchorLabel(c.anchor_type, c.anchor_start)}\n${c.snippet ?? ""}`}
          className="inline-flex items-center gap-1 mx-0.5 px-1.5 h-[18px] rounded-md align-baseline
            text-[10.5px] font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300
            hover:bg-accent-100 dark:hover:bg-accent-500/20 transition-colors not-prose">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sourceColor(idx) }} />
          {c.n}
        </button>
      );
    },
  };
  return <Markdown components={components}>{linked}</Markdown>;
}
