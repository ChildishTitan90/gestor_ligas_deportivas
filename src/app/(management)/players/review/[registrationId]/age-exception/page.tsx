import Link from "next/link";
import { requireOperationalUser } from "@/server/auth/session";
import { readAgeExceptionForActor } from "@/features/players/server/age-exception-service";
import { readPlayerDossierForActor } from "@/features/players/server/document-queries";
import { AgeExceptionPanel } from "@/features/players/components/age-exception-panel";

export const metadata = { title: "Revisar excepción de edad" };
export default async function Page({ params }: { params: Promise<{ registrationId: string }> }) {
  const actor = await requireOperationalUser(), { registrationId } = await params;
  await readAgeExceptionForActor(actor.id, registrationId);
  const dossier = await readPlayerDossierForActor(actor.id, registrationId);
  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <Link href="/players/review" className="inline-flex min-h-12 items-center underline">Volver a revisiones</Link>
    <header className="space-y-2"><h1 className="text-2xl font-semibold text-primary">Revisar excepción de edad</h1><h2 className="text-xl font-semibold">{dossier.player.displayName}</h2><p>{dossier.player.clubName} · {dossier.player.teamName} · {dossier.player.categoryName} · {dossier.player.seasonName}</p></header>
    <AgeExceptionPanel actorId={actor.id} registrationId={registrationId} />
    <Link href={`/players/review/${registrationId}/documents`} className="inline-flex min-h-12 items-center underline">Consultar los demás documentos y requisitos</Link>
  </section>;
}
