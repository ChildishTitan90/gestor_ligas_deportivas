import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components/login-form";
import { getAuthSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  const session = await getAuthSession();

  if (session?.user) {
    redirect(session.user.mustChangePassword ? "/change-password" : "/access");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col justify-center px-6 py-10 sm:px-10 lg:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[1fr_0.95fr] lg:gap-20">
        <section aria-labelledby="welcome-title" className="max-w-lg">
          <p className="mb-5 flex items-center gap-3 text-xs font-semibold tracking-[0.15em] text-primary uppercase">
            <span className="h-px w-8 bg-accent" aria-hidden="true" />
            Nuestra liga, más cerca
          </p>
          <h1 id="welcome-title" className="text-4xl leading-tight font-semibold tracking-tight text-primary sm:text-5xl">
            El equipo comienza contigo.
          </h1>
          <p className="mt-5 max-w-sm text-base leading-7 text-muted">
            Accede a tu cuenta para ser parte de la gestión de nuestra liga.
          </p>
          <div className="mt-8 hidden items-center gap-3 border-t border-border pt-6 lg:flex">
            <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
            <p className="text-sm text-muted">Una comunidad. La misma pasión por el fútbol.</p>
          </div>
        </section>

        <section aria-labelledby="login-title" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
          <div className="h-1 bg-accent" />
          <div className="p-6 sm:p-9">
            <p className="mb-2 text-xs font-semibold tracking-widest text-muted uppercase">Acceso a la liga</p>
            <h2 id="login-title" className="text-2xl font-semibold tracking-tight">Iniciar sesión</h2>
            <p className="mt-2 mb-7 text-sm leading-6 text-muted">Usa el correo y la contraseña de tu cuenta.</p>
            <LoginForm />
            <p className="mt-7 border-t border-border pt-5 text-sm leading-6 text-muted">
              ¿Necesitas una cuenta o ayuda para entrar? Comunícate con la administración de la liga.
            </p>
          </div>
        </section>
      </div>

      <footer className="mt-12 text-xs leading-5 text-muted lg:mt-16">
        Liga Municipal de Fútbol · Morelia
      </footer>
    </main>
  );
}
