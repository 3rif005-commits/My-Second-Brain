"use client";

import { Logo } from "@/components/brand/Logo";
import { useState } from "react";
import Link from "next/link";
import { safeNext } from "@/lib/safeNext";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Sign in failed. Check your credentials.");
      setLoading(false);
    } else {
      window.location.href = safeNext(new URLSearchParams(window.location.search).get("next"));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={48} className="mx-auto mb-3 rounded-xl shadow-sm" />
          <h1 className="text-2xl font-semibold text-ink">My Second Brain</h1>
          <p className="mt-1 text-sm text-ink-secondary">Sign in to your knowledge OS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-secondary">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full rounded-md bg-surface-field px-2.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--c-border-strong)] outline-none placeholder:text-ink-placeholder focus:shadow-input"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded-md bg-surface-field px-2.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--c-border-strong)] outline-none placeholder:text-ink-placeholder focus:shadow-input"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-md bg-surface-danger-soft px-3 py-2 text-sm text-ink-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-9 w-full rounded-md bg-accent px-4 text-sm font-medium text-ink-on-accent transition-colors duration-instant hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-secondary">
          No account?{" "}
          <Link href="/signup" className="text-accent font-medium hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
