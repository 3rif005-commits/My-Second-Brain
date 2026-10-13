# Notion parity checklist (acceptance criteria)

Every item is a measured value from live Notion (2026-10-12/13). Check each against the clone with
DevTools → Computed. "L / D" means light value / dark value. Details and screenshots: `surfaces/*.md`, `tokens.json`.
An item passes only if it matches exactly. Alphas such as 0.051 are real, not rounding noise.

## A. Global
1. UI font stack is `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"`.
2. App background is `#fff` L / `rgb(25,25,25)` D.
3. Primary text is `rgb(44,44,43)` L / `rgb(240,239,237)` D.
4. Secondary text is `rgb(125,122,117)` L / `rgb(173,169,163)` D.
5. Tertiary text is `rgb(161,158,153)` L / `rgb(125,122,117)` D.
6. Standard hover background is `rgba(33,27,23,0.051)` L / `rgba(255,255,255,0.055)` D.
7. Divider colour is `rgba(42,28,0,0.07)` L / `rgba(255,255,243,0.082)` D.
8. Accent blue is `rgb(39,131,222)` in both themes.
9. Focus-ring blue is `rgb(35,131,226)`.
10. Danger red is `rgb(229,100,88)` in both themes.
11. Light-mode greys are warm (brown-black alphas). No neutral `rgba(0,0,0,x)` greys for hovers or dividers.
12. Row/button hover backgrounds transition over `background 0.02s ease-in`. Icon buttons use `0.1s ease-in-out`.
13. Scrollbars use the native OS bar with `scrollbar-color: rgb(211,209,203) transparent` L / `rgba(255,255,255,0.2) transparent` D. No custom `::-webkit-scrollbar` thumb.
14. Keyboard focus ring on buttons is `box-shadow: rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px` L (gap and halo `rgb(25,25,25)` D).
15. Focused inputs show `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`.
16. The focus ring appears for keyboard focus only, never on mouse click.
17. Light/dark can be toggled with Ctrl+Shift+L.

