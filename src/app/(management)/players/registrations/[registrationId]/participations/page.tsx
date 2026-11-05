import {getPlayerParticipationWorkspace} from "@/features/players/server/participation-workspace-queries";
import {PlayerParticipationWorkspace} from "@/features/players/components/player-participation-workspace";
export const metadata={title:"Participaciones del jugador"};
export default async function Page({params}:{params:Promise<{registrationId:string}>}){const {registrationId}=await params;return <section className="mx-auto w-full max-w-5xl"><PlayerParticipationWorkspace data={await getPlayerParticipationWorkspace(registrationId)} /></section>;}
