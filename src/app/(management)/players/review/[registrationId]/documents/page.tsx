import {requireOperationalUser} from "@/server/auth/session";
import {readDocumentReviewForActor} from "@/features/players/server/document-review";
import {DocumentReviewForm} from "@/features/players/components/document-review-form";
import Link from "next/link";
export default async function Page({params}:{params:Promise<{registrationId:string}>}){
  const actor=await requireOperationalUser();const data=await readDocumentReviewForActor(actor.id,(await params).registrationId);
  return <section className="mx-auto max-w-4xl space-y-5"><Link className="underline" href="/players/review">Volver a revisiones</Link><Link className="primary-action inline-flex min-h-12 items-center rounded-xl px-5 py-3" href={`/players/registrations/${data.registrationId}/participations#origin-eligibility`}>Consultar habilitación del jugador</Link><h1 className="text-2xl font-semibold">Revisión del expediente y tutor</h1><DocumentReviewForm actorId={actor.id} initial={data}/></section>;
}
