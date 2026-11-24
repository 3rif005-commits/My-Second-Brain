-- 036 — what each part of a solved worksheet must show
-- Design: docs/INTERACTIVE_NOTES_DESIGN.md · live finding 2026-11-24 (ESD tutorial 3):
-- "design a PLA / PAL" questions came back with no Karnaugh map and no circuit,
-- and nothing could notice. The map now lists each part's deliverables
-- ("K-map F1", "PAL programming table", "circuit"); the writer must produce them
-- and the free checks flag any that is missing.
--
-- Run in the Supabase SQL editor BEFORE pushing the code that uses it. Safe to run twice.

ALTER TABLE note_units ADD COLUMN IF NOT EXISTS needs JSONB NOT NULL DEFAULT '[]';

NOTIFY pgrst, 'reload schema';

-- Proof it applied: 1 when the column exists.
SELECT count(*) AS needs_column
FROM information_schema.columns WHERE table_name = 'note_units' AND column_name = 'needs';
