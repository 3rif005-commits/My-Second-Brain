// REGISTRY — the sections of Settings, in the order of its left navigation. A new
// settings page = a folder under app/(brain)/brain/settings/<id>/page.tsx and one
// entry here. `group` is the nav heading it sits under (Notion's "Account",
// "Workspace"… headers); `keywords` feed the "Search settings" field.
import {
  AppWindow,
  Clock,
  Plug,
  Route,
  Send,
  Server,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface SettingsSection {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  group: "Account" | "AI" | "Integrations" | "Workspace";
  keywords?: string;
  /** Pages that need the full modal width (e.g. a two-pane editor). */
  wide?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "account", label: "My account", icon: UserRound, href: "/brain/settings/account", group: "Account", keywords: "profile name email sign out user id" },
  {
    id: "preferences",
    label: "Preferences",
    icon: SlidersHorizontal,
    href: "/brain/settings/preferences",
    group: "Account",
    keywords: "theme dark light appearance accent colour color contrast density compact font serif mono small text full width date time format week monday start page language number motion",
  },
  { id: "ai-providers", label: "AI providers", icon: Plug, href: "/brain/settings/ai-providers", group: "AI", keywords: "api key gemini anthropic openai model" },
  // Where each request runs, and which notes may go there (switchboard + privacy gate).
  { id: "routing", label: "Routing", icon: Route, href: "/brain/settings/routing", group: "AI", keywords: "privacy local fast strong rules targets" },
  { id: "skills", label: "Skills", icon: Sparkles, href: "/brain/settings/skills", group: "AI", wide: true, keywords: "prompts instructions" },
  // Push-only mirror of notes into a Notion page you choose.
  { id: "notion", label: "Notion", icon: Send, href: "/brain/settings/notion", group: "Integrations", keywords: "sync mirror token" },
  { id: "mcp", label: "MCP servers", icon: Server, href: "/brain/settings/mcp", group: "Integrations", keywords: "tools web search" },
  // Apps that use YOUR Second Brain (remote MCP, 5.4) — the reverse of the above.
  { id: "connected-apps", label: "Connected apps", icon: AppWindow, href: "/brain/settings/connected-apps", group: "Integrations", keywords: "claude remote access" },
  // Rules for jobs that run later (5.3): the monthly limit. What ran is at /brain/activity.
  { id: "background-jobs", label: "Background jobs", icon: Clock, href: "/brain/settings/background-jobs", group: "Workspace", keywords: "limit monthly schedule" },
];

export const SETTINGS_GROUPS = ["Account", "AI", "Integrations", "Workspace"] as const;

/** Where "Settings" goes when no section is named: Preferences, as in Notion. */
export const SETTINGS_HOME = "/brain/settings/preferences";
