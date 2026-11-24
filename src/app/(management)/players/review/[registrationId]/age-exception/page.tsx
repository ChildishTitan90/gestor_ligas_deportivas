import Link from "next/link";
import { requireOperationalUser } from "@/server/auth/session";
import { readAgeExceptionForActor } from "@/features/players/server/age-exception-service";
import { readPlayerDossierForActor } from "@/features/players/server/document-queries";
import { AgeExceptionPanel } from "@/features/players/components/age-exception-panel";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { parsePlayerReviewFilters, playerReviewFilterQuery, playerReviewReturnHref } from "@/features/players/review-workspace";

export const metadata = { title: "Revisar excepción de edad" };
export default async function Page({ params, searchParams }: {
  params: Promise<{ registrationId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireOperationalUser(), { registrationId } = await params;
  await readAgeExceptionForActor(actor.id, registrationId);
  const dossier = await readPlayerDossierForActor(actor.id, registrationId);
  const query = await searchParams;
  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <ManagementPageHeader title="Revisar excepción de edad"
      description="Consulta la carta y el motivo antes de decidir sobre la excepción de este jugador."
      back={{href:playerReviewReturnHref(query),label:"Volver a revisiones"}}
      context={[{label:"Jugador",value:dossier.player.displayName},{label:"Equipo y categoría",value:[dossier.player.teamName,dossier.player.categoryName].filter(Boolean).join(" · ")},{label:"Club",value:dossier.player.clubName},{label:"Temporada",value:dossier.player.seasonName}]} />
    <AgeExceptionPanel actorId={actor.id} registrationId={registrationId} showProgress />
    <Link href={`/players/review/${registrationId}/documents${playerReviewFilterQuery(parsePlayerReviewFilters(query))}`} className="inline-flex min-h-12 items-center underline">Consultar los demás documentos y requisitos</Link>
  </section>;
}
