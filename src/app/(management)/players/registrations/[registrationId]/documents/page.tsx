import {PlayerJerseyNumber} from "@/features/players/components/player-jersey-number";
import {readPlayerJerseyNumberForActor} from "@/features/players/server/jersey-number";
import Link from "next/link";
import {AgeExceptionPanel} from "@/features/players/components/age-exception-panel";
import {redirect} from "next/navigation";
import {AuthAccessError,requireOperationalUser} from "@/server/auth/session";
import {HistoricalDossierUnavailable,readPlayerDossierForActor} from "@/features/players/server/document-queries";
import {PlayerDossier} from "@/features/players/components/player-dossier";
import {IneVerificationPanel} from "@/features/players/components/ine-verification-panel";
import {readPlayerIneStatusForActor} from "@/features/players/server/ine-verification-service";
export const metadata={title:"Expediente documental del jugador"};
export default async function Page({params}:{params:Promise<{registrationId:string}>}){
  const {registrationId}=await params;
  let data:Awaited<ReturnType<typeof readPlayerDossierForActor>>|undefined;let actorId="";let historicalName:string|undefined;let historicalFacts:HistoricalDossierUnavailable["facts"];
  try{const actor=await requireOperationalUser();actorId=actor.id;data=await readPlayerDossierForActor(actor.id,registrationId);}
  catch(error){if(error instanceof AuthAccessError)redirect(error.code==="PASSWORD_CHANGE_REQUIRED"?"/change-password":"/login");if(error instanceof HistoricalDossierUnavailable){historicalName=error.displayName;historicalFacts=error.facts;}}
  const jersey=(data || historicalName)?await readPlayerJerseyNumberForActor(actorId,registrationId):null;
  const ine=data?await readPlayerIneStatusForActor(actorId,data.registrationId):null;
  return <section className="mx-auto w-full max-w-5xl space-y-6"><Link href="/players/registrations" className="underline">Volver a jugadores</Link><h1 className="text-2xl font-semibold text-primary">Expediente documental</h1>
    {data && <div className="space-y-2 rounded-xl border border-border bg-surface p-5" aria-label="Jugador del expediente">
      <p className="text-sm text-muted">Jugador</p><h2 className="break-words text-xl font-semibold text-primary">{data.player.displayName}</h2>
      <p className="break-words">Equipo: <strong>{data.player.teamName}</strong>{data.player.categoryName && <> · {data.player.categoryName}</>}</p>
      <p className="break-words text-sm text-muted">{data.player.clubName} · {data.player.seasonName}</p>
    </div>}
    {jersey && <PlayerJerseyNumber key={`${registrationId}:${jersey.jerseyNumber}`} actorId={actorId} registrationId={registrationId} initial={jersey}/>}
    {(data || historicalName) && <Link className="inline-flex min-h-12 items-center underline" href={`/players/registrations/${registrationId}/identity-corrections`}>Solicitar o revisar corrección de identidad</Link>}
    {data && <Link className="primary-action inline-flex min-h-12 items-center rounded-xl px-5 py-3 font-semibold" href={`/players/registrations/${data.registrationId}/participations`}>Consultar habilitación y participaciones</Link>}
    {data && <AgeExceptionPanel actorId={actorId} registrationId={data.registrationId}/>}
    {data?<PlayerDossier key={`${actorId}:${data.registrationId}`} actorId={actorId} initial={data} storageConfigured={Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_STORAGE_SERVER_KEY && process.env.SUPABASE_PLAYER_DOCUMENTS_BUCKET==="expedientes-jugadores")}/>:historicalName?<><h2>{historicalName}</h2><p>Nacimiento al cierre: {historicalFacts?.status==="CAPTURED" && historicalFacts.birthDate ? historicalFacts.birthDate : "Información histórica no disponible"}</p><p>Año de referencia al cierre: {historicalFacts?.status==="CAPTURED" && historicalFacts.referenceYear!==null ? historicalFacts.referenceYear : "Información histórica no disponible"}</p><p>Estado registrado al cierre: {historicalFacts?.status==="CAPTURED" ? historicalFacts.registrationStatus : "Información histórica no disponible"}</p><p>Habilitación y documentos: consulta histórica no acreditada; no se evalúan con la identidad vigente.</p>{historicalName!=="Información histórica no disponible" && <p>Información histórica no disponible</p>}</>:<p role="alert">El expediente no está disponible o tu cuenta no tiene acceso.</p>}
    {ine && <IneVerificationPanel key={`${actorId}:${ine.registrationId}:ine`} actorId={actorId} initial={ine}/>}
  </section>;
}