## B. Sidebar
18. Sidebar width is 270px.
19. Sidebar bg is `rgb(249,248,247)` L / `rgb(32,32,32)` D.
20. The sidebar's right edge is a 1px inset box-shadow `rgb(240,239,237)` L / `rgb(44,44,43)` D, not a border.
21. The workspace switcher row is 32px tall, with a pill radius on hover.
22. The workspace avatar is 22×22 with radius 4px.
23. The workspace name is 14px/500, single line with an ellipsis, and has no chevron.
24. The "«" close-sidebar button is 24×24 round and only appears while the sidebar is hovered.
25. The nav pill row is 32px tall with a 2px gap.
26. The selected nav item is a pill with its label. Its bg is `rgba(33,27,23,0.05)` L / `rgba(255,255,255,0.055)` D.
27. Unselected nav items are 32×32 round icon buttons with 22px icons in `rgb(142,139,134)`.
28. The Search button sits right-aligned in the nav row.
29. The Inbox unread badge is 12px tall, 9px/600 white text on `rgb(229,100,88)`.
30. Section headers ("Private", …) are 12px/500 `rgb(161,158,153)`, not uppercase.
31. On hover a section header gets a bg, darker text `rgb(95,94,89)`, a chevron, and "+" and "⋯" buttons.
32. Page rows are 30px tall at a 31px pitch, with radius 6px.
33. Page-row padding is 5px 8px, with 8px of extra left indent per nesting level.
34. Page-row text is `rgb(95,94,89)` L / `rgb(188,186,182)` D at rest, with the label at weight 400.
35. The selected page row's bg is `rgba(33,27,23,0.05)` and its text is primary.
36. The page-row icon box is 20×20 with an 8px gap before the label.
37. On row hover the icon is replaced by a 20×20 toggle holding a 12px chevron (right when collapsed, down when expanded; transition `transform .2s ease-out`).
38. On row hover a "+" and a "⋯" appear at the right. Each is 20×20 with radius 4px and a 16px icon.
39. The bottom rows (Library, Help, Trash) are 30px tall with 22px icons.
40. The floating bottom bar has a "New chat" pill (138×40) and a round "New page" button (40×40) with shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`.
41. The resize handle has a 12px-wide hit area with `cursor: col-resize`.
42. Collapsing the sidebar (Ctrl+\\) animates its width 270→0 over 0.2s.
43. When collapsed, the top bar shows a 24×24 hamburger. Hovering it shows a floating 270px sidebar with radius `0 8px 8px 0` and the menu shadow.

## C. Top bar
44. The top bar is 44px tall with no bg, border or shadow.
45. Breadcrumb items are 24px tall with radius 6px, 14px/400 text and an 18px icon.
46. The page crumb is followed by a "🔒 Private ⌄" permission pill in `rgb(161,158,153)`.
47. Share is a plain text button (71×28, radius 6px), not a blue button.
48. Copy link, Favorite and ⋯ are 28×28 buttons with radius 6px.
49. Top-bar button hover is `rgba(33,27,23,0.05)` L / `rgba(255,255,255,0.055)` D.
50. There are no Comments or Updates buttons in the top bar.
51. The page ⋯ menu is 256px wide and opens directly under the top bar (top 44px), 12px from the right edge.
52. The page menu opens with `transform-origin: 100% top` and an opacity+scale transition of 200ms ease.
53. The page menu starts with an auto-focused "Search actions…" field.
54. The page menu has three font tiles (Default/Serif/Mono), each 72×61, with the selected tile in blue.
55. The page menu has Small text, Full width and Lock page as toggle rows.
56. The page menu footer shows the word count, "Last edited by" and the time in 12px `rgb(161,158,153)`.

## D. Tooltip, toast, quick find
57. Tooltip bg is `rgb(44,44,43)` in both themes, with text `rgb(240,239,237)` at 12px/16.8px.
58. Tooltip padding is 5px 8px and its radius is 6px.
59. Tooltip shadow is `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`.
60. A tooltip's shortcut line is plain 12px text in `rgb(173,169,163)`, not a key-cap chip.
61. Tooltips appear about 6px from the trigger, after about a 0.5s delay.
62. The toast is centred, 24px above the bottom, with bg `rgb(44,44,43)` in both themes, radius 8px, padding 11px 16px and 14px text.
63. The toast enters with a 0.27s slide-in from the bottom.
64. Quick find (Ctrl+K) is a 1006px dialog at top 9vh, centred over the whole viewport.
65. Quick find is glass: `rgba(255,255,255,0.9)` with `backdrop-filter: blur(40px)` and radius 20px.
66. Quick find has no dimmed backdrop.
67. The quick-find input is 16px/24px and borderless.
68. Quick-find filter chips are 24px tall with radius 32px.
69. Quick-find result rows are 36px tall with radius 12px, titles 14px/500 and the path in 12px `rgb(161,158,153)`.
70. Quick-find section headers ("Today", "Past week") are 12px/500 `rgb(125,122,117)`.
71. Search matches are highlighted as blue `rgb(39,131,222)` 500-weight text with no background.
72. Quick find has a preview pane on the right that can be toggled.

## E. Page
73. The page content column is 720px with a minimum 96px gutter.
74. Full width replaces the outer columns with a fixed 96px gutter.
75. The cover is 30vh tall and full bleed.
76. Cover hover shows a "Change cover | Reposition" pill at top 12px / right 12px, 28px tall with radius 6px and 14px `rgb(142,139,134)` text.
77. The page icon is 78×78 (78px emoji) and overlaps the cover's bottom edge by 42px.
78. The page controls bar (Add icon / Add cover / Add comment) is hidden until the header is hovered (opacity transition .1s).
79. Page control buttons are 28px tall with padding 0 8px, 14px text in `rgb(161,158,153)` and a 14px icon.
80. The page title is 40px/48px/700 and the title text is inset 8px.
81. A full-page database title is 32px/38.4px/700.
82. The empty-title placeholder is "New page", coloured `rgba(21,14,0,0.286)` L / `rgba(255,252,235,0.306)` D.
83. Small text scales body text to 14px/21px, H1 to 26.25px and the title to 32px. Block paddings do not scale.
84. The Serif font is `Lyon-Text, Georgia, ui-serif, serif` with 17px/27.2px body text.
85. The Mono font is `iawriter-mono, Nitti, Menlo, Courier, monospace` with 15px/24px body text.
86. On long pages a table-of-contents rail of dashes appears at the right. On hover it expands to a 232px card with radius 14px, 13px items and the active heading in blue.

## F. Blocks
87. Blocks have no margin. Consecutive blocks touch.
88. A paragraph's wrapper padding is 6px top and bottom, and its leaf padding is 2px, so the block is 40px tall.
89. H1 is 30px/39px/600 with 30px of padding above.
90. H2 is 24px/31.2px/600 with 26px of padding above.
91. H3 is 20px/26px/600 with 22px of padding above.
92. List items are 30px tall at a 30px pitch (1px top and bottom padding).
93. The bullet is a 24px "•" centred in a 24×28 marker box.
94. Nested list items are indented 32px per level.
95. The to-do checkbox is 16×16 with radius 1.5px and a 1px `rgb(56,56,54)` border L / `rgb(230,229,227)` D.
96. A checked to-do is a blue `rgb(39,131,222)` box with a white check. Its text gets opacity 0.7 and a line-through.
97. The toggle caret is 12.8px and rotates −90° when closed (transition .2s ease-out).
98. The callout box has bg `rgb(249,248,247)` L / `rgb(56,56,54)` D, radius 10px, padding 12px and a 1px transparent border.
99. The quote has a 3px solid left border in the text colour, padding 0 14px, and 16px text.
100. The divider is a 1px `rgba(28,19,1,0.11)` line in a 13px-tall block.
101. The code block has bg `rgba(66,35,3,0.03)`, radius 10px, padding 24px 22px, and 13.6px/20.4px monospace text.
102. Code syntax colours are keyword `rgb(0,119,170)`, function `rgb(221,74,104)` and string `rgb(102,153,0)` (L).
103. The code-block hover toolbar holds a language selector, Copy, Wrap and ⋯ in a white pill with radius 6px.
104. The image block has radius 10px and 6×48 resize handles at its sides.
105. The simple table has 1px `rgb(230,229,227)` cells and a header row bg of `rgb(247,246,243)` at weight 500.
106. Simple-table cell text is 14px/20px with padding 7px 9px.
107. Columns have a 46px gutter between them.
108. Inline code is 0.85em, red `rgb(207,81,72)` on `rgba(33,27,23,0.05)`, with radius 4px and padding 0.2em 0.4em.
109. Links are the text colour at opacity 0.7 with a 0.8px underline in `rgba(55,53,47,0.4)`. They are not blue.
110. Bold text is font-weight 600.
111. A page mention is title text at weight 500, underlined, with a 20px icon.
112. A date mention is `rgb(125,122,117)` with no underline.
113. A sub-page link block has a 16px/500 title with a 1px `rgba(28,19,1,0.11)` bottom border and radius 4px on hover.
114. Block text colours match `tokens.json → color.block` (10 colours) in both themes.
115. Block background colours match `color.block` (L and D differ).
116. On hover the block "+" (24×24) sits 52px left of the block and the "⋮⋮" (18×24, cursor grab) sits 28px left.
117. Both block handles are vertically centred on the block's first text line.
118. The block handle icons are `rgb(173,169,163)` L / `rgb(125,122,117)` D.
119. Clicking ⋮⋮ opens a 265px block menu with a search field, Turn into ›, Color › and the actions with their shortcuts.
120. The slash menu is 324px wide and about 239px tall, with a fixed footer reading "Close menu / esc".
121. Slash-menu rows are 32px tall. Their 20px icons have no tile, and the right side shows markdown hints ("#", "##").
122. The slash menu flips above the caret line when there is no room below.
123. The selection toolbar is a 192px vertical card with radius 14px (the 2026 design), or a horizontal bar using the same buttons.
124. Active formatting buttons in the selection toolbar turn blue `rgb(39,131,222)` with no bg.
125. Colour swatch tiles are 26×26 with radius 6px and an inset 1px ring.
126. The empty-block placeholder reads "Press ‘space’ for AI or ‘/’ for commands" and only shows on the focused block.

## G. Database header and toolbar
127. A full-page database uses a padding of 0 96px (full width).
128. View tabs are pills: 32px tall, padding 6px 12px, radius 20px, 14px/500.
129. The active view tab has bg `rgba(33,27,23,0.05)` and primary text. Inactive tabs are `rgb(125,122,117)` with no bg.
130. View tabs have no underline, and there is no border under the views bar.
131. When tabs overflow, a "N more…" pill appears that opens a 290px view list ending with "+ New view".
132. Toolbar icon buttons are 28×28 with radius 6px, 16px icons and no gap between them.
133. The toolbar order is Filter, Sort, Automations, AI Autofill, Search, Settings (sliders), New.
134. The New button is a 68×28 split button with bg `rgb(39,131,222)`, 14px/500 text and a 1px inset divider before the chevron.
135. The New button hover darkens only the hovered half: `rgb(31,118,204)` L / `rgb(61,144,225)` D.
136. The New ▾ dropdown is 360px, right-aligned, with "Templates for Projects" and "+ New template".
137. Toolbar Search expands a 150px borderless input over 0.2s.
138. Active filters or sorts turn the Filter/Sort toolbar icons blue.

## H. Table
139. The header row is 36px tall, with a 1px bottom line `rgba(42,28,0,0.07)` drawn as an inset box-shadow.
140. The header row has no top line and no vertical lines.
141. Header labels are 14px/400 `rgb(125,122,117)` with an 18px icon box and a 6px gap.
142. Property-type icons match the glyph table in `database-table.md` §2 (masked SVGs coloured `rgb(142,139,134)`).
143. The title column is 280px wide and other columns default to 200px.
144. The header row sticks under the top bar when scrolled.
145. Grid lines are the cells' border-right and border-bottom, 1px `rgba(42,28,0,0.07)` L / `rgba(255,255,243,0.082)` D.
146. Cell padding is 7.5px 8px and cell text is 14px/21px.
147. Single-line rows are 37px tall (36px plus a 1px border).
148. Rows have no hover background.
149. The column resize handle is 5×36, `rgba(35,131,226,0.8)` on hover, with `cursor: col-resize`.
150. Header-cell hover fills the whole cell with `rgba(33,27,23,0.051)` at radius 0.
151. The title cell text is 14px/500. A page without an icon shows an 18px empty-page glyph.
152. On row hover the OPEN button appears: 69×24, radius 6px, white with the float shadow, "OPEN" in 12px/500 uppercase with 0.5px letter-spacing, `rgb(125,122,117)`.
153. The gutter shows "+" (24×24), "⋮⋮" (18×24) and a 16px checkbox at 86, 62 and 36px left of the table.
154. The row checkbox's opacity is 0 at rest, 0.7 on row hover and 1 when the checkbox itself is hovered.
155. A selected row gets a `rgba(35,131,226,0.14)` overlay covering the row, not the gutter.
156. The multi-select action bar is 32px tall with radius 5px and the float shadow, and floats over the views bar. It shows "N selected" in blue.
157. A selected cell shows `rgb(39,131,222) 0 0 0 2px inset` with bg `rgba(35,131,226,0.07)`.
158. Select pills are 20px tall with padding 0 6px, radius 4px and 14px/400 text.
159. Status pills are 20px tall with radius 10px, padding 0 9px 0 7px, and an 8px dot with a 5px gap.
160. Multi-select pills wrap with a gap of 6px vertically and 8px horizontally.
161. Option pill colours match `tokens.json → color.option` (all 10, L and D).
162. In dark mode, option pill text is a pale tint, not a dark shade.
163. Numbers are right-aligned in cells and formatted (e.g. "$22,000.00").
164. Dates use the long form "December 15, 2026", and ranges use " → ".
165. Person cells show a 20px circular avatar with a 1px outline ring.
166. Table checkboxes are 16×16 with radius 3px and a 1px `rgba(27,21,0,0.19)` border. Checked ones are filled blue.
167. Email and URL cells are underlined with a 1px gradient background image in `rgba(28,19,1,0.11)`, not text-decoration.
168. URL cells strip the protocol and show the path in tertiary grey.
169. File chips are 24px tall with radius 4px and bg `rgba(42,28,0,0.07)`.
170. Relation values are an 18px page icon plus a 14px/500 underlined title.
171. Button cells are 24px tall with radius 6px, a 1px `rgba(28,19,1,0.11)` border and no bg.
172. Unique ID values are tertiary grey.
173. Empty cells are blank, with no placeholder.
174. The "+ New page" row is 37px tall. Only its 103×28 button gets the hover bg, and its text is 14px `rgb(161,158,153)`.
175. Calculations are set from the column menu → Calculate. There is no "Calculate" on hover.
176. A calculation footer value shows a 10px/500 uppercase label with 1px letter-spacing, then a 14px value, right-aligned in the column.
177. The calculation footer sticks to the viewport bottom when the table is taller than the viewport.
178. An inline (linked) database shows a ↗ icon and a 24px/600 title, and has no tab row when it has a single view.
179. An inline database scrolls full-bleed horizontally while its first column aligns with the text column.

## I. Table editing
180. Cell editors open with a single click as a card at (cell x − 1, cell y − 1).
181. The text cell editor is max(column, 240px) wide, with radius 6px, the menu shadow and padding 8px 9px.
182. The cell editor grows downward and its caret is the text colour.
183. The cell editor appears instantly, with no open animation.
184. Number editing stays right-aligned and shows the formatted value.
185. Esc closes the editor and leaves the cell selected. A second Esc selects the row and a third clears it.
186. Tab in a cell editor moves the selection to the next cell to the right.
187. The select editor is 300px wide with a top band of `rgba(242,241,238,0.6)` L / `rgba(255,255,255,0.03)` D.
188. Pills in the select editor have a 20×20 × remove button.
189. The select editor hint "Select an option or create one" is 12px/500 `rgb(125,122,117)`.
190. The "Create" row previews a pill in the next colour to be assigned.
191. In menus and editors, ↑/↓ move the highlight while focus stays in the input.
192. A keyboard-highlighted row shows the 2px-gap blue focus ring.
193. The status editor is 240px wide, grouped To-do / In progress / Complete, and has no drag handles.
194. The date picker is 248px wide with radius 6px. Its field is 28px with a 1px `rgba(28,19,1,0.11)` ring.
195. Day cells are 32×32 with 28×28 buttons at radius 6px.
196. The calendar weekday labels are 12px `rgb(139,152,152)` (cool grey).
197. Today is a 24px red disc behind a white number.
198. The selected day is solid blue. Day hover is `rgba(35,131,226,0.15)` and the range band is `rgba(35,131,226,0.21)` with rounded ends.
199. Date-picker rows are End date ⏻, Date format ›, Include time ⏻, Remind ›, Clear, and "Learn about reminders".
200. The toggle switch is 30×18 with radius 44px: off `rgba(135,131,120,0.3)`, on `rgb(39,131,222)`, with a 14px knob that moves 12px.
201. The person picker is 240px with avatar plus name rows and a "(You)" suffix, and shows no email.
202. The relation picker is 560px with a search header, 32px rows and a highlight of `rgba(55,53,47,0.06)`.
203. Hovering a filled cell shows a 52×24 Comment/Copy quick-action chip at the cell's top-right.
204. The column header menu is 248px wide, at header-x − 6 and directly below the header.
205. The header menu starts with a 28×28 bordered icon button and a focused name field with an ⓘ.
206. Header menu icons are the text colour (not grey) at 20px.
207. Delete property turns `rgb(229,100,88)` only on hover.
208. Freeze is disabled with `rgb(188,186,182)` text. Disabled Change type rows use opacity 0.4.
209. The Change type flyout is 200px, overlaps the menu by about 19px, has a ✓ on the current type and has no search.
210. The add-property type picker is 415px, a 2-column grid of 192×32 cells.
211. Picking a type with no config creates the column immediately.
212. Edit property from the header menu opens a 300px flyout with values in `rgb(161,158,153)`.
213. "Show as" cards are 83×48. The selected card has a 2px blue ring and blue content.
214. The formula editor is a 740px anchored panel with a 12px/18px monospace code box on `rgb(249,248,247)`.
215. The confirm dialog is 406px with padding 20px, centred text, and stacked 32px buttons with an 8px gap.
216. The confirm dialog's Delete button has red text and a `rgba(206,24,0,0.165)` border.
217. A grouped table's group header is 42px with a 24px collapse toggle (▼, rotates −90° when collapsed) and the group pill.
218. Group headers show "⋯" and "+" on hover. Groups are about 14px apart.
219. Filter and sort chips are 24px tall with radius 32px, bg `rgba(0,124,215,0.094)` and blue text.
220. A filter chip reads "**Property**: value ▾".
221. The chips bar is hidden by default and toggled by the blue Filter icon.
222. The filter chip popover is 260px. The sort chip popover is 317px with 32px outlined buttons.
223. The toolbar Filter and Sort pickers are 290px, list Name first and then the rest alphabetically, and end with "+ Add advanced filter".

## J. Board and gallery
224. Board columns are 276px wide with a 12px gap.
225. A board column header is 40px with radius 10px 10px 0 0. The body has radius 0 0 10px 10px.
226. Board columns are tinted with the group colour (e.g. blue `rgba(0,128,213,0.047)` L).
227. The board column count is 14px in the group colour, placed 8px after the pill.
228. Board cards are 260px wide with radius 10px and an 8px gap.
229. Light board cards are white with shadow `rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, <tinted ring> 0 0 0 1px`.
230. Dark board cards are opaque tinted colours (e.g. blue `rgb(33,48,65)`).
231. The card title is 15px/22.5px/500 with padding 8px 10px.
232. Card property rows are 12px/18px, 28px tall, with no labels. Empty properties are hidden.
233. Board card hover tints the bg and shows a 57×24 edit/⋯ chip at the top-right.
234. The board's "+ New page" is 40px tall with radius 10px, a solid 1px tinted ring (not dashed), 15px text and hover bg equal to the column tint.
235. A board card cover is 148px with object-fit cover, followed by a 1px divider.
236. The gallery grid has a 16px gap and is padded to the page content.
237. Gallery cards have radius 10px and a 16:9 cover with a 1px divider below.
238. A gallery card without a cover shows a placeholder of `rgba(66,35,3,0.03)`.
239. Gallery hover is bg `rgba(55,53,47,0.04)` L / `rgb(47,47,47)` D, plus a Reposition/edit/⋯ chip.
240. The gallery's "+ New page" tile is one column wide, 40px tall, with a 1px ring and 15px `rgb(173,169,163)` text.

## K. List, calendar, timeline, chart
241. List rows are 30px tall at a 32px pitch with no dividers. Hover is `rgba(55,53,47,0.06)` with radius 6px.
242. List titles are 14px/500. Properties are right-aligned plain text.
243. The calendar week starts on Sunday. Weekday labels are 12px `rgb(161,158,153)`.
244. The calendar grid uses border-right and border-bottom in `rgb(230,229,227)` L / `rgb(56,56,54)` D.
245. Calendar cells are 124px tall and grow with more events. There is no "+N more".
246. Calendar weekend cells are bg `rgb(249,248,247)` L / `rgb(32,32,32)` D.
247. Calendar day numbers are right-aligned 11px from the edge. The first day reads "Oct 1".
248. Today in the calendar is a 24px red circle with white text.
249. Calendar event chips are 28px tall with radius 6px, white, shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`, and 14px/600 titles.
250. Multi-day events are one bar per week, and hovering any segment tints all of them.
251. Hovering a calendar cell shows an "Add an item" button at its top-left.
252. The timeline is full bleed with 40px days at Month scale and no vertical grid lines.
253. Timeline weekends are bg `rgb(247,247,247)` and the grid bg is `rgb(253,253,253)`.
254. The timeline today line is 1px `rgb(229,100,88)` with a 7px dot. Today's label is a red 22px pill.
255. Timeline bars are 34px tall with radius 6px, white with the chip shadow, and 14px/500 titles that overflow to the right.
256. Undated pages are listed in a "No date (N)" popup, not drawn in the grid.
257. Chart bars are 16px wide with top radius 2px and are coloured by the option colour (e.g. blue `rgb(94,159,232)`).
258. Chart grid lines are dotted (1 3) in `rgb(230,229,227)` with a solid baseline. Axis labels are 12px `rgb(125,122,117)`.
259. The chart tooltip is a card with radius 8px, an 8px colour square, the value, and "Click to view data".

