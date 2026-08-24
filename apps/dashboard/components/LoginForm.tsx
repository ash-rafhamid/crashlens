"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({
  defaultEmail,
  showDemoCredentials
}: {
  defaultEmail: string;
  showDemoCredentials: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not sign in");
      setSubmitting(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-brand"><span className="logo-mark">C</span><strong>CrashLens</strong></div>
      <p className="eyebrow">WORKSPACE ACCESS</p>
      <h1>Sign in</h1>
      <p className="login-copy">Review errors, releases, and affected users.</p>
      <label>Email address<input name="email" type="email" defaultValue={defaultEmail} autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required autoFocus /></label>
      {error && <div className="login-error">{error}</div>}
      <button type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Continue to dashboard"}</button>
      {showDemoCredentials && <small>Local demo password <code>crashlens-demo-admin</code></small>}
    </form>
  );
}
