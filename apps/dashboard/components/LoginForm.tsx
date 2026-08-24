"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);
    setNeedsVerification(false);
    const form = new FormData(event.currentTarget);
    const nextEmail = String(form.get("email") ?? "");
    setEmail(nextEmail);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: nextEmail, password: form.get("password") })
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    if (!response.ok) {
      setError(body.error ?? "Could not sign in");
      setNeedsVerification(body.code === "EMAIL_NOT_VERIFIED");
      setSubmitting(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function resendVerification() {
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(body.error ?? "Could not send verification email");
      return;
    }
    setNeedsVerification(false);
    setNotice(body.message ?? "Verification email sent.");
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>
        Email address
        <input name="email" type="email" autoComplete="username" placeholder="you@company.com" required autoFocus />
      </label>
      <label>
        <span className="auth-label-row">
          Password
          <Link href="/forgot-password">Forgot password?</Link>
        </span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <div className="auth-message error">{error}</div>}
      {notice && <div className="auth-message success">{notice}</div>}
      <button type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Sign in"}</button>
      {needsVerification && (
        <button className="auth-secondary-action" type="button" onClick={resendVerification}>
          Send a new verification email
        </button>
      )}
      <p className="auth-switch">New to CrashLens? <Link href="/signup">Create an account</Link></p>
    </form>
  );
}