## L. Row page and peek
260. The side peek is 650px at a 1300px viewport. It pushes the page (no dimming) and slides with `width/transform 0.2s ease`.
261. The side peek top bar is 44px: » close, ⤢ open, a divider, peek mode, a divider, ↑ and ↓, with 24×24 buttons.
262. Peek mode and prev/next fade in on top-bar hover. Close and Open are always visible.
263. Alt+J and Alt+K move to the next and previous row. Esc and click-outside close the peek.
264. The side peek content column is 483px and the center peek column is 708px.
265. A row page in a peek has a 32px/700 title and a 20vh cover. The full-page row title is 40px.
266. The center peek is 975px max with 72px insets, radius 12px and a backdrop of `rgba(15,15,15,0.6)` L / 0.8 D.
267. The center peek has no » close button.
268. Property rows are 34px tall at a 38px pitch.
269. The property label column is 160px in every mode.
270. Property labels are 14px `rgb(125,122,117)` with an 18px icon and padding 0 6px.
271. Empty property values read "Empty" in `rgb(161,158,153)`.
272. Numbers are left-aligned in the properties block.
273. Label hover swaps the icon for ⋮⋮, adds a bg and shows a name tooltip to the left.
274. Value hover adds no bg. It shows a Comment/Copy mini-toolbar at the row's right end.
275. Clicking a label opens a 220px menu with Rename, Edit property, Comment, Property visibility › (Always show / Hide when empty / Always hide), Duplicate, Delete and Customize layout.
276. The "+ Add a property" row is 34px tall with 14px `rgb(161,158,153)` text.
277. The comments heading is 13px/500. The composer has a 24px avatar and "Add a comment…" with no border or bg.
278. A focused comment composer shows Attach, @ and Send (opacity 0.4 while empty).
279. A 1px `rgba(55,53,47,0.09)` bottom border separates the header area from the body.
280. The empty body reads "Press ‘enter’ to continue with an empty page, or create a template" at 16px `rgb(161,158,153)`.

