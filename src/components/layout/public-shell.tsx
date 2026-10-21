import Link from "next/link";
import { ArrowLeft, LogIn } from "lucide-react";
import type { ReactNode } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { getAuthSession } from "@/server/auth/session";

export async function PublicShell({
  children,
  football = false,
}: {
  children: ReactNode;
  football?: boolean;
}) {
  const session = await getAuthSession();

  const accountAction = !session?.user
    ? { href: "/login", label: "Iniciar sesión" }
    : session.user.mustChangePassword
      ? { href: "/change-password", label: "Cambiar contraseña" }
      : { href: "/access", label: "Ir a mi panel" };

  return (
    <>
      <a href="#main-content" className="sr-only z-10 rounded-xl bg-surface p-3 text-sm font-semibold text-primary focus:not-sr-only focus:absolute focus:top-3 focus:left-3">
        Saltar al contenido
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <Link href="/" className="min-w-0 rounded-lg text-sm leading-6 font-semibold text-primary sm:text-base" aria-label="Gestor de Ligas Deportivas, inicio">
            {football ? "Liga Municipal de Fútbol" : "Gestor de Ligas Deportivas"}
            <span className="block text-xs font-normal text-muted sm:text-sm">{football ? "Morelia" : "Nuestra comunidad deportiva"}</span>
          </Link>
          <nav aria-label="Acceso a la cuenta" className="shrink-0">
            <ActionLink href={accountAction.href}>
              {accountAction.label}
            </ActionLink>
          </nav>
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
