// User preferences: the "customize your experience" layer (Settings → Preferences).
//
// Defaults are pure Notion. Visual preferences become attributes on <html> (see
// app/tokens.css), so a single change restyles the whole app. They are cached in
// localStorage and applied by an inline script in app/layout.tsx before first paint,
// so there is no light-to-dark flash; the signed-in user's copy in Supabase
// user_metadata (Settings) follows them across devices.

export type ThemeChoice = "system" | "light" | "dark";
export type AccentChoice = "blue" | "indigo" | "purple" | "green" | "orange" | "pink" | "gray";
export type PageFont = "default" | "serif" | "mono";
export type DateFormat = "full" | "short" | "mdy" | "dmy" | "ymd" | "relative";
export type PeekMode = "side" | "center" | "full";
export type StartPage = "last" | "home";

export interface Preferences {
  theme: ThemeChoice;
  accent: AccentChoice;
  highContrast: boolean;
  density: "comfortable" | "compact";
  reduceMotion: "system" | "on" | "off";
  pageFont: PageFont;
  smallText: boolean;
  fullWidth: boolean;
  openPagesIn: PeekMode;
  tableVerticalLines: boolean;
  tablePageIcons: boolean;
  tableWrap: boolean;
  startPage: StartPage;
  startWeekOnMonday: boolean;
  dateFormat: DateFormat;
  timeFormat: "12h" | "24h";
  numberFormat: "default" | "en" | "de";
  enterForNewLine: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  accent: "blue",
  highContrast: false,
  density: "comfortable",
  reduceMotion: "system",
  pageFont: "default",
  smallText: false,
  fullWidth: false,
  openPagesIn: "side",
  tableVerticalLines: true,
  tablePageIcons: true,
  tableWrap: false,
  startPage: "last",
  startWeekOnMonday: false,
  dateFormat: "full",
  timeFormat: "12h",
  numberFormat: "default",
  enterForNewLine: false,
};

export const PREFS_KEY = "sb-prefs";
/** The pre-preferences theme key, still read so existing users keep their theme. */
export const LEGACY_THEME_KEY = "sb-theme";

export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  let stored: Partial<Preferences> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") ?? {};
  } catch {
    stored = {};
  }
  if (!stored.theme) {
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === "light" || legacy === "dark") stored.theme = legacy;
  }
  return { ...DEFAULT_PREFERENCES, ...stored };
}

export function savePreferences(prefs: Preferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    // Private mode or storage full: preferences still apply for this session.
  }
}

export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice !== "system") return choice;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Write the visual preferences onto <html>. Kept in sync with PREFS_BOOT_SCRIPT. */
export function applyPreferences(prefs: Preferences, root: HTMLElement = document.documentElement): void {
  root.classList.toggle("dark", resolveTheme(prefs.theme) === "dark");
  root.dataset.accent = prefs.accent;
  root.dataset.contrast = prefs.highContrast ? "high" : "standard";
  root.dataset.density = prefs.density;
  root.dataset.reduceMotion = prefs.reduceMotion;
  root.dataset.font = prefs.pageFont;
  root.dataset.smallText = String(prefs.smallText);
  root.dataset.fullWidth = String(prefs.fullWidth);
}

/** Runs inline in <head> before React: applies stored preferences so the first
 * paint is already in the right theme and accent. Must not throw. */
export const PREFS_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,p={};try{p=JSON.parse(localStorage.getItem("${PREFS_KEY}")||"{}")||{}}catch(e){}if(!p.theme){var l=localStorage.getItem("${LEGACY_THEME_KEY}");if(l==="light"||l==="dark")p.theme=l}var t=p.theme||"system";if(t==="system")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")d.classList.add("dark");d.dataset.accent=p.accent||"blue";d.dataset.contrast=p.highContrast?"high":"standard";d.dataset.density=p.density||"comfortable";d.dataset.reduceMotion=p.reduceMotion||"system";d.dataset.font=p.pageFont||"default";d.dataset.smallText=String(!!p.smallText);d.dataset.fullWidth=String(!!p.fullWidth)}catch(e){}})();`;
