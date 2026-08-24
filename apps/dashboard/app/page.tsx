import { IssueDashboard } from "@/components/IssueDashboard";
import { readDashboardSession } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await readDashboardSession();
  if (!session) redirect("/login");
  return <IssueDashboard adminEmail={session.email} />;
}
