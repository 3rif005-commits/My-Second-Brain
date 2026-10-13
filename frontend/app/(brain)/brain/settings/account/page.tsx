"use client";

// Settings → My account: the profile (preferred name, email), sign out, and the
// user ID — laid out like Notion's Account tab (settings.md §5).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/app/providers";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/ui/Settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export default function AccountPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const u = data.user;
        if (!u) return;
        setEmail(u.email ?? "");
        setUserId(u.id);
        const n = (u.user_metadata?.full_name as string | undefined) ?? "";
        setName(n);
        setSavedName(n);
      });
  }, []);

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed === savedName) return;
    const { error } = await createClient().auth.updateUser({ data: { full_name: trimmed } });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setSavedName(trimmed);
    showToast("Name updated", "info");
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <SettingsPage title="My account">
      <SettingsSection title="Profile">
        <div className="flex items-center gap-5">
          <div
            aria-hidden
            className="flex size-[62px] shrink-0 items-center justify-center rounded-full bg-surface-chip text-2xl font-medium text-ink-secondary"
          >
            {initial}
          </div>
          <div className="w-full max-w-[400px]">
            <label htmlFor="preferred-name" className="mb-1 block text-xs text-ink-secondary">
              Preferred name
            </label>
            <Input
              id="preferred-name"
              inputSize="lg"
              value={name}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Account security">
        <SettingsRow label="Email" help={email || "…"} />
        <SettingsRow label="Sign out" help="Sign out of My Second Brain on this device.">
          <Button variant="secondary" icon={<LogOut />} onClick={() => setConfirmSignOut(true)}>
            Sign out
          </Button>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Support">
        <SettingsRow label="User ID" help={<span className="font-mono text-xs">{userId || "…"}</span>}>
          <Button
            variant="ghost"
            icon={<Copy />}
            disabled={!userId}
            onClick={async () => {
              await navigator.clipboard.writeText(userId);
              showToast("Copied user ID", "info");
            }}
          >
            Copy
          </Button>
        </SettingsRow>
      </SettingsSection>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out of My Second Brain?"
        confirmLabel="Sign out"
        onConfirm={signOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </SettingsPage>
  );
}
