import "server-only";
import {ageExceptionDocumentRequirement} from "./age-exception-record";
import {Prisma} from "@prisma/client";
import {AuthorizationError} from "@/server/auth/authorization";
import {lockPlayerTeamContext} from "./access";
import {resolveCategoryDocuments,type ResolvedDocuments} from "./category-document-requirements";
import {eligibilityDigest,type PlayerTeamContext} from "./eligibility-assessment";

/** Añade requisitos de destinos solicitados al único expediente del origen. */
export async function resolveRegistrationDocuments(tx:Prisma.TransactionClient,actorId:string,registrationId:string,origin:PlayerTeamContext,minor:boolean|null,action:"READ"|"UPDATE"="READ"){
  const source=await resolveCategoryDocuments(tx,origin.seasonCategoryId,minor);
  const scopes:{categoryId:string;participationId:string|null;policy:ResolvedDocuments}[]=[{categoryId:origin.seasonCategoryId,participationId:null,policy:source}];
  const participations=await tx.player_category_participations.findMany({where:{origin_registration_id:registrationId,status:{not:"WITHDRAWN"}},select:{id:true,target_season_team_id:true},orderBy:{id:"asc"}});
  for(const participation of participations){
    try{
      const {row:target}=await lockPlayerTeamContext(tx,actorId,participation.target_season_team_id,action);
      if(action==="UPDATE")await lockPlayerTeamContext(tx,actorId,participation.target_season_team_id,"READ");
      if(target.clubId!==origin.clubId || target.seasonId!==origin.seasonId)throw new AuthorizationError();
      scopes.push({categoryId:target.seasonCategoryId,participationId:participation.id,policy:await resolveCategoryDocuments(tx,target.seasonCategoryId,minor)});
    }catch(error){if(!(error instanceof AuthorizationError))throw error;}
  }
  const byType=new Map(source.requirements.map(row=>[row.document_type_id,{...row}]));
  for(const scope of scopes.slice(1))for(const row of scope.policy.requirements){
    const prior=byType.get(row.document_type_id);
    if(prior){prior.quantity=Math.max(prior.quantity,row.quantity);prior.is_required ||=row.is_required;}
    else byType.set(row.document_type_id,{...row,season_category_id:origin.seasonCategoryId});
  }
  const names=await tx.$queryRaw<{id:string;name:string}[]>(Prisma.sql`SELECT sc.id,c.name FROM sports_management.season_categories sc JOIN sports_management.categories c ON c.id=sc.category_id WHERE sc.id IN (${Prisma.join(scopes.map(s=>Prisma.sql`${s.categoryId}::uuid`))})`);
  const combined:ResolvedDocuments={...source,requirements:[...byType.values()],groups:scopes.flatMap(scope=>scope.policy.groups.map(group=>({...group,categoryName:names.find(n=>n.id===scope.categoryId)?.name,categoryId:scope.categoryId,scope:scope.participationId?"SUPERIOR" as const:"ORIGIN" as const}))),
    approved:scopes.every(scope=>scope.policy.approved),issues:[...new Set(scopes.flatMap(scope=>scope.policy.issues))],
    fingerprint:scopes.length===1?source.fingerprint:eligibilityDigest(scopes.map(scope=>[scope.categoryId,scope.participationId,scope.policy.fingerprint]))};
  const exception = await ageExceptionDocumentRequirement(tx,registrationId,origin.seasonCategoryId);
  if (exception) {
    combined.requirements.push(exception);
    combined.groups.push({key:"AGE_EXCEPTION_LETTER",typeIds:[exception.document_type_id],quantity:1,requiredForDossier:true,requiredForEligibility:true,scope:"ORIGIN",categoryId:origin.seasonCategoryId});
    combined.fingerprint=eligibilityDigest([combined.fingerprint,"AGE_EXCEPTION_LETTER",exception.id]);
  }
  return {source,combined,scopes};
}
