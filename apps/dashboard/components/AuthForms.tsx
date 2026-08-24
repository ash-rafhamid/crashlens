"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

async function post(path: string, data: Record<string, FormDataEntryValue | string>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data)
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    verificationToken?: string;
    emailSent?: boolean;
    resetToken?: string;
  };
  return { response, body };
}

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState<
    { email: string; token?: string; emailSent: boolean } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const { response, body } = await post("/api/auth/signup", {
      name: form.get("name") ?? "",
      email,
      password: form.get("password") ?? "",
      workspaceName: form.get("workspaceName") ?? ""
    });
    setSubmitting(false);
    if (!response.ok) {
      setError(body.error ?? "Could not create your account");
      return;
    }
    setComplete({
      email,
      token: body.verificationToken,
      emailSent: body.emailSent !== false
    });
  }

  if (complete) {
    return (
      <div className="auth-complete">
        <span className="auth-check">&#10003;</span>
        <h3>Check your inbox</h3>
        <p>
          {complete.emailSent ? "We sent a verification link to " : "Your account was created for "}
          <strong>{complete.email}</strong>
          {complete.emailSent ? "." : ", but email delivery is not configured yet."}
        </p>
        {complete.token && (
          <Link className="auth-dev-link" href={"/verify-email?token=" + encodeURIComponent(complete.token)}>
            Verify this local development account
          </Link>
        )}
        <Link className="auth-submit auth-link-button" href="/login">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Full name<input name="name" autoComplete="name" placeholder="Your name" minLength={2} required autoFocus /></label>
      <label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required /></label>
      <label>Workspace name <small>Optional</small><input name="workspaceName" placeholder="Your team or company" /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={10} required /><small>10+ characters with uppercase, lowercase, and a number.</small></label>
      {error && <div className="auth-message error">{error}</div>}
      <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Creating account..." : "Create account"}</button>
      <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const { response, body } = await post("/api/auth/forgot-password", {
      email: form.get("email") ?? ""
    });
    setSubmitting(false);
    if (!response.ok) {
      setError(body.error ?? "Could not send reset email");
      return;
    }
    setMessage(body.message ?? "Check your email for a reset link.");
    setResetToken(body.resetToken ?? null);
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@company.com" required autoFocus /></label>
      {error && <div className="auth-message error">{error}</div>}
      {message && <div className="auth-message success">{message}</div>}
      {resetToken && (
        <Link className="auth-dev-link" href={"/reset-password?token=" + encodeURIComponent(resetToken)}>Open the local reset link</Link>
      )}
      <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? "Sending..." : "Send reset link"}</button>
      <p className="auth-switch"><Link href="/login">Return to sign in</Link></p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(token ? null : "This reset link is incomplete.");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError("Passwords do not match");
      setSubmitting(false);
      return;
    }
    const { response, body } = await post("/api/auth/reset-password", { token, password });
    if (!response.ok) {
      setError(body.error ?? "Could not reset password");
      setSubmitting(false);
      return;
    }
    router.replace("/login?reset=complete");
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus /></label>
      <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></label>
      <small className="auth-hint">Use 10+ characters with uppercase, lowercase, and a number.</small>
      {error && <div className="auth-message error">{error}</div>}
      <button className="auth-submit" type="submit" disabled={submitting || !token}>{submitting ? "Updating..." : "Set new password"}</button>
      <p className="auth-switch"><Link href="/login">Return to sign in</Link></p>
    </form>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, setState] = useState<"ready" | "working" | "success" | "error">(token ? "ready" : "error");
  const [error, setError] = useState(token ? null : "This verification link is incomplete.");

  async function verify() {
    setState("working");
    setError(null);
    const { response, body } = await post("/api/auth/verify-email", { token });
    if (!response.ok) {
      setState("error");
      setError(body.error ?? "Could not verify this email");
      return;
    }
    setState("success");
  }

  if (state === "success") {
    return (
      <div className="auth-complete">
        <span className="auth-check">&#10003;</span>
        <h3>Email verified</h3>
        <p>Your private CrashLens workspace is ready.</p>
        <Link className="auth-submit auth-link-button" href="/login">Continue to sign in</Link>
      </div>
    );
  }

  return (
    <div className="auth-form">
      {error && <div className="auth-message error">{error}</div>}
      <button className="auth-submit" type="button" disabled={!token || state === "working"} onClick={verify}>
        {state === "working" ? "Verifying..." : "Verify email"}
      </button>
      <p className="auth-switch"><Link href="/login">Return to sign in</Link></p>
    </div>
  );
}
