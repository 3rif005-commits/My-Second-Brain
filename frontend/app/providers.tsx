"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TooltipProvider } from "@/components/ui/Tooltip";
import {
  DEFAULT_PREFERENCES,
  applyPreferences,
  loadPreferences,
  resolveTheme,
  savePreferences,
  type Preferences,
  type ThemeChoice,
} from "@/lib/preferences";

interface ThemeCtx {
  /** The theme actually shown: "light" or "dark" ("system" already resolved). */
  resolvedTheme: "light" | "dark";
  /** Light, dark, or follow the OS. */
  setTheme: (t: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeCtx>({
  resolvedTheme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface PreferencesCtx {
  preferences: Preferences;
  updatePreferences: (patch: Partial<Preferences>) => void;
}

const PreferencesContext = createContext<PreferencesCtx>({
  preferences: DEFAULT_PREFERENCES,
  updatePreferences: () => {},
});

/** Settings → Preferences, and anything that reads a user default (date format, peek mode…). */
export function usePreferences() {
  return useContext(PreferencesContext);
}

// Lightweight toast — replaces window.alert() for error/status messages.
// Native alert() blocks the tab (including browser automation), so any
// non-blocking notification goes through here instead.
type ToastVariant = "error" | "info";
interface ToastItem { id: number; message: string; variant: ToastVariant }
interface ToastCtx { showToast: (message: string, variant?: ToastVariant) => void }

const ToastContext = createContext<ToastCtx>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (typeof document === "undefined" || toasts.length === 0) return null;
  return createPortal(
    // Notion's toast: centred, 24px above the bottom, near-black in both themes,
    // radius 8px, 14px text, sliding up over 0.27s (checklist #62-63).
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[1000000] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.variant === "error" ? "alert" : "status"}
          className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg bg-surface-tooltip px-4 py-[11px] text-sm text-ink-on-tooltip shadow-tooltip animate-[toast-in_0.27s_ease-out]"
        >
          {t.variant === "error" && <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink-danger" />}
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="shrink-0 rounded px-1 text-ink-tooltip-hint hover:text-ink-on-tooltip"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  // Read the stored preferences after mount (avoids an SSR mismatch). The inline
  // boot script in layout.tsx has already painted them, so nothing flashes.
  useEffect(() => {
    const stored = loadPreferences();
    setPreferences(stored);
    setResolvedTheme(resolveTheme(stored.theme));
  }, []);

  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((prev) => {
      const next = { ...prev, ...patch };
      savePreferences(next);
      applyPreferences(next);
      setResolvedTheme(resolveTheme(next.theme));
      return next;
    });
  }, []);

  const setTheme = useCallback((next: ThemeChoice) => updatePreferences({ theme: next }), [updatePreferences]);

  // "Use system setting" follows the OS live.
  useEffect(() => {
    if (preferences.theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyPreferences(preferences);
      setResolvedTheme(resolveTheme("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preferences]);

  // Ctrl/Cmd+Shift+L toggles light and dark, as in Notion (checklist #17).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolvedTheme, setTheme]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = "error") => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  return (
    <ThemeContext.Provider value={{ resolvedTheme, setTheme }}>
      <PreferencesContext.Provider value={{ preferences, updatePreferences }}>
        <ToastContext.Provider value={{ showToast }}>
          <TooltipProvider>{children}</TooltipProvider>
          <ToastStack toasts={toasts} onDismiss={dismissToast} />
        </ToastContext.Provider>
      </PreferencesContext.Provider>
    </ThemeContext.Provider>
  );
}