## M. View settings
281. View settings is a 483px docked right panel hanging below the views bar, with bg equal to the page and no shadow.
282. The view-settings left border is 1px `rgb(230,229,227)` and fades in over the top 12px.
283. The panel overlays the table and slides in with `opacity/transform 0.2s ease`.
284. Panel navigation is push/pop with ← back, a 14px/600 title and a ✕. Sub-pages swap instantly.
285. Esc closes the whole panel.
286. The panel's ✕ is a 20×20 circle with bg `rgba(42,28,0,0.07)`.
287. Panel rows are 28px with 20px icons in `rgb(56,56,54)` and right-aligned values in `rgb(161,158,153)` with a chevron.
288. Layout cards are a 3×3 grid of 83×56.5 at radius 6px. The selected card has a 2px blue inset ring.
289. The Card layout block offers Compact and List previews (102×76). The selected one has a 2px blue outline.
290. Property visibility rows have ⋮⋮, the icon, the name and an eye toggle. The title row's eye has opacity 0.4.
291. "Hide all" and "Show all" are 12px blue text buttons.
292. More settings opens a popover (Sub-items, Dependencies, Connections, Customize page layout), not a pushed page.
293. Edit properties in the panel pushes "Edit property" into the same sidebar.
294. The view-type picker is a 4-column grid of 92×62 tiles: Table, Board, Gallery, List, Chart, Dashboard, Timeline, Feed, Map, Calendar, Form.
295. Duplicate view and Delete view live in each view's ⋯ menu.

