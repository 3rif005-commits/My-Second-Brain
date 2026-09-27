"use client";

// "An app wants to use your Second Brain" — the Allow page of the remote MCP
// server's login (5.4). Nothing is shared until the user clicks Allow.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpen, FilePlus, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/Logo";

interface Ask { client_name: string; client_uri?: string | null; redirect_host: string }

function Connect() {
  const rid = useSearchParams().get("request") ?? "";
  const [ask, setAsk] = useState<Ask | null>(null);
  const [state, setState] = useState<"loading" | "ask" | "signin" | "expired" | "busy" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!rid) { setState("expired"); return; }
    fetch(`/api/mcp-connect/${encodeURIComponent(rid)}`).then(async (r) => {
      if (r.status === 401) return setState("signin");
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.error ?? ""); return setState(r.status === 404 ? "expired" : "error"); }
      setAsk(data); setState("ask");
    }).catch(() => setState("error"));
  }, [rid]);

  async function answer(allow: boolean) {
    setState("busy");
    const r = await fetch(`/api/mcp-connect/${encodeURIComponent(rid)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allow }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.redirect) { window.location.href = data.redirect; return; }
    setError(data.error ?? "Something went wrong."); setState("error");
  }

  const next = `/mcp-connect?request=${encodeURIComponent(rid)}`;
  return (
    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 ring-1 ring-gray-200 dark:ring-white/10 shadow-sm p-6">
      <Logo size={40} className="mb-4 rounded-xl" />
      {state === "loading" && <p className="text-sm text-gray-500">Loading…</p>}
      {state === "signin" && (
        <>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Sign in to continue</h1>
          <p className="mt-1 text-sm text-gray-500">An app is asking to use your Second Brain. Sign in first, then decide.</p>
          <a href={`/login?next=${encodeURIComponent(next)}`}
            className="mt-5 inline-flex h-10 items-center px-5 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500">
            Sign in
          </a>
        </>
      )}
      {state === "expired" && (
        <>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-50">This request expired</h1>
          <p className="mt-1 text-sm text-gray-500">{error || "Go back to the app and connect again."}</p>
        </>
      )}
      {state === "error" && <p className="text-sm text-red-600">{error || "Could not load this request."}</p>}
      {(state === "ask" || state === "busy") && ask && (
        <>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-50" data-testid="mcp-connect-title">
            {ask.client_name} wants to use your Second Brain
          </h1>
          <p className="mt-1 text-xs text-gray-400">It will return to {ask.redirect_host}</p>
          <ul className="mt-5 space-y-3 text-sm text-gray-700 dark:text-gray-200">
            <li className="flex gap-2.5"><BookOpen size={16} className="mt-0.5 shrink-0 text-indigo-500" />Search and read your notes</li>
            <li className="flex gap-2.5"><FilePlus size={16} className="mt-0.5 shrink-0 text-indigo-500" />Create new notes when you ask it to</li>
            <li className="flex gap-2.5"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-500" />Changing or deleting a note waits for your approval (Settings → Connected apps)</li>
          </ul>
          <div className="mt-6 flex gap-2">
            <button onClick={() => answer(true)} disabled={state === "busy"}
              className="h-10 px-5 rounded-full bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50">
              Allow
            </button>
            <button onClick={() => answer(false)} disabled={state === "busy"}
              className="h-10 px-5 rounded-full ring-1 ring-gray-200 dark:ring-white/10 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
              Deny
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function McpConnectPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <Suspense fallback={null}><Connect /></Suspense>
    </div>
  );
}
