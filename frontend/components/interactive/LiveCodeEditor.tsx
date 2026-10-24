"use client";

// The live block's code view, styled like the note's code block: the same faint fill, mono
// type and Notion syntax colours (lib/codeHighlight.ts). A plain <textarea> does the editing;
// a coloured copy of the same text sits exactly behind it, with the textarea's own text made
// transparent, so the caret, selection, undo and paste are the browser's own.

import { useEffect, useMemo, useRef, useState } from "react";
import { createCodeHighlighter } from "@/lib/codeHighlight";

type Token = { content: string; color?: string };
type Highlighter = Awaited<ReturnType<typeof createCodeHighlighter>>;

let highlighter: Promise<Highlighter> | null = null;
function getHighlighter() {
  highlighter ??= createCodeHighlighter();
  return highlighter;
}

/** The highlighter once `lang`'s grammar has loaded (the only async part), else null. */
function useGrammar(lang: string): Highlighter | null {
  const [ready, setReady] = useState<{ lang: string; h: Highlighter } | null>(null);
  useEffect(() => {
    if (lang === "text") return;
    let live = true;
    getHighlighter()
      .then(async (h) => {
        if (!h.getLoadedLanguages().includes(lang)) await h.loadLanguage(lang as never);
        if (live) setReady({ lang, h });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [lang]);
  return ready && ready.lang === lang ? ready.h : null;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** A Shiki language id ("html", "mermaid", "text"). */
  lang: string;
  placeholder?: string;
  onSubmit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}

export function LiveCodeEditor({ value, onChange, lang, placeholder, onSubmit, onCancel, autoFocus }: Props) {
  const area = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLPreElement>(null);
  const h = useGrammar(lang);
  // Colouring itself is synchronous, so the colours always match the text exactly: no lag,
  // no blink while typing. Until the grammar loads the textarea shows its own plain text.
  const coloured = useMemo<Token[][] | null>(() => {
    if (!h) return null;
    try {
      return h.codeToTokens(value, { lang: lang as never, theme: "notion" }).tokens;
    } catch {
      return null;
    }
  }, [h, value, lang]);

  useEffect(() => {
    if (autoFocus) area.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const rows = Math.min(24, Math.max(6, value.split("\n").length + 1));

  return (
    <div className="sb-live-code-editor">
      <pre ref={back} className="sb-live-code-back" aria-hidden="true">
        {coloured
          ? coloured.map((line, i) => (
              <span key={i}>
                {line.map((t, j) => <span key={j} style={{ color: t.color }}>{t.content}</span>)}
                {"\n"}
              </span>
            ))
          : null}
      </pre>
      <textarea
        ref={area}
        className="sb-live-code-input"
        data-coloured={coloured ? "true" : "false"}
        value={value}
        rows={rows}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={placeholder}
        aria-label="Block code"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (!back.current) return;
          back.current.scrollTop = e.currentTarget.scrollTop;
          back.current.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit?.(); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
          else if (e.key === "Tab" && !e.shiftKey) {
            // Two spaces, like the code block, instead of leaving the editor.
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: t } = el;
            onChange(value.slice(0, s) + "  " + value.slice(t));
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
          }
        }}
      />
    </div>
  );
}
