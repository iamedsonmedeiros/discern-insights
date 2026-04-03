import { DashboardClient } from "./dashboard-client";
import { getUserRole } from "@/app/actions-analytics";

export default async function DashboardPage() {
  const role = await getUserRole();
  const isAdmin = role === 'admin';

  return <DashboardClient isAdmin={isAdmin} />;
}
