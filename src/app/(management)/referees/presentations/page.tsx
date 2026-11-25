import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getPresentationWorkspace } from "@/features/referees/server/presentations";
import { RefereePresentations } from "@/features/referees/components/referee-presentations";
export const metadata={title:"Presentación de árbitros por club"};
export default async function Page(){
  let workspace;
  try{workspace=await getPresentationWorkspace();}catch(e){if(e instanceof AuthAccessError)redirect(e.code==="PASSWORD_CHANGE_REQUIRED"?"/change-password":"/login");if(e instanceof AuthorizationError)return <section role="alert"><h1 className="text-2xl font-semibold">Acceso denegado</h1><p>No tienes permiso contextual de presentación del club ni permiso de Comisión para revisar incorporaciones.</p></section>;throw e;}
  return <RefereePresentations key={workspace.actorId} workspace={workspace}/>;
}
