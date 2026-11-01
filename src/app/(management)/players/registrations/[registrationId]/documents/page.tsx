import Link from "next/link";
import {redirect} from "next/navigation";
import {AuthAccessError,requireOperationalUser} from "@/server/auth/session";
import {readPlayerDossierForActor} from "@/features/players/server/document-queries";
import {PlayerDossier} from "@/features/players/components/player-dossier";
import {IneVerificationPanel} from "@/features/players/components/ine-verification-panel";
import {readPlayerIneStatusForActor} from "@/features/players/server/ine-verification-service";
export const metadata={title:"Expediente documental del jugador"};
export default async function Page({params}:{params:Promise<{registrationId:string}>}){
  let data:Awaited<ReturnType<typeof readPlayerDossierForActor>>|undefined;let actorId="";
  try{const actor=await requireOperationalUser();actorId=actor.id;data=await readPlayerDossierForActor(actor.id,(await params).registrationId);}
  catch(error){if(error instanceof AuthAccessError)redirect(error.code==="PASSWORD_CHANGE_REQUIRED"?"/change-password":"/login");}
  const ine=data?await readPlayerIneStatusForActor(actorId,data.registrationId):null;
  return <section className="mx-auto w-full max-w-5xl space-y-6"><Link href="/players/registrations" className="underline">Volver a jugadores</Link><h1 className="text-2xl font-semibold text-primary">Expediente documental</h1>
    {data?<PlayerDossier key={`${actorId}:${data.registrationId}`} actorId={actorId} initial={data} storageConfigured={Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_STORAGE_SERVER_KEY && process.env.SUPABASE_PLAYER_DOCUMENTS_BUCKET==="expedientes-jugadores")}/>:<p role="alert">El expediente no está disponible o tu cuenta no tiene acceso.</p>}
    {ine && <IneVerificationPanel key={`${actorId}:${ine.registrationId}:ine`} actorId={actorId} initial={ine}/>}
  </section>;
}
