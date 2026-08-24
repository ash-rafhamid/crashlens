import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { dashboardIdentity, readDashboardSession } from "@/lib/session";

export default async function LoginPage() {
  if (await readDashboardSession()) redirect("/");
  return (
    <main className="login-page">
      <div className="login-wrap">
        <LoginForm
          defaultEmail={dashboardIdentity().email}
          showDemoCredentials={process.env.NODE_ENV !== "production"}
        />
        <div className="login-support"><span><i /> API online</span><span>Private developer workspace</span></div>
      </div>
    </main>
  );
}
