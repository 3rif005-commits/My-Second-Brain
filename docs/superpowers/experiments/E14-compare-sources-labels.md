# E14 — compare-sources leaking the source's own labels

**Correction (2026-09-24, 03:25):** the two "lectures" are not slides. Both PDFs are AI-generated study guides printed from a browser (pdfinfo Creator: HeadlessChrome; they end "END OF MASTERY GUIDE"), built from Arabic lecture transcripts. The DEF-01/INS-06 labels and the "Component Bank" / "Variable Registry" sections are IN the PDFs — not produced by this app's extractor. Results on this case measure this kind of document; they have not been checked on real lecture slides.


Date: 2026-09-24 · Model: `claude-haiku-4-5` · Case: `compare-rs-lectures`
(n=5 per arm; the APP'S extracted text for the two Remote Sensing lectures,
exported from the live note — 38 `|DEF-01|…` labels per lecture)

**Why:** the first live compare-sources note told a student "Source 2
explicitly states INS-06" and "states constraint C-01 and C-02".

**Primary:** runs leaking a label (`forbidden_patterns`, regex over visible
text). **Guardrails:** pass rate, $/run, source anchors.
**Also counted, not scored:** runs using "contradiction" (whether one is
deserved needs reading).

| arm | change | pass | leaked | "contradiction" runs | $/run |
|---|---|---|---|---|---|
| A | shipped skill | 4/5 | 1/5 (C-01…C-04) | 2/5 | 0.029 |
| B | + "never write the labels" + a stricter contradiction rule | 4/5 | 1/5 (INS-06) | 1/5 | 0.030 |
| C | A, with the ID column stripped from the sources | **5/5** | **0/5** | 3/5 | 0.029 |

**B is reverted:** an instruction not to write the labels changed nothing,
and the contradiction wording's 2/5 → 1/5 is noise at n=5.

**C is kept** (`skill_run.strip_extraction_ids`): a table whose header starts
`|ID|` loses that column before the text reaches a skill. 38 → 0 labels in
the prompt, so the leak is impossible rather than unlikely; cost flat (input
−2%), anchors unchanged.

**Not done:** the study-guide synthesis still receives the IDs — unmeasured
there. "Contradiction" in 3/5 runs of C still needs reading to judge.

**Ratchet line added:** don't instruct a model not to copy something — don't
show it.
