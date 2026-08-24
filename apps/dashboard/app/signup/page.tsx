import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SignupForm } from "@/components/AuthForms";
import { readDashboardSession } from "@/lib/session";

export default async function SignupPage() {
  if (await readDashboardSession()) redirect("/");
  return (
    <AuthShell eyebrow="Create your workspace" title="Start monitoring" description="Create a private workspace for your applications and error data.">
      <SignupForm />
    </AuthShell>
  );
}
