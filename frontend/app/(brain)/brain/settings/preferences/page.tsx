"use client";

// Settings → Preferences: "customize your experience". Defaults are pure Notion;
// every change applies at once (lib/preferences.ts → attributes on <html>) and is
// saved on this device and to the account, so it follows you to other devices.
import { useEffect, useRef } from "react";
import { usePreferences } from "@/app/providers";
import { createClient } from "@/lib/supabase/client";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/ui/Settings";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { cx } from "@/components/ui/cx";
import { formatDate, toISODate } from "@/lib/formatDate";
import type { AccentChoice, DateFormat, Preferences } from "@/lib/preferences";

const ACCENTS: { value: AccentChoice; label: string; swatch: string }[] = [
  { value: "blue", label: "Blue (Notion)", swatch: "rgb(39 131 222)" },
  { value: "indigo", label: "Indigo", swatch: "rgb(99 102 241)" },
  { value: "purple", label: "Purple", swatch: "rgb(144 101 176)" },
  { value: "green", label: "Green", swatch: "rgb(68 131 97)" },
  { value: "orange", label: "Orange", swatch: "rgb(217 115 13)" },
  { value: "pink", label: "Pink", swatch: "rgb(193 76 138)" },
  { value: "gray", label: "Graphite", swatch: "rgb(96 94 90)" },
];

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "full", label: "Full date" },
  { value: "short", label: "Short date" },
  { value: "mdy", label: "Month/Day/Year" },
  { value: "dmy", label: "Day/Month/Year" },
  { value: "ymd", label: "Year/Month/Day" },
  { value: "relative", label: "Relative" },
];

/** Saves preferences to the signed-in user's metadata, debounced. */
function useAccountSync(preferences: Preferences) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      createClient()
        .auth.updateUser({ data: { preferences } })
        .catch(() => {
          // Offline or signed out: the local copy still applies.
        });
    }, 800);
    return () => clearTimeout(t);
  }, [preferences]);
}

export default function PreferencesPage() {
  const { preferences: p, updatePreferences: set } = usePreferences();
  useAccountSync(p);
  const today = toISODate(new Date());

  return (
    <SettingsPage title="Preferences" description="Choose how My Second Brain looks and behaves for you.">
      <SettingsSection title="Appearance">
        <SettingsRow label="Theme" help="Choose a theme for this app on this device.">
          <Select
            label="Theme"
            value={p.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: "system", label: "Use system setting" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Accent color" help="Used for buttons, checkboxes, selection and focus. Greys and tag colours stay the same.">
          <div role="radiogroup" aria-label="Accent color" className="flex items-center gap-1.5">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                type="button"
                role="radio"
                aria-checked={p.accent === a.value}
                aria-label={a.label}
                title={a.label}
                onClick={() => set({ accent: a.value })}
                className={cx(
                  "size-[22px] rounded-full transition-shadow",
                  p.accent === a.value && "shadow-[0_0_0_2px_var(--c-bg),0_0_0_4px_var(--c-text)]",
                )}
                style={{ background: a.swatch }}
              />
            ))}
          </div>
        </SettingsRow>
        <SettingsRow label="High contrast" help="Stronger secondary text and lines for improved visibility.">
          <Toggle label="High contrast" checked={p.highContrast} onChange={(highContrast) => set({ highContrast })} />
        </SettingsRow>
        <SettingsRow label="Density" help="Compact tightens table rows, the sidebar and menus.">
          <Select
            label="Density"
            value={p.density}
            onChange={(density) => set({ density })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Reduce motion" help="Turn off animations and transitions.">
          <Select
            label="Reduce motion"
            value={p.reduceMotion}
            onChange={(reduceMotion) => set({ reduceMotion })}
            options={[
              { value: "system", label: "Use system setting" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Pages" description="Defaults for every page. Each page can still change them from its ⋯ menu.">
        <SettingsRow label="Font" help="The typeface pages open with.">
          <Select
            label="Font"
            value={p.pageFont}
            onChange={(pageFont) => set({ pageFont })}
            options={[
              { value: "default", label: "Default" },
              { value: "serif", label: "Serif" },
              { value: "mono", label: "Mono" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Small text" help="Use a smaller text size on pages.">
          <Toggle label="Small text" checked={p.smallText} onChange={(smallText) => set({ smallText })} />
        </SettingsRow>
        <SettingsRow label="Full width" help="Use the whole window width instead of a reading column.">
          <Toggle label="Full width" checked={p.fullWidth} onChange={(fullWidth) => set({ fullWidth })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Databases">
        <SettingsRow label="Open pages in" help="How a row opens when you click it.">
          <Select
            label="Open pages in"
            value={p.openPagesIn}
            onChange={(openPagesIn) => set({ openPagesIn })}
            options={[
              { value: "side", label: "Side peek" },
              { value: "center", label: "Center peek" },
              { value: "full", label: "Full page" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Show vertical lines in tables" help="Draw the column lines between table cells.">
          <Toggle label="Show vertical lines in tables" checked={p.tableVerticalLines} onChange={(tableVerticalLines) => set({ tableVerticalLines })} />
        </SettingsRow>
        <SettingsRow label="Show page icons in tables" help="Show each row's page icon before its title.">
          <Toggle label="Show page icons in tables" checked={p.tablePageIcons} onChange={(tablePageIcons) => set({ tablePageIcons })} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Language & time">
        <SettingsRow label="Date format" help="How dates appear in databases and mentions.">
          <Select
            label="Date format"
            value={p.dateFormat}
            onChange={(dateFormat) => set({ dateFormat })}
            options={DATE_FORMATS.map((d) => ({ ...d, hint: formatDate(today, d.value) }))}
            menuWidth={300}
          />
        </SettingsRow>
        <SettingsRow label="Time format">
          <Select
            label="Time format"
            value={p.timeFormat}
            onChange={(timeFormat) => set({ timeFormat })}
            options={[
              { value: "12h", label: "12-hour (1:30 PM)" },
              { value: "24h", label: "24-hour (13:30)" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Start week on Monday" help="This changes how calendars and date pickers appear.">
          <Toggle label="Start week on Monday" checked={p.startWeekOnMonday} onChange={(startWeekOnMonday) => set({ startWeekOnMonday })} />
        </SettingsRow>
        <SettingsRow label="Number format" help="How numbers and currencies are formatted.">
          <Select
            label="Number format"
            value={p.numberFormat}
            onChange={(numberFormat) => set({ numberFormat })}
            options={[
              { value: "default", label: "Default" },
              { value: "en", label: "1,000,000.00" },
              { value: "de", label: "1.000.000,00" },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Startup & input">
        <SettingsRow label="Open on start" help="What opens when you start the app.">
          <Select
            label="Open on start"
            value={p.startPage}
            onChange={(startPage) => set({ startPage })}
            options={[
              { value: "last", label: "Last visited page" },
              { value: "home", label: "Home" },
            ]}
          />
        </SettingsRow>
        <SettingsRow
          label="Use Enter to add a new line"
          help={
            <>
              Applies to chat and other input fields. Press <strong>Cmd/Ctrl</strong> + <strong>Enter</strong> to send.
            </>
          }
        >
          <Toggle label="Use Enter to add a new line" checked={p.enterForNewLine} onChange={(enterForNewLine) => set({ enterForNewLine })} />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  );
}
