import {getIdentityReviewDetail} from "@/features/players/server/identity-review";
import {requireOperationalUser} from "@/server/auth/session";
import {IdentityReviewForm} from "@/features/players/components/identity-review-form";
import Link from "next/link";
export default async function Page({params}:{params:Promise<{registrationId:string}>}){
  const actor=await requireOperationalUser();const data=await getIdentityReviewDetail((await params).registrationId);
  return <section className="mx-auto max-w-4xl space-y-6"><Link className="underline" href="/players/review">Volver a revisiones</Link><h1 className="text-2xl font-semibold">Revisar identidad</h1>
    <div className="rounded-xl border border-border bg-surface p-5"><h2 className="font-semibold">{data.name}</h2><p>Nacimiento: {data.birthDate}</p><p>{data.pending?"Revisión pendiente":"Decisión previa registrada"}</p></div>
    <h2 className="text-xl font-semibold">Posibles coincidencias autorizadas</h2>
    <ul className="space-y-3">{data.candidates.map((candidate,i)=><li className="rounded-xl border border-border p-4" key={i}>{candidate.name} · {candidate.birthDate}</li>)}</ul>
    {!data.candidates.length && <p>No hay coincidencias visibles en este expediente.</p>}
    <IdentityReviewForm actorId={actor.id} id={data.registrationId} fingerprint={data.fingerprint} blocked={data.outsideScope}/>
  </section>;
}
