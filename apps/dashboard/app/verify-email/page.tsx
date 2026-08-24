import { AuthShell } from "@/components/AuthShell";
import { VerifyEmailForm } from "@/components/AuthForms";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell eyebrow="Email verification" title="Confirm your email" description="Verification keeps your workspace and project data tied to the right owner.">
      <VerifyEmailForm token={token} />
    </AuthShell>
  );
}
