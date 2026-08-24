import { AuthShell } from "@/components/AuthShell";
import { ForgotPasswordForm } from "@/components/AuthForms";

export default function ForgotPasswordPage() {
  return (
    <AuthShell eyebrow="Account recovery" title="Reset your password" description="Enter your account email and we will send a secure reset link.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
