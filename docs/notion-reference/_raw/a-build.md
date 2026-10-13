# Build log: Notion UI Reference fixture

Workspace: "<workspace>" (Private section). Built in Chrome via UI; data rows imported via the page's own "Merge with CSV" (the CSV File object was injected from JS since the native file picker is not drivable).

## URLs (app.notion.com)
- Reference page "UI Reference (Claude)": https://app.notion.com/p/UI-Reference-Claude-3f77b5cb32d0809fab33f28251fc6d70
- Projects (full-page DB): https://app.notion.com/p/3f77b5cb32d0800ba5eccccc419dd837
  - Table: ?v=3f77b5cb32d08096807b000c9571b6e0
  - Table — grouped (group Status, filter Priority is not Someday, sort Due ascending): ?v=3f77b5cb32d080c89032000cf11033ad
  - Board (group Status): ?v=3f77b5cb32d0803699e9000c6846a06a
  - Gallery (card preview = Page cover): ?v=3f77b5cb32d0802a951a000cc73f5091
  - List: ?v=3f77b5cb32d080398012000c7e86c647
  - Calendar (by Due): ?v=3f77b5cb32d080d69c30000c75e72b2b
  - Timeline (by Due): ?v=3f77b5cb32d080ac8807000c22a5cfa0
  - Chart (vertical bar, X = Status, Y = count): ?v=3f77b5cb32d080c38e46000c817091b8
- Clients (full-page DB): https://app.notion.com/p/3f77b5cb32d080679bc7eeedf708b3d4
- Empty DB (full-page DB, 0 rows): https://app.notion.com/p/3f77b5cb32d080ec9e11eb187a7948b3

## Reference page content (in order)
Emoji icon (test-tube), cover (default gradient from "Add cover"), description paragraph; H1/H2/H3; paragraph with bold, italic, inline code, link (example.com), red text, yellow background; bulleted (3, one nested), numbered (3), to-do (4, first 2 checked); toggle open + toggle closed (each with child); callout; quote; divider; code block (JavaScript); image block (Unsplash via Link); simple Table block 3x3 with header row; 2 columns; paragraph with date mention (@Today) and page mention (@Projects); sub-page blocks Projects, Clients, Empty DB; linked view of Projects (Table layout) at the end.
Note: the sub-page DB links sit before the linked view; the linked view is the last block.

## Projects properties
Name (Title), Notes (Text), Budget (Number, US Dollar), Priority (Select), Tags (Multi-select), Status (Status), Due (Date; ranges on 4 rows), Owner (Person; only 1 row set, rest empty), Done (Checkbox), Website (URL), Contact (Email), Attachments (Files; external link https://example.com/spec.pdf on 2 rows: Annual report, Hiring plan), Client (Relation to Clients, two-way, shows as "Projects" on Clients; assigned on 4 rows only), Client industry (Rollup: Client -> Industry), Score (Formula prop("Budget") / 1000), Created (Created time), Edited (Last edited time), Action (Button: Edit Done -> checked; not clicked), Ref (Unique ID, prefix PRJ; numbering begins at PRJ-16 because 15 import duplicates were created and trashed).
Formula Score and rollup render but Client industry is empty for most rows because Industry on Clients is only set for 4 rows (see below) and Client only on 4 projects.

### Option colors
- Priority: Low=yellow, Medium=red, High=orange, Urgent=purple, Someday=gray (colors auto-assigned by Notion, verified visually)
- Tags: Design=pink, Backend=gray, Frontend=orange, Research=default, Marketing=brown, Ops=default, Legal=red, Finance=green
- Status: Not started=gray, In progress=blue, Done=green, Review=blue, Blocked=brown
- Combined coverage: Default (Research/Ops), Gray, Brown, Orange, Yellow, Green, Blue, Purple, Pink, Red = all 10.

## Rows
15 projects (Website redesign, Mobile app v2, Q3 marketing push, API migration, Brand guidelines, Customer research, Data warehouse, Security audit, Onboarding flow, Pricing experiment, Partner portal, Mobile analytics, Hiring plan, Legal compliance review, Annual report) with varied values; empties: Notes (2), Budget (shows $0.00 for 2 because CSV blanks imported as 0), Due (2), Website, Contact, Owner (14), Attachments (13), Client (11). Every Status has >=1 row. Covers on 4 rows: Annual report, Legal compliance review, Hiring plan, Mobile analytics.
Clients: Acme Corp, Globex, Initech, Umbrella; Industry (Select) set on all 4 (Healthcare, Software values only; Acme=Healthcare, Globex=Software, Initech=Software, Umbrella=Healthcare).

## Skipped / issues
- Done checkbox true only on rows via CSV (Customer research, Hiring plan).
- Client relation assigned on only 4 of 15 projects (UI picker flaky); Owner on 1 row.
- Imports created 15 duplicate rows first; the empty originals were moved to Trash (my own rows).
- An accidental click on "Generate with AI" in the Tags option editor started an AI request; it was stopped immediately and only queried, no changes.
- Unique ID prefix and button action verified in UI; Gallery card preview set to Page cover.
- The Inbox side panel breaks view popups; keep sidebar on Home.
