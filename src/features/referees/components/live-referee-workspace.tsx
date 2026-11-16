"use client";
import {useRouter} from "next/navigation";
import type {LiveWorkspace} from "../server/queries";
import type {RefereeView} from "../types";
import {blockerMessages,refereeMutation} from "../contract";
import {RefereeWorkspace} from "./referee-workspace";
import {useRefereeOperation} from "./use-referee-operation";
export function LiveRefereeWorkspace({workspace,view,matchesHref}:{workspace:LiveWorkspace;view:RefereeView;matchesHref:string|null}){
 const router=useRouter();
 const operation=useRefereeOperation({actorId:workspace.actorId,endpoint:"/api/referees",storageNamespace:"refereeing-operation",schema:refereeMutation,base:{leagueId:workspace.leagueId,seasonId:workspace.seasonId},messages:blockerMessages});
 return <RefereeWorkspace initialData={workspace.data} view={view} matchesHref={matchesHref} live={{...workspace,...operation,onScopeChange(league,season){if(!operation.hasOperation)router.push(`/referees?view=${view}&league=${league}&season=${season}`);}}}/>;
}
