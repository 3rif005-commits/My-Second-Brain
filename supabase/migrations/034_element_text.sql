-- 034 — text versions of source elements, saved once
-- Design: docs/AI_SOURCE_TOOLS_PLAN.md (§2 "Text first, pixels only when needed")
--
-- The AI reads a source's figures and formulas as TEXT by default: a figure as
-- a 1–3 sentence description, a formula as LaTeX. Both cost one vision call to
-- make, so each is made once and kept here instead of being re-made on every
-- click ("formula → LaTeX" re-ran OCR each time before this).
--
-- Run in the Supabase SQL editor of the live project BEFORE pushing the code
-- that uses it. Safe to run twice.

ALTER TABLE resource_elements ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE resource_elements ADD COLUMN IF NOT EXISTS latex        TEXT;
ALTER TABLE resource_elements ADD COLUMN IF NOT EXISTS described_at TIMESTAMPTZ;

-- RLS is already on for resource_elements (013); the owner policy covers the
-- new columns.

NOTIFY pgrst, 'reload schema';
