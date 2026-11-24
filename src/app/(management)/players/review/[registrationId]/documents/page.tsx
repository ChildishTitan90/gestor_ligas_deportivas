import {requireOperationalUser} from "@/server/auth/session";
import {readDocumentReviewForActor} from "@/features/players/server/document-review";
import {DocumentReviewForm} from "@/features/players/components/document-review-form";
import Link from "next/link";
import {ActionLink} from "@/components/ui/action-link";
import {readPlayerIneStatusForActor} from "@/features/players/server/ine-verification-service";
import {IneVerificationPanel} from "@/features/players/components/ine-verification-panel";
import {ManagementPageHeader} from "@/components/layout/management-page-header";
import {playerReviewReturnHref} from "@/features/players/review-workspace";

export default async function Page({params,searchParams}:{
  params:Promise<{registrationId:string}>;
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
  const actor=await requireOperationalUser();const data=await readDocumentReviewForActor(actor.id,(await params).registrationId);
  const ine=await readPlayerIneStatusForActor(actor.id,data.registrationId);
  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <ManagementPageHeader title="Revisión del expediente"
      description="Revisa los archivos vigentes y registra la decisión de cada documento."
      back={{href:playerReviewReturnHref(await searchParams),label:"Volver a revisiones"}}
      context={[{label:"Jugador",value:data.player.name},{label:"Equipo y categoría",value:`${data.player.team} · ${data.player.category}`},{label:"Club",value:data.player.club},{label:"Temporada",value:data.player.season}]} />
    <Link className="inline-flex min-h-12 items-center underline" href={`/players/registrations/${data.registrationId}/identity-corrections`}>Solicitar o revisar corrección de identidad</Link>
    <DocumentReviewForm actorId={actor.id} initial={data}/>
    {ine.applicable && <IneVerificationPanel actorId={actor.id} initial={ine} readOnly/>}
    <aside className="space-y-3 rounded-xl border border-border bg-surface p-5" aria-label="Participación deportiva"><h2 className="font-semibold">Después de revisar los documentos</h2><p className="text-sm leading-6 text-muted">La revisión de archivos y la habilitación deportiva se consultan por separado. Comprueba los pendientes del jugador antes de autorizar su participación.</p><ActionLink variant="secondary" href={`/players/registrations/${data.registrationId}/participations#origin-eligibility`}>Ver estado deportivo y pendientes</ActionLink></aside>
  </section>;
}
