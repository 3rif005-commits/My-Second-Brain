"use client";

import { Logo } from "@/components/brand/Logo";
import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Sign up failed. Please try again.");
      setLoading(false);
    } else {
      window.location.href = "/brain";
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo size={48} className="mx-auto mb-3 rounded-xl shadow-sm" />
          <h1 className="text-2xl font-semibold text-ink">My Second Brain</h1>
          <p className="mt-1 text-sm text-ink-secondary">Create your knowledge OS</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-ink-secondary">
              Full name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-9 w-full rounded-md bg-surface-field px-2.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--c-border-strong)] outline-none placeholder:text-ink-placeholder focus:shadow-input"
              placeholder="Ada Lovelace"
            />
          </div>

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
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded-md bg-surface-field px-2.5 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--c-border-strong)] outline-none placeholder:text-ink-placeholder focus:shadow-input"
              placeholder="Min. 8 characters"
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
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-secondary">
          Already have an account?{" "}
          <Link href="/login" className="text-accent font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
