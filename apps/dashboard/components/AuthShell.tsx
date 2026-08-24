import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-intro" aria-label="About CrashLens">
        <Link className="auth-brand" href="/">
          <span className="auth-brand-mark">C</span>
          <span>CrashLens</span>
        </Link>
        <div className="auth-intro-copy">
          <p className="auth-kicker">Production error monitoring</p>
          <h2>Know what failed before your users need to explain it.</h2>
          <p>
            Capture browser errors, group repeated failures, and see the release,
            browser, and user journey behind every issue.
          </p>
        </div>
        <div className="auth-process">
          <span><b>01</b> Capture errors from your application</span>
          <span><b>02</b> Group repeated events by root cause</span>
          <span><b>03</b> Resolve issues with useful context</span>
        </div>
        <small>Private workspaces | Secure project keys | Clear ownership</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="auth-brand-mark">C</span><strong>CrashLens</strong>
          </div>
          <p className="auth-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
        </div>
        <p className="auth-legal">By continuing, you agree to use CrashLens responsibly.</p>
      </section>
    </main>
  );
}
