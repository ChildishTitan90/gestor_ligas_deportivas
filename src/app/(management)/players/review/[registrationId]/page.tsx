import {getIdentityReviewDetail} from "@/features/players/server/identity-review";
import {requireOperationalUser} from "@/server/auth/session";
import {IdentityReviewForm} from "@/features/players/components/identity-review-form";
import {ManagementPageHeader} from "@/components/layout/management-page-header";
import {parsePlayerReviewFilters, playerReviewFilterQuery, playerReviewReturnHref} from "@/features/players/review-workspace";

export default async function Page({params,searchParams}:{
  params:Promise<{registrationId:string}>;
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}){
  const actor=await requireOperationalUser();const data=await getIdentityReviewDetail((await params).registrationId);
  const query = await searchParams;
  return <section className="mx-auto max-w-4xl space-y-6">
    <ManagementPageHeader title="Revisar identidad"
      description="Compara las posibles coincidencias antes de registrar una decisión sobre la identidad."
      back={{href:playerReviewReturnHref(query),label:"Volver a revisiones"}}
      context={[{label:"Jugador",value:data.name},{label:"Nacimiento",value:data.birthDate},{label:"Estado",value:data.pending?"Revisión pendiente":"Decisión previa registrada"}]} />
    <section className="space-y-3" aria-labelledby="identity-candidates-heading">
      <h2 id="identity-candidates-heading" className="text-lg font-semibold text-primary">Posibles coincidencias autorizadas</h2>
      {data.candidates.length ? <ul className="divide-y divide-border rounded-xl border border-border bg-surface">{data.candidates.map((candidate,i)=><li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3" key={i}><span className="wrap-anywhere font-medium">{candidate.name}</span><span className="text-sm text-muted">{candidate.birthDate}</span></li>)}</ul>
        : <p className="text-sm text-muted">No hay coincidencias visibles en este expediente.</p>}
    </section>
    <IdentityReviewForm key={data.fingerprint} actorId={actor.id} id={data.registrationId} fingerprint={data.fingerprint} blocked={data.outsideScope}
      refreshHref={`/players/review/${data.registrationId}${playerReviewFilterQuery(parsePlayerReviewFilters(query))}`} />
  </section>;
}
