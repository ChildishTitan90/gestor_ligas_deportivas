import "server-only";
import {createHash} from "node:crypto";
import type {Prisma} from "@prisma/client";
import {readPlayerPolicy} from "@/features/competitions/server/player-policy";
import {CompetitionError} from "@/features/competitions/server/configuration";
import {evaluatePlayerAge} from "@/features/competitions/player-policy";
import type {EligibilityAssessment,EligibilityBlocker} from "../category-participation";
import {playerIdentitySchema} from "../schemas";
import {minorAtDate} from "../document-rules";
import {adjacentBirthDates} from "../identity-rules";
import {lockPlayerTeamContext} from "./access";
import {personIdentitySelect,findPossibleIdentityMatches} from "./identity-matches";
import {hasCurrentIdentityResolution} from "./identity-resolution";
import {resolveCategoryDocuments,readCategoryDocumentState} from "./category-document-requirements";

export type PlayerTeamContext=Awaited<ReturnType<typeof lockPlayerTeamContext>>["row"];
export const eligibilityRegistrationSelect={id:true,person_id:true,season_team_id:true,status:true,withdrawn_at:true,registered_at:true,identity_review_status:true,people:{select:{...personIdentitySelect,curp:true,identity_version:true}}} satisfies Prisma.player_registrationsSelect;
export const eligibilityDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** El escritor autoriza primero contexto(s), luego bloquea fechas, inscripción y Persona. */
export async function lockEligibilityIdentity(tx:Prisma.TransactionClient,id:string){
  const initial=await tx.player_registrations.findUniqueOrThrow({where:{id},select:{people:{select:{birth_date:true}}}});
  if(initial.people.birth_date)for(const date of adjacentBirthDates(initial.people.birth_date.toISOString().slice(0,10)))await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:birth:${date}`},0))::text`;
  await tx.$queryRaw`SELECT pr.id FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id WHERE pr.id=${id}::uuid FOR UPDATE OF pr,p`;
}

/** Sin sesión, escrituras o proveedor: el consumidor ya autorizó cada contexto.
 * Puede evaluar documentos del destino sobre el único expediente del origen. */
