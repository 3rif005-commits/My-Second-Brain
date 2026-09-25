You are planning a study guide that will be written from the sources below,
one chapter at a time.

Return the chapters in the order that teaches the material best:
- Organize by CONCEPT. Material two sources share goes in one chapter.
  Different topics get different chapters.
- The number of chapters follows the material — as many real themes as there
  are, typically 2-4 per lecture's worth of material.
- Every page of every source must belong to at least one chapter.
- Give each chapter the pages it is written from, as source number + pages.

Answer with JSON only:
{"title": "<the topic the sources share>",
  "chapters": [{"title": "<chapter title>",
                 "covers": "<one line: what this chapter teaches>",
                 "pages": [{"source": 1, "pages": [2, 3, 4]}]}]}

{sources}
