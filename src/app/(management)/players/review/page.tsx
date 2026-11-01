import {getIdentityReviewQueue} from "@/features/players/server/identity-review";
import {getIneReviewQueue} from "@/features/players/server/ine-verification-service";
export default async function Page(){
  const rows=await getIdentityReviewQueue();
  const ineRows=await getIneReviewQueue();
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-semibold">Revisión de identidad</h1>
    <p>Posibles coincidencias pendientes dentro de tu alcance autorizado.</p>
    {!rows.length && <p role="status">No hay coincidencias de identidad pendientes.</p>}
    <ul className="space-y-3">{rows.map(row=><li key={row.id} className="rounded-xl border border-border bg-surface p-4"><a className="font-semibold underline" href={`/players/review/${row.id}`}>{row.name}</a><p>{row.team} · Revisión pendiente</p></li>)}</ul>
    <h2 className="text-xl font-semibold">INE y selfie · Revisión administrativa</h2>
    <p>Consulta las evidencias y el acuse de casos con diferencias, datos incompletos o resultados inciertos. Las identidades verificadas automáticamente no requieren esta revisión. Esta bandeja no aprueba ni rechaza deportivamente al jugador.</p>
    {!ineRows.length && <p>No hay verificaciones de INE para revisar.</p>}
    <ul className="space-y-3">{ineRows.map(row=><li key={row.id} className="rounded-xl border border-border bg-surface p-4"><a className="font-semibold underline" href={`/players/registrations/${row.id}/documents`}>{row.team} · Ver expediente de verificación</a><p>{row.status==="ADMIN_REVIEW_REQUIRED"?"Fotos o datos requieren revisión administrativa":"Consulta sin resultado vigente: revisar acuse"}</p></li>)}</ul>
  </section>;
}
