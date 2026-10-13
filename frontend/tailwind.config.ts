import type { Config } from "tailwindcss";

// Notion's warm neutral scale, measured (docs/notion-reference/tokens.json):
// 50 sidebar bg · 100 hover/dark primary text · 200 opaque border · 300 scrollbar ·
// 400 tertiary text · 500 secondary text · 600 sidebar row text · 700 strong icon /
// dark border · 800 primary text · 900 dark app bg · 950 deeper.
const WARM_GRAY = {
  50: "rgb(249 248 247 / <alpha-value>)",
  100: "rgb(240 239 237 / <alpha-value>)",
  200: "rgb(230 229 227 / <alpha-value>)",
  300: "rgb(211 209 203 / <alpha-value>)",
  400: "rgb(161 158 153 / <alpha-value>)",
  500: "rgb(125 122 117 / <alpha-value>)",
  600: "rgb(95 94 89 / <alpha-value>)",
  700: "rgb(56 56 54 / <alpha-value>)",
  800: "rgb(44 44 43 / <alpha-value>)",
  900: "rgb(25 25 25 / <alpha-value>)",
  950: "rgb(18 18 18 / <alpha-value>)",
};

// The user-selectable accent scale (app/tokens.css, [data-accent]).
const ACCENT = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((k) => [k, `rgb(var(--accent-${k}) / <alpha-value>)`]),
);

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Notion's WARM neutral scale (app/tokens.css, measured). Every existing
        // gray-*/slate-* class resolves here, so the whole app reads warm at once;
        // new code prefers the semantic names below.
        gray: WARM_GRAY,
        slate: WARM_GRAY,
        // The accent: Notion blue by default, swappable by the user (Settings →
        // Preferences → Accent). indigo-*/violet-*/brand-* all resolve to it.
        accent: {
          ...ACCENT,
          DEFAULT: "var(--c-accent)",
          hover: "var(--c-accent-hover)",
          focus: "var(--c-focus)",
          chip: "var(--c-bg-accent-chip)",
        },
        indigo: ACCENT,
        violet: ACCENT,
        brand: { ...ACCENT, DEFAULT: "var(--c-accent)" },
        // Semantic tokens (app/tokens.css).
        surface: {
          DEFAULT: "var(--c-bg)",
          sidebar: "var(--c-bg-sidebar)",
          elevated: "var(--c-bg-elevated)",
          panel: "var(--c-bg-panel)",
          hover: "var(--c-bg-hover)",
          active: "var(--c-bg-active)",
          selected: "var(--c-bg-selected)",
          "cell-selected": "var(--c-bg-cell-selected)",
          field: "var(--c-bg-field)",
          band: "var(--c-bg-editor-band)",
          callout: "var(--c-bg-callout)",
          code: "var(--c-bg-code)",
          "inline-code": "var(--c-bg-inline-code)",
          "table-header": "var(--c-bg-table-header)",
          chip: "var(--c-bg-chip)",
          tooltip: "var(--c-bg-tooltip)",
          backdrop: "var(--c-bg-backdrop)",
          weekend: "var(--c-bg-weekend)",
          "danger-soft": "var(--c-bg-danger-soft)",
        },
        ink: {
          DEFAULT: "var(--c-text)",
          secondary: "var(--c-text-secondary)",
          tertiary: "var(--c-text-tertiary)",
          sidebar: "var(--c-text-sidebar)",
          placeholder: "var(--c-text-placeholder)",
          disabled: "var(--c-text-disabled)",
          "on-accent": "var(--c-text-on-accent)",
          danger: "var(--c-text-danger)",
          icon: "var(--c-icon)",
          "icon-strong": "var(--c-icon-strong)",
          "icon-subtle": "var(--c-icon-subtle)",
        },
        line: {
          DEFAULT: "var(--c-border)",
          strong: "var(--c-border-strong)",
          opaque: "var(--c-border-opaque)",
          checkbox: "var(--c-border-checkbox)",
        },
        // Database select/status pills (two palettes: opt = pills, blk = page text/highlight).
        opt: {
          default: { bg: "var(--opt-default-bg)", text: "var(--opt-default-text)", dot: "var(--opt-default-dot)" },
          gray: { bg: "var(--opt-gray-bg)", text: "var(--opt-gray-text)", dot: "var(--opt-gray-dot)" },
          brown: { bg: "var(--opt-brown-bg)", text: "var(--opt-brown-text)", dot: "var(--opt-brown-dot)" },
          orange: { bg: "var(--opt-orange-bg)", text: "var(--opt-orange-text)", dot: "var(--opt-orange-dot)" },
          yellow: { bg: "var(--opt-yellow-bg)", text: "var(--opt-yellow-text)", dot: "var(--opt-yellow-dot)" },
          green: { bg: "var(--opt-green-bg)", text: "var(--opt-green-text)", dot: "var(--opt-green-dot)" },
          blue: { bg: "var(--opt-blue-bg)", text: "var(--opt-blue-text)", dot: "var(--opt-blue-dot)" },
          purple: { bg: "var(--opt-purple-bg)", text: "var(--opt-purple-text)", dot: "var(--opt-purple-dot)" },
          pink: { bg: "var(--opt-pink-bg)", text: "var(--opt-pink-text)", dot: "var(--opt-pink-dot)" },
          red: { bg: "var(--opt-red-bg)", text: "var(--opt-red-text)", dot: "var(--opt-red-dot)" },
        },
        blk: {
          default: { text: "var(--blk-default-text)", bg: "var(--blk-default-bg)" },
          gray: { text: "var(--blk-gray-text)", bg: "var(--blk-gray-bg)" },
          brown: { text: "var(--blk-brown-text)", bg: "var(--blk-brown-bg)" },
          orange: { text: "var(--blk-orange-text)", bg: "var(--blk-orange-bg)" },
          yellow: { text: "var(--blk-yellow-text)", bg: "var(--blk-yellow-bg)" },
          green: { text: "var(--blk-green-text)", bg: "var(--blk-green-bg)" },
          blue: { text: "var(--blk-blue-text)", bg: "var(--blk-blue-bg)" },
          purple: { text: "var(--blk-purple-text)", bg: "var(--blk-purple-bg)" },
          pink: { text: "var(--blk-pink-text)", bg: "var(--blk-pink-bg)" },
          red: { text: "var(--blk-red-text)", bg: "var(--blk-red-bg)" },
        },
        toggle: { off: "var(--c-toggle-off)" },
        // Database-UI primitives. Values are CSS vars (globals.css) so the
        // light/dark swap lives in one place; these surface them to Tailwind.
        // Measured from live Notion — see the design doc §5.
        menu: {
          bg: "var(--menu-bg)",
          fg: "var(--menu-fg)",
          disabled: "var(--menu-fg-disabled)",
          divider: "var(--menu-divider)",
          hover: "var(--menu-row-hover-bg)",
          field: "var(--menu-field-bg)",
          badge: "var(--menu-badge-bg)",
        },
      },
      fontFamily: {
        // Notion's system stack, not a web font (checklist #1).
        sans: ["var(--font-ui)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-code)"],
        "page-mono": ["var(--font-mono)"],
      },
      // Database-UI primitives. Values live as CSS vars in globals.css so the
      // light/dark swap happens in one place; these just surface them to
      // Tailwind. Measured from live Notion — see the design doc §5.
      borderRadius: {
        menu: "var(--menu-radius)",
        xs: "var(--radius-xs)",
        card: "var(--radius-card)",
        modal: "var(--radius-modal)",
      },
      boxShadow: {
        menu: "var(--menu-shadow)",
        float: "var(--shadow-float)",
        card: "var(--shadow-card)",
        chip: "var(--shadow-chip)",
        modal: "var(--shadow-modal)",
        tooltip: "var(--shadow-tooltip)",
        focus: "var(--ring-focus)",
        input: "var(--ring-input)",
      },
      transitionDuration: { instant: "20ms", fast: "100ms", popover: "200ms", panel: "200ms" },
      spacing: {
        "menu-row": "var(--menu-row-height)",
        "menu-icon": "var(--menu-icon-box)",
      },
      width: {
        "menu-sm": "var(--menu-width-sm)",
        "menu-md": "var(--menu-width-md)",
        "menu-lg": "var(--menu-width-lg)",
        "config-sidebar": "var(--config-sidebar-width)",
      },
      fontSize: { menu: "var(--menu-label-size)" },
    },
  },
  plugins: [],
};

export default config;
