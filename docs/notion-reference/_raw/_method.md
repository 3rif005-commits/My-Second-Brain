# Capture method (shared by every capture batch)

Date: 2026-10-12. Tool: Claude in Chrome, driving the user's real Chrome (logged into Notion, `app.notion.com`).

## Viewport — deviation from the requested 1440×900
The machine's screen is 1366×768, so Chrome cannot be sized to 1440×900. All captures use the
largest available viewport: **1300×649 CSS px, devicePixelRatio 1, 100% zoom**. Computed
styles (sizes, colors, radii, shadows, paddings) do not depend on the viewport; only things
expressed in % or `vw` do (e.g. full-width page content), and those are flagged where they
occur.

## Theme
The user's Appearance setting was **Light** (`localStorage.theme = {"mode":"light"}`) at
the start. It must be **Light** again at the end. Dark captures are done in one pass per
batch: Settings → Preferences → Appearance → Dark, capture, then back to Light.
**Verified 2026-10-12:** `Ctrl+Shift+L` toggles light⇄dark and updates the real Appearance
setting (`body.notion-body` gains `dark notion-dark-theme`; dark body bg `rgb(25,25,25)`).
Use it instead of opening Settings. Check with
`document.body.classList.contains('dark')`. **Always leave the batch in Light.**

## Measurement helper
Inject once per page load (re-inject after a navigation/reload):

```js
window.__m = (el, extra = []) => {
  if (typeof el === 'string') el = document.querySelector(el);
  if (!el) return null;
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  const keys = ['font-family','font-size','font-weight','line-height','letter-spacing','color',
    'background-color','background-image','border-top','border-right','border-bottom','border-left',
    'border-radius','box-shadow','padding','margin','gap','display','transition','opacity',
    'cursor','text-transform','white-space', ...extra];
  const o = { tag: el.tagName.toLowerCase(), cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0,80),
    role: el.getAttribute('role'), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
    x: +r.x.toFixed(1), y: +r.y.toFixed(1) };
  for (const k of keys) { const v = s.getPropertyValue(k);
    if (v && !['none','normal','0px','auto','rgba(0, 0, 0, 0)','all','0s','0px none rgb(0, 0, 0)'].includes(v)) o[k] = v; }
  return o;
};
// find the deepest visible element whose own text matches
window.__t = (txt, root = document) => [...root.querySelectorAll('*')].filter(e =>
  e.offsetParent !== null && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === txt));
// walk up to the first ancestor with a non-transparent background / shadow / border (the styled box)
window.__box = (el) => { while (el && el !== document.body) { const s = getComputedStyle(el);
  if (s.backgroundColor !== 'rgba(0, 0, 0, 0)' || s.boxShadow !== 'none' || s.borderTopWidth !== '0px') return el;
  el = el.parentElement; } return null; };
```

Notion styles mostly via inline `style=""`, and hover states are applied by JS on real
mouse events. So **hover with the `computer` tool's `hover` action, then measure again**.
Synthetic `dispatchEvent` is unreliable. For pressed/active states, use `left_click_drag` with
start = end, or note it as "not measurable".

Record **only distinct values**. Don't paste the same row 15 times; say "all rows identical".
Always say **which element carries the style** (e.g. "the bg is on the parent `div[role=button]`,
not the `span`").

## Screenshots
- `computer` → `action: "screenshot"`, `save_to_disk: true`, **no `scale` param** (the saved file
  uses the screenshot's scale, so a 0.5 scale saves a half-size image). Files are JPEG and land in
  `/tmp/claude-chrome-screenshots-*/`.
- Copy each into `docs/notion-reference/screenshots/<surface>-<light|dark>.jpg` with Bash
  (`cp <saved path> <dest>`). Keep the names kebab-case.
- For small surfaces, use `zoom` with `save_to_disk: true` for a tight crop (region in viewport px).
- **Privacy:** before saving, make sure the frame shows nothing but the "UI Reference (Claude)"
  page tree, the fixture databases, and settings UI. The sidebar can show other private pages
  belonging to the user. If it does, crop it out with `zoom`, or blank the text first with
  JS (`el.textContent = 'Page'`, purely client-side and lost on reload; it never saves to Notion).
  In Settings, the user's name/email/avatar appear on several tabs. Before you screenshot,
  replace them client-side the same way (`'Jane Doe'`, `'user@example.com'`). Never write
  the user's real name or email into any text file.
