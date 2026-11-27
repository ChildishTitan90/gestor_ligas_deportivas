import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PublicShell } from "@/components/layout/public-shell";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function RecoveryLayout({ children }: { children: ReactNode }) {
  const current = await getCurrentAccount();
  return <PublicShell football current={current} showSignIn={false}>
    <div className="mx-auto max-w-xl space-y-5 rounded-3xl border border-border bg-surface p-5 sm:p-8">
      {children}
    </div>
  </PublicShell>;
}
