import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/action-link";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { createLeagueAction } from "@/features/competitions/actions";
import { canCreateLeague } from "@/features/competitions/server/leagues";

export const metadata = { title: "Crear liga" };
const control = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-4 py-3";
const messages: Record<string, string> = {
  INVALID_LEAGUE: "Revisa el nombre, la zona horaria y el motivo.",
  DUPLICATE_LEAGUE: "Ya existe una liga con ese nombre.",
  FORBIDDEN: "No tienes permiso global para crear ligas.",
  UNAVAILABLE: "No se pudo confirmar el registro. Consulta las ligas antes de intentar otra vez.",
};

export default async function NewLeaguePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getCurrentAccount({ includeAssignments: true });
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  const allowed = await canCreateLeague();
  const params = await searchParams;
  return <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
    <ActionLink href="/access" variant="secondary">Volver al panel</ActionLink>
    <h1 className="text-2xl font-semibold">Crear liga</h1>
    {!allowed ? <p role="alert">No tienes permiso global para crear ligas.</p> : <>
      {typeof params.error === "string" && <p role="alert">{messages[params.error] ?? messages.UNAVAILABLE}</p>}
      {params.created === "1" && <p role="status">Liga creada. Ya puedes configurar sus temporadas si tienes permiso.</p>}
      <form action={createLeagueAction} className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <label className="block">Nombre de la liga<input name="name" required maxLength={160} className={control} /></label>
        <label className="block">Zona horaria<input name="timezone" required maxLength={100} defaultValue="America/Mexico_City" className={control} /></label>
        <label className="block">Motivo del registro<textarea name="reason" required maxLength={1000} className={control} /></label>
        <button className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">Crear liga</button>
      </form>
      <ActionLink href="/competitions/seasons" variant="secondary">Ir a temporadas</ActionLink>
    </>}
  </div>;
}
