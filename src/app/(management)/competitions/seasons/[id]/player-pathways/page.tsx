import {ActionLink} from "@/components/ui/action-link";
import {getPlayerConfigurationWorkspace} from "@/features/competitions/server/player-configuration-queries";
import {PlayerPathwayWorkspace} from "@/features/competitions/components/player-pathway-workspace";
export const metadata={title:"Categorías que permiten subir"};
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <section className="mx-auto w-full max-w-5xl space-y-6"><ActionLink href={`/competitions/seasons/${id}`} variant="secondary">Volver a la temporada</ActionLink><PlayerPathwayWorkspace data={await getPlayerConfigurationWorkspace(id)} /></section>;}
