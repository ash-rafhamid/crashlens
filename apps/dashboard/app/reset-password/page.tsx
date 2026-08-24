import { AuthShell } from "@/components/AuthShell";
import { ResetPasswordForm } from "@/components/AuthForms";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell eyebrow="Account recovery" title="Choose a new password" description="Your new password will sign out any older CrashLens sessions.">
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
