import Link from "next/link";
import { AccountMenu } from "@/features/auth/components/account-menu";
import type { AccountPresentation } from "@/features/auth/types";

export function AccountHeader({ account, mustChangePassword = false }: { account: AccountPresentation; mustChangePassword?: boolean }) {
  return <header className="border-b border-border bg-surface">
    <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
      <Link href="/" className="min-w-0 rounded-lg text-sm font-semibold text-primary">
        Liga Municipal <span className="font-normal text-muted">· Morelia</span>
      </Link>
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <AccountMenu username={account.username} initials={account.initials} roleNames={account.roleNames} mustChangePassword={mustChangePassword} />
      </div>
    </div>
  </header>;
}
