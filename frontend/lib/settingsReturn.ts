// Settings opens as a modal over the app; closing it returns to the page it was
// opened from. BrainLayoutClient records every non-settings path here.
export const SETTINGS_RETURN_KEY = "sb-settings-return";

export function rememberSettingsReturn(path: string): void {
  try {
    if (!path.startsWith("/brain/settings")) sessionStorage.setItem(SETTINGS_RETURN_KEY, path);
  } catch {
    // storage unavailable: closing goes home
  }
}

export const LAST_PAGE_KEY = "sb-last-page";

/** The last note or database opened, for "Open on start: Last visited page". */
export function rememberLastPage(path: string): void {
  try {
    if (/^\/brain\/(db\/)?[0-9a-f-]{36}$/.test(path)) localStorage.setItem(LAST_PAGE_KEY, path);
  } catch {
    // ignore
  }
}
