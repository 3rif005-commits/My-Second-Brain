import { redirect } from "next/navigation";
import { SETTINGS_HOME } from "@/components/settings/sections";

// "Settings" on its own opens the first section.
export default function SettingsIndex() {
  redirect(SETTINGS_HOME);
}