## N. Menus, pickers, modals
296. Menus have radius 10px, the menu shadow (L/D geometry differs) and no border.
297. Menu rows are 28px at a 29px pitch with radius 6px and padding 0 8px.
298. Menu section headers are 12px/500/14.4px `rgb(125,122,117)` with margin 6px 0 8px.
299. Menu hints are 12px `rgb(161,158,153)`, right-aligned.
300. Menus open with opacity plus scale over 200ms ease from the anchor-side origin. They sit 4px from the trigger and are clamped 12px inside the viewport.
301. Submenus open on hover as adjacent flyouts.
302. Danger rows are only red on hover.
303. The emoji picker is 408×390 with tabs (Emoji, Icons, Upload) that have a 2px underline under the active label.
304. Emoji cells are 32×32 with radius 4px and 24px emoji, 11 per row.
305. The Settings modal is 90vw (max 1512px) by calc(100% − 100px), with radius 12px and a backdrop of `rgba(15,15,15,0.6)`.
306. The modal shadow is `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`.
307. Primary buttons are disabled at opacity 0.4.
308. An empty database shows 5 placeholder rows with no message, and the "+ New page" label follows the hovered row.
309. "No results" shows centred outlined "Clear search" and "+ New page" buttons with no message text.

## O. Settings
310. Settings opens as a modal from the workspace switcher with Preferences selected.
311. The settings left nav is 240px with bg `rgb(249,248,247)` L / `rgb(32,32,32)` D and no border.
312. The settings nav starts with an auto-focused "Search settings" field (224×28, radius 6px).
313. Settings nav section headers are 12px/500 `rgb(161,158,153)`.
314. Settings nav items are 28px tall with radius 6px, padding 4px 6px and 20px icons. Labels are 14px/500: inactive `rgb(95,94,89)`, active `rgb(44,44,43)`.
315. The active settings nav item has bg `rgba(33,27,23,0.05)` L / `rgba(255,255,255,0.082)` D.
316. The first settings nav item is the user's avatar plus name.
317. The settings content column has padding 36px 60px 44px and a max-width of 800px.
318. The settings page title is 26px/600/32px. The description is 16px/24px.
319. Settings section headers are 16px/500 with a 1px `rgba(42,28,0,0.07)` hairline below, 12px of padding and 16px of margin.
320. Settings rows are 24px apart and sections 48px apart.
321. Setting labels are 14px/500. Help text is 13px/18px `rgb(125,122,117)`, 4px below the label.
322. The select button is 28px tall with a 1px `rgba(28,19,1,0.11)` border, radius 6px, 14px/500 text and a grey chevron.
323. The select menu is right-aligned to its button, 4px below, and marks the selected option with a ✓ at the right and no bg.
324. Disabled controls (e.g. Time zone while automatic) have opacity 0.4.
325. The settings danger button is a filled pale red `rgba(223,22,0,0.094)` with text `rgb(229,100,88)`.
326. Pill sub-tabs are 28px tall with radius 9999px. The active one has a bg and inactive ones are `rgb(161,158,153)`.
327. Settings search replaces the nav list with results grouped by breadcrumb, with matches in bold.
328. The Preferences tab offers Theme, High contrast, Enter-for-newline, Language, Number format, Text direction controls, Start week on Monday, Date format, Auto time zone, Time zone, Open on start, Cookie settings, View history and Profile discoverability (see `preferences.md`).
329. The Theme options are "Use system setting / Light / Dark".
330. The Date format options are Full date / Short date / Month/Day/Year / Day/Month/Year / Year/Month/Day / Relative, each with an example.
331. The Open on start options are Last visited page / Top page in sidebar / Library / Notion AI.
