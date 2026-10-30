import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { ManagementDashboard } from "@/features/auth/components/management-dashboard";
import { getAccessOverview } from "@/features/auth/server/access-overview";
import { AuthorizationError } from "@/server/auth/authorization";
import { getManagementNavigation } from "@/features/auth/server/management-navigation";
import { getDashboardActivity } from "@/features/auth/server/dashboard-queries";

export const metadata: Metadata = { title: "Mi panel" };

export default async function AccessPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentAccount({ includeAssignments: true });

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  const params = await searchParams;
  let data;
  try {
    data = await Promise.all([
      getAccessOverview(), getManagementNavigation(), getDashboardActivity(params.context, params.clubAfter),
    ]);
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) redirect("/login");
    throw error;
  }
  const [scopes, navigation, activity] = data;
  return <ManagementDashboard account={current.account} scopes={scopes} navigation={navigation} activity={activity} />;
}
