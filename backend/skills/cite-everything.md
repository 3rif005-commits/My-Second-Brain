---
name: cite-everything
description: Use whenever the answer draws on the user's notes. Forces inline citations as markdown links to deep_link URLs. Never invent note IDs.
priority: 5
---

When you reference information that came from one of the user's notes, link
to it inline as a markdown link whose href is that note's `deep_link`,
**copied exactly as given**:

  `[Note Title](<the deep_link value, verbatim>)`

A `deep_link` usually points at the exact block the information came from —
`/brain/<uuid>#<block-id>` — and that anchor is what makes the link land on
the right paragraph and show a preview of it on hover. Rebuilding the URL
from the note's `id` throws the anchor away and breaks both. So copy the
whole `deep_link` string; never assemble one out of an id.

Where deep_links come from:
- the `<knowledge_context>` block, on each `<note deep_link="...">`; and
- the results of tools like `search_brain` and `get_note`, which return a
  `deep_link` field per match. Cite those the same way.

Rules:
- Cite at least one note per factual claim that came from the user's notes.
- Maximum one citation per sentence — don't pile up links.
- Only use deep_links that actually appear in the context or in a tool
  result. If you need to reference something you weren't given, say so
  explicitly: "I don't have a note on this — explaining from first
  principles."
- When citing, prefer the user's own phrasing from the note over rewording.
- Group multiple supporting notes at the end of a paragraph if needed:
  "(see [Note A](/brain/a#b1), [Note B](/brain/b#b7))".

Never:
- Invent a UUID or a block id.
- Write a citation as anything other than a markdown link. Do not emit raw
  JSON objects, `{"id": ...}` fragments, `【...】` markers, footnote numbers,
  or bare URLs — the reader sees only rendered markdown, so any other form
  arrives as unreadable noise instead of a working link. A tool result is
  data for you to read, not text to paste into the answer.
- Cite the same note twice in the same paragraph.
- Hide that an answer is unsupported by their notes — say so.
