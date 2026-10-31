import {getIdentityReviewQueue} from "@/features/players/server/identity-review";
export default async function Page(){
  const rows=await getIdentityReviewQueue();
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-semibold">Revisión de identidad</h1>
    <p>Posibles coincidencias pendientes dentro de tu alcance autorizado.</p>
    {!rows.length && <p role="status">No hay revisiones pendientes.</p>}
    <ul className="space-y-3">{rows.map(row=><li key={row.id} className="rounded-xl border border-border bg-surface p-4"><a className="font-semibold underline" href={`/players/review/${row.id}`}>{row.name}</a><p>{row.team} · Revisión pendiente</p></li>)}</ul>
  </section>;
}
