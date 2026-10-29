import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { ThemeSelector } from "@/components/ui/theme-selector";
import { AccountMenu } from "@/features/auth/components/account-menu";
import type { CurrentAccount } from "@/features/auth/types";

export function PublicShell({
  children,
  current,
  football = false,
}: {
  children: ReactNode;
  current: CurrentAccount | null;
  football?: boolean;
}) {
  return (
    <>
      <a href="#main-content" className="sr-only z-10 rounded-xl bg-surface p-3 text-sm font-semibold text-primary focus:not-sr-only focus:absolute focus:top-3 focus:left-3">
        Saltar al contenido
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <Link href="/" className="min-w-0 rounded-lg text-sm leading-6 font-semibold text-primary sm:text-base" aria-label="Gestor de Ligas Deportivas, inicio">
            {football ? "Liga Municipal de Fútbol" : "Gestor de Ligas Deportivas"}
            <span className="block text-xs font-normal text-muted sm:text-sm">{football ? "Morelia" : "Nuestra comunidad deportiva"}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {current ? <AccountMenu username={current.account.username} initials={current.account.initials}
            mustChangePassword={current.mustChangePassword} publicView />
            : <><ThemeSelector /><ActionLink href="/login" className="shrink-0">Iniciar sesión</ActionLink></>}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-10 sm:py-14">
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 text-xs leading-6 text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <p>Fútbol · Liga Municipal de Fútbol de Morelia</p>
          {football ? <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg font-semibold text-primary hover:underline">
            <ArrowLeft size={14} aria-hidden="true" />Elegir deporte
          </Link> : <p>Básquetbol y voleibol, próximamente.</p>}
        </div>
      </footer>
    </>
  );
}
