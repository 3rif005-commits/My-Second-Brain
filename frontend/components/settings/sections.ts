// REGISTRY — the sections of Settings, in the order of its top bar. A new
// settings page = a folder under app/(brain)/brain/settings/<id>/page.tsx and
// one entry here.
import { AppWindow, Clock, Plug, Server, Sparkles, type LucideIcon } from "lucide-react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "skills", label: "Skills", icon: Sparkles, href: "/brain/settings/skills" },
  { id: "ai-providers", label: "AI providers", icon: Plug, href: "/brain/settings/ai-providers" },
  { id: "mcp", label: "MCP servers", icon: Server, href: "/brain/settings/mcp" },
  // Apps that use YOUR Second Brain (remote MCP, 5.4) — the reverse of the above.
  { id: "connected-apps", label: "Connected apps", icon: AppWindow, href: "/brain/settings/connected-apps" },
  // Rules for jobs that run later (5.3): the monthly limit. What ran is at /brain/activity.
  { id: "background-jobs", label: "Background jobs", icon: Clock, href: "/brain/settings/background-jobs" },
];

/** Where "Settings" goes when no section is named. */
export const SETTINGS_HOME = SETTINGS_SECTIONS[0].href;
