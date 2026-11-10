import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ManagementShell } from "@/components/layout/management-shell";
import { ManagementUnavailable } from "@/components/layout/management-unavailable";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { getManagementNavigation } from "@/features/auth/server/management-navigation";
import { AuthAccessError } from "@/server/auth/session";

export default async function ManagementLayout({ children }: { children: ReactNode }) {
  const current = await getCurrentAccount({ includeAssignments: true });
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  let navigation;
  try {
    navigation = await getManagementNavigation();
  } catch (error) {
    if (error instanceof AuthAccessError)
      redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    console.error("[management] NAVIGATION_UNAVAILABLE");
    return <ManagementUnavailable />;
  }
  const { username, initials, roleNames } = current.account;
  return <ManagementShell account={{ username, initials, roleNames }} navigation={navigation}>
    {children}
  </ManagementShell>;
}
