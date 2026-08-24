import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "@/components/LoginForm";
import { readDashboardSession } from "@/lib/session";

export default async function LoginPage() {
  if (await readDashboardSession()) redirect("/");
  return (
    <AuthShell
      eyebrow="Developer workspace"
      title="Welcome back"
      description="Sign in to review errors from the applications you own."
    >
      <LoginForm />
    </AuthShell>
  );
}
