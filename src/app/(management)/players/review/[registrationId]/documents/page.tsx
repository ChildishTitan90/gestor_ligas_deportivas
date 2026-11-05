import {requireOperationalUser} from "@/server/auth/session";
import {readDocumentReviewForActor} from "@/features/players/server/document-review";
import {DocumentReviewForm} from "@/features/players/components/document-review-form";
import Link from "next/link";
import {ActionLink} from "@/components/ui/action-link";
import {readPlayerIneStatusForActor} from "@/features/players/server/ine-verification-service";
import {IneVerificationPanel} from "@/features/players/components/ine-verification-panel";
export default async function Page({params}:{params:Promise<{registrationId:string}>}){
  const actor=await requireOperationalUser();const data=await readDocumentReviewForActor(actor.id,(await params).registrationId);
  const ine=await readPlayerIneStatusForActor(actor.id,data.registrationId);
  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <Link className="inline-flex min-h-12 items-center underline" href="/players/review">Volver a revisiones</Link>
    <header className="space-y-3"><h1 className="text-balance text-2xl font-semibold text-primary">Revisión del expediente</h1><div className="rounded-xl border border-border bg-surface p-5"><h2 className="text-xl font-semibold">{data.player.name}</h2><p className="mt-2 text-muted">{data.player.team} · {data.player.category}</p><p className="mt-1 text-sm text-muted">{data.player.club} · {data.player.season}</p></div></header>
    <DocumentReviewForm actorId={actor.id} initial={data}/>
    {ine.applicable && <IneVerificationPanel actorId={actor.id} initial={ine} readOnly/>}
    <aside className="space-y-3 rounded-xl border border-border bg-surface p-5" aria-label="Participación deportiva"><h2 className="font-semibold">Después de revisar los documentos</h2><p className="text-sm leading-6 text-muted">La revisión de archivos y la habilitación deportiva se consultan por separado. Comprueba los pendientes del jugador antes de autorizar su participación.</p><ActionLink variant="secondary" href={`/players/registrations/${data.registrationId}/participations#origin-eligibility`}>Ver estado deportivo y pendientes</ActionLink></aside>
  </section>;
}
