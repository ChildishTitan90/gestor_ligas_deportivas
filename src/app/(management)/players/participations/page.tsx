import {getPlayerParticipationDirectory} from "@/features/players/server/participation-workspace-queries";
import {PlayerParticipationDirectory} from "@/features/players/components/player-participation-directory";
export const metadata={title:"Participaciones superiores"};
export default async function Page(){return <section className="mx-auto w-full max-w-6xl"><PlayerParticipationDirectory data={await getPlayerParticipationDirectory()} /></section>;}