export async function assessPlayerEligibility(tx:Prisma.TransactionClient,id:string,contexts:readonly PlayerTeamContext[],requireActiveOrigin=false):Promise<EligibilityAssessment>{
  const reg=await tx.player_registrations.findUniqueOrThrow({where:{id},select:eligibilityRegistrationSelect});
  const blockers:EligibilityBlocker[]=[];
  const block=(code:string,message:string,categoryId?:string)=>blockers.push({code,message,...(categoryId?{categoryId}:{})});
  if(reg.withdrawn_at || !["ACTIVE","INELIGIBLE"].includes(reg.status))block("ORIGIN_UNAVAILABLE","La inscripción de origen está suspendida o dada de baja.");
  if(requireActiveOrigin && reg.status!=="ACTIVE")block("ORIGIN_NOT_ACTIVE","Primero debe habilitarse la inscripción de origen.");
  const dob=reg.people.birth_date?.toISOString().slice(0,10) ?? "";
  const referenceDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(reg.registered_at);
  const minor=minorAtDate(dob || null,referenceDate);
  const raw={curp:reg.people.curp,firstName:reg.people.first_name,paternalSurname:reg.people.paternal_surname,maternalSurname:reg.people.maternal_surname ?? "",birthDate:dob};
  const identity=playerIdentitySchema.safeParse(raw);
  const check=await tx.player_curp_checks.findFirst({where:{person_id:reg.person_id},orderBy:[{created_at:"desc"},{id:"desc"}],select:{id:true,status:true,identity_version:true,fingerprint:true}});
  if(!identity.success || !check || check.status!=="VERIFIED" || check.identity_version!==reg.people.identity_version || check.fingerprint!==eligibilityDigest([reg.people.identity_version,raw]))block("CURP_NOT_VERIFIED","La CURP debe estar verificada y coincidir con los datos vigentes.");
  const matches=identity.success?await findPossibleIdentityMatches(tx,identity.data,reg.person_id):[];
  const resolution=matches.length>0 || reg.identity_review_status==="REQUIRED" ? await hasCurrentIdentityResolution(tx,id,reg.person_id,matches):true;
  if(!resolution)block("IDENTITY_REVIEW_REQUIRED","Hay posibles coincidencias de identidad sin una resolución vigente.");
  const candidates=matches.length?await tx.people.findMany({where:{id:{in:matches}},select:{id:true,identity_version:true},orderBy:{id:"asc"}}):[];
  const categoryEvidence:unknown[]=[];
  for(const context of contexts){
    if(context.teamStatus==="WITHDRAWN" || context.seasonStatus==="CLOSED" || context.affiliationStatus!=="APPROVED" || (!context.categoryAuthorized || !context.operational))block("CONTEXT_NOT_AVAILABLE","El equipo, la afiliación o la temporada no permiten esta participación.",context.seasonCategoryId);
    try{const policy=await readPlayerPolicy(tx,context.seasonId,context.seasonCategoryId);if(evaluatePlayerAge(policy,dob).status!=="ORDINARY_RANGE")block("AGE_REQUIRES_REVIEW","La edad no cumple el rango ordinario; una excepción necesita su proceso de autorización.",context.seasonCategoryId);}
    catch(error){if(!(error instanceof CompetitionError))throw error;block("PLAYER_POLICY_PENDING","Falta completar la política deportiva de la categoría.",context.seasonCategoryId);}
    const documents=await resolveCategoryDocuments(tx,context.seasonCategoryId,minor);
    const state=await readCategoryDocumentState(tx,id,reg.people.identity_version,documents);
    if(!documents.approved)block("DOCUMENT_POLICY_PENDING","La política documental tiene decisiones pendientes o no está aprobada.",context.seasonCategoryId);
    for(const group of state.groups.filter(g=>g.requiredForEligibility && !g.ready))block(`DOCUMENT_${group.key}`,group.key==="GUARDIAN_CONSENT"?"Falta acreditar la autorización del tutor.":group.key==="SCHOOL_EVIDENCE"?"Falta aprobar una credencial escolar o constancia de estudios.":"Faltan documentos obligatorios aprobados para esta categoría.",context.seasonCategoryId);
    categoryEvidence.push([{seasonTeamId:context.seasonTeamId,seasonId:context.seasonId,clubId:context.clubId,categoryId:context.seasonCategoryId,available:context.teamStatus!=="WITHDRAWN" && context.seasonStatus!=="CLOSED" && context.affiliationStatus==="APPROVED" && (context.categoryAuthorized && context.operational)},documents.fingerprint,state.groups.filter(g=>g.requiredForEligibility).map(g=>[g.key,g.quantity,g.ready,g.verificationId,state.documents.filter(d=>g.typeIds.includes(d.document_type_id) && state.confirmed.has(d.id) && d.status==="VALIDATED").map(d=>d.id)])]);
  }
  if(contexts.length>1){
    const [origin,target]=contexts;
    const levels=await tx.player_category_levels.findMany({where:{season_category_id:{in:[origin.seasonCategoryId,target.seasonCategoryId]}},select:{season_category_id:true,pathway_code:true,level:true}});
    const from=levels.find(l=>l.season_category_id===origin.seasonCategoryId),to=levels.find(l=>l.season_category_id===target.seasonCategoryId);
    if(origin.clubId!==target.clubId || origin.seasonId!==target.seasonId || !from || !to || from.pathway_code!==to.pathway_code || to.level!==from.level+1)block("SUPERIOR_CATEGORY_REQUIRED","El destino debe ser la categoría siguiente del orden autorizado, dentro del mismo club y torneo.");
  }
  const [clock]=await tx.$queryRaw<{now:Date}[]>`SELECT sports_management.player_participation_now() AS now`;
  const sanctions=await tx.sanctions.findMany({where:{blocks_participation:true,starts_at:{lte:clock.now},AND:[{OR:[{ends_at:null},{ends_at:{gt:clock.now}}]},{OR:[{player_registrations:{person_id:reg.person_id}},{season_team_id:{in:contexts.map(c=>c.seasonTeamId)}}]}]},select:{id:true},orderBy:{id:"asc"}});
  if(sanctions.length)block("PARTICIPATION_BLOCKED","Hay una sanción vigente que impide la participación.");
  return {ready:!blockers.length,blockers,fingerprint:eligibilityDigest([id,reg.people.identity_version,reg.status,reg.withdrawn_at,check?.id,check?.status,check?.fingerprint,candidates,resolution,categoryEvidence,sanctions])};
}
