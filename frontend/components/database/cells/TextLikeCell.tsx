"use client";

// M2b — URL, Email and Phone.
//
// All three are the same shape on the wire as rich_text (the backend groups
// them in _TEXT_SHAPE_TYPES), so one component serves all three. They are NOT
// collapsed into TextCell because the READ state differs and that difference
// is the entire reason the types exist: a URL is a link, an email opens a mail
// client, a phone number dials.
//
// Without this, adding these types to the picker would have shipped columns a
// user could create and then never fill — GenericCell is read-only.
import { useState } from "react";
import type { EmailValue, PhoneValue, UrlValue } from "@/lib/database/types";
import type { CellProps } from "./CellProps";

type TextLike = UrlValue | EmailValue | PhoneValue;

const HREF: Record<TextLike["type"], (v: string) => string> = {
  url: (v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`),
  email: (v) => `mailto:${v}`,
  phone_number: (v) => `tel:${v}`,
};

const INPUT_TYPE: Record<TextLike["type"], string> = {
  url: "url",
  email: "email",
  phone_number: "tel",
};

const LABEL: Record<TextLike["type"], string> = {
  url: "URL",
  email: "Email",
  phone_number: "Phone",
};

export function TextLikeCell({
  kind,
  value,
  editable,
  onChange,
}: CellProps<TextLike> & { kind: TextLike["type"] }) {
  const current = (value as Record<string, string> | undefined)?.[kind] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);

  const link = current ? (
    <a
      href={HREF[kind](current)}
      target={kind === "url" ? "_blank" : undefined}
      rel={kind === "url" ? "noreferrer" : undefined}
      // The link must not also open the editor.
      onClick={(e) => e.stopPropagation()}
      // Notion underlines links with a 1px gradient line, in the text colour (not blue).
      className="truncate bg-[linear-gradient(to_right,var(--c-border-strong),var(--c-border-strong))] bg-[length:100%_1px] bg-bottom bg-no-repeat text-ink"
    >
      {current}
    </a>
  ) : (
    <span className="db-empty-cell">—</span>
  );

  if (!editable) return <span className="truncate">{link}</span>;

  if (editing) {
    const commit = () => {
      setEditing(false);
      // Built by switch rather than a computed key: `{ [kind]: v }` widens to
      // a partial record and cannot narrow to the union, so the cast that
      // would make it compile would also hide a genuinely wrong shape.
      const text = draft.trim();
      const next: TextLike =
        kind === "url"
          ? { type: "url", url: text }
          : kind === "email"
            ? { type: "email", email: text }
            : { type: "phone_number", phone_number: text };
      onChange(next);
    };
    return (
      <input
        autoFocus
        type={INPUT_TYPE[kind]}
        aria-label={LABEL[kind]}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full px-1 -mx-1 rounded-md bg-surface-elevated shadow-menu text-sm outline-none"
      />
    );
  }

  return (
    <span className="group/cell flex w-full items-center gap-1">
      <span className="min-w-0 flex-1 truncate">{link}</span>
      <button
        type="button"
        aria-label={`Edit ${LABEL[kind]}`}
        onClick={() => {
          setDraft(current);
          setEditing(true);
        }}
        className="shrink-0 rounded px-1 text-ink-icon opacity-0 hover:bg-surface-hover group-hover/cell:opacity-100"
      >
        ✎
      </button>
    </span>
  );
}
