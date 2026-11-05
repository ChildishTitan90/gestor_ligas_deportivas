import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import type {Prisma} from "@prisma/client";
import {getPrisma} from "@/server/db/prisma";
import {requireOperationalUser} from "@/server/auth/session";
import {AuthorizationError} from "@/server/auth/authorization";
import {PRIVATE_FILE_MAX_BYTES,validatePrivateFileContent} from "@/server/files/private-file-validation";
import {lockPlayerTeamContext,assertPlayerRegistrationRead} from "./access";
import type {PrivatePlayerDocumentStorage,PlayerDocumentTransport} from "./document-storage";
import {isCalendarDate} from "../identity-rules";
import {canCompleteActivatedDossier} from "./automatic-activation";
import {resolveRegistrationDocuments} from "./registration-document-requirements";
import {documentCodes} from "@/features/competitions/document-policy";

export class PlayerDocumentError extends Error {
  constructor(public readonly code:"INVALID_DOCUMENT"|"CONFIGURATION_REQUIRED"|"CONTEXT_UNAVAILABLE"|"UPLOAD_CONFLICT"|"STORAGE_UNCONFIRMED"|"UPLOAD_EXPIRED",public readonly status=409){super(code);}
}
const inputSchema=z.strictObject({operationKey:z.uuid(),registrationId:z.uuid(),requirementId:z.uuid(),slot:z.number().int().min(1),
  replacesDocumentId:z.uuid().nullable(),mimeType:z.enum(["image/png","image/jpeg","application/pdf"]),
  sizeBytes:z.number().int().positive().max(PRIVATE_FILE_MAX_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
type UploadInput=z.infer<typeof inputSchema>;
type Intent=UploadInput & {actorId:string;fileId:string;requirementHash:string;expiresAt:number};
/** Política validada proporcionada exclusivamente por el servidor, sin valores por defecto. */
export type PlayerDocumentPolicy={referenceDate:string}&({window:"PENDING_DOSSIER_V1"}|{opensAt:Date;closesAt:Date});
function digest(value:unknown){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function operationId(actorId:string,key:string){const h=digest(["player-document:v1",actorId,key]);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
async function authorize(tx:Prisma.TransactionClient,actorId:string,input:UploadInput,policy?:PlayerDocumentPolicy){
  let reg=await tx.player_registrations.findUnique({where:{id:input.registrationId},select:{season_team_id:true,status:true,withdrawn_at:true,registered_at:true,people:{select:{birth_date:true,identity_version:true}}}});
  if(!reg)throw new AuthorizationError();
  const {row}=await lockPlayerTeamContext(tx,actorId,reg.season_team_id,"UPDATE");
  await assertPlayerRegistrationRead(tx,actorId,input.registrationId,reg.season_team_id);
  await tx.$queryRaw`SELECT pr.id FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id WHERE pr.id=${input.registrationId}::uuid FOR SHARE OF pr,p`;
  reg=await tx.player_registrations.findUniqueOrThrow({where:{id:input.registrationId},select:{season_team_id:true,status:true,withdrawn_at:true,registered_at:true,people:{select:{birth_date:true,identity_version:true}}}});
  if(!policy || !isCalendarDate(policy.referenceDate) || !reg.people.birth_date)throw new PlayerDocumentError("CONFIGURATION_REQUIRED");
  if("window" in policy && policy.referenceDate!==new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(reg.registered_at))throw new PlayerDocumentError("UPLOAD_CONFLICT");
  const now=Date.now();
  const windowOpen="window" in policy || (Number.isFinite(policy.opensAt.getTime()) && Number.isFinite(policy.closesAt.getTime()) && now>=policy.opensAt.getTime() && now<=policy.closesAt.getTime());
  const birthDate=reg.people.birth_date.toISOString().slice(0,10);
  const minorAge=Number(policy.referenceDate.slice(0,4))-Number(birthDate.slice(0,4))-Number(policy.referenceDate.slice(5)<birthDate.slice(5));
  const minorFlow=minorAge>=0 && minorAge<18;
  const {combined:resolved}=await resolveRegistrationDocuments(tx,actorId,input.registrationId,row,minorFlow,"UPDATE");
  const completingActive=reg.status==="ACTIVE" && await canCompleteActivatedDossier(tx,input.registrationId,reg.people.identity_version,resolved);
  if(!windowOpen || reg.withdrawn_at || (reg.status!=="INELIGIBLE" && !completingActive) || row.seasonStatus==="CLOSED" || row.teamStatus==="WITHDRAWN" || row.affiliationStatus!=="APPROVED" || (!row.categoryAuthorized || !row.operational))throw new PlayerDocumentError("CONTEXT_UNAVAILABLE");
  await tx.$queryRaw`SELECT id FROM sports_management.document_requirements WHERE id=${input.requirementId}::uuid FOR SHARE`;
  const legacyRequirement=await tx.document_requirements.findUnique({where:{id:input.requirementId},select:{season_category_id:true,document_type_id:true,quantity:true,is_required:true,document_types:{select:{code:true}}}});
  const requirement=resolved.requirements.find(r=>r.id===input.requirementId);
  if(!requirement || requirement.season_category_id!==row.seasonCategoryId || input.slot>requirement.quantity)throw new PlayerDocumentError("INVALID_DOCUMENT",400);
  await tx.$queryRaw`SELECT id FROM sports_management.document_types WHERE id=${requirement.document_type_id}::uuid FOR SHARE`;
  const code=requirement.document_types.code;
  if(completingActive && !resolved.fingerprint && !["CURP","PHOTO"].includes(code))throw new PlayerDocumentError("CONTEXT_UNAVAILABLE");
  if(!(documentCodes as readonly string[]).includes(code))throw new PlayerDocumentError("CONFIGURATION_REQUIRED");
  if(code==="PHOTO" && (requirement.is_required || requirement.quantity!==1))throw new PlayerDocumentError("CONFIGURATION_REQUIRED");
  if(code==="PHOTO" && !["image/png","image/jpeg"].includes(input.mimeType))throw new PlayerDocumentError("INVALID_DOCUMENT",400);
  const dob=reg.people.birth_date.toISOString().slice(0,10);
  const age=Number(policy.referenceDate.slice(0,4))-Number(dob.slice(0,4))-Number(policy.referenceDate.slice(5)<dob.slice(5));
  if(!Number.isFinite(age) || age<0 || (["STUDENT_ID","STUDENT_CERTIFICATE","GUARDIAN_CONSENT"].includes(code) && !minorFlow))throw new PlayerDocumentError("CONFIGURATION_REQUIRED");
  const windowVersion="window" in policy?policy.window:[policy.opensAt.toISOString(),policy.closesAt.toISOString()];
  // Conservar el contrato de intenciones existentes.
  const requirementHash=digest([resolved.fingerprint?requirement:(legacyRequirement ?? requirement),policy.referenceDate,windowVersion,dob,reg.people.identity_version,...(resolved.fingerprint?[resolved.fingerprint]:[])]);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`document-slot:${input.registrationId}:${input.requirementId}:${input.slot}`},0))::text`;
  return {row,requirement,requirementHash,identityVersion:reg.people.identity_version};
}
async function currentSlot(tx:Prisma.TransactionClient,input:UploadInput){
  const events=await tx.audit_logs.findMany({where:{entity_id:input.registrationId,action:"PLAYER_DOCUMENT_CONFIRMED"},select:{new_data:true}});
  const revisions=events.map(e=>e.new_data as {requirementId:string;slot:number;documentId:string;replacesDocumentId:string|null;fileId:string});
  const slot=revisions.filter(r=>r.requirementId===input.requirementId && r.slot===input.slot);
  const replaced=new Set(slot.map(r=>r.replacesDocumentId));
  return slot.find(r=>!replaced.has(r.documentId)) ?? null;
}
export async function preparePlayerDocumentForActor(actorId:string,input:unknown,policy?:PlayerDocumentPolicy){
  const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new PlayerDocumentError("INVALID_DOCUMENT",400);
  const data=parsed.data;
  return getPrisma().$transaction(async tx=>{
    const context=await authorize(tx,actorId,data,policy);
    const id=operationId(actorId,data.operationKey);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`document-intent:${id}`},0))::text`;
    const prior=await tx.audit_logs.findUnique({where:{id},select:{user_id:true,action:true,new_data:true}});
    if(prior){const intent=prior.new_data as unknown as Intent;
      if(prior.user_id!==actorId || prior.action!=="PLAYER_DOCUMENT_PREPARED" || digest(data)!==digest(inputSchema.parse(Object.fromEntries(Object.keys(data).map(k=>[k,intent[k as keyof Intent]])))))throw new PlayerDocumentError("UPLOAD_CONFLICT");
      return {uploadId:id,expiresAt:intent.expiresAt,storageConfigured:false as const};}
    const current=await currentSlot(tx,data);
    if((current?.documentId ?? null)!==data.replacesDocumentId)throw new PlayerDocumentError("UPLOAD_CONFLICT");
    const receipts=await tx.audit_logs.findMany({where:{entity_id:data.registrationId,action:"PLAYER_DOCUMENT_CONFIRMED"},select:{new_data:true}});
    const known=receipts.map(r=>(r.new_data as {documentId:string}).documentId);
    const legacy=await tx.player_documents.count({where:{registration_id:data.registrationId,document_type_id:context.requirement.document_type_id,id:{notIn:known}}});
    if(legacy)throw new PlayerDocumentError("CONFIGURATION_REQUIRED");
    const fileId=randomUUID();
    const intent:Intent={...data,actorId,fileId,
      requirementHash:context.requirementHash,expiresAt:Date.now()+15*60_000};
    await tx.audit_logs.create({data:{id,user_id:actorId,action:"PLAYER_DOCUMENT_PREPARED",table_name:"player_documents",entity_id:data.registrationId,
      reason:"PDGLD-100: intención de carga documental privada",new_data:JSON.parse(JSON.stringify(intent))}});
    return {uploadId:id,expiresAt:intent.expiresAt,storageConfigured:false as const};
  },{timeout:15000});
}
export async function preparePlayerDocument(input:unknown){return preparePlayerDocumentForActor((await requireOperationalUser()).id,input);}
/** Recupera el acuse sin volver a leer/subir el objeto ni efectuar escrituras. */
export async function readPlayerDocumentUploadForActor(actorId:string,uploadId:string){
  if(!z.uuid().safeParse(uploadId).success)throw new AuthorizationError();
  return getPrisma().$transaction(async tx=>{
    const entry=await tx.audit_logs.findUnique({where:{id:uploadId},select:{user_id:true,action:true,new_data:true}});
    if(!entry || entry.user_id!==actorId || entry.action!=="PLAYER_DOCUMENT_PREPARED")throw new AuthorizationError();
    const intent=entry.new_data as unknown as Intent;
    const registration=await tx.player_registrations.findUnique({where:{id:intent.registrationId},select:{season_team_id:true}});
    if(!registration)throw new AuthorizationError();
    await assertPlayerRegistrationRead(tx,actorId,intent.registrationId,registration.season_team_id);
    const receipt=await tx.player_documents.findFirst({where:{registration_id:intent.registrationId,file_id:intent.fileId},select:{id:true}});
    return {uploadId,documentId:receipt?.id ?? null,state:receipt?"CONFIRMED" as const:intent.expiresAt<Date.now()?"EXPIRED_UNCONFIRMED" as const:"PENDING_STORAGE" as const};
  });
}
export async function getPlayerDocumentUploadStatus(uploadId:string){return readPlayerDocumentUploadForActor((await requireOperationalUser()).id,uploadId);}
/** Transporte inyectado por el servidor. La UI no puede proporcionar un transporte. */
async function authorizedIntent(tx:Prisma.TransactionClient,actorId:string,uploadId:string,policy?:PlayerDocumentPolicy){
    if(!z.uuid().safeParse(uploadId).success)throw new AuthorizationError();
    const entry=await tx.audit_logs.findUnique({where:{id:uploadId},select:{user_id:true,action:true,new_data:true}});
    if(!entry || entry.user_id!==actorId || entry.action!=="PLAYER_DOCUMENT_PREPARED")throw new AuthorizationError();
    const intent=entry.new_data as unknown as Intent;
    const input=inputSchema.parse(Object.fromEntries(Object.keys(inputSchema.shape).map(k=>[k,intent[k as keyof Intent]])));
    const context=await authorize(tx,actorId,input,policy);
    if(context.requirementHash!==intent.requirementHash)throw new PlayerDocumentError("UPLOAD_CONFLICT");
    const existing=await tx.player_documents.findFirst({where:{registration_id:intent.registrationId,file_id:intent.fileId},select:{id:true}});
    return {intent,context,existing};
}
function storageKey(data:Awaited<ReturnType<typeof authorizedIntent>>){return `player-documents/v1/${data.context.row.leagueId}/${data.context.row.seasonId}/${data.intent.registrationId}/${data.intent.requirementId}/${data.intent.fileId}`;}
export async function authorizePlayerDocumentUploadForActor(actorId:string,uploadId:string,policy?:PlayerDocumentPolicy){
  return getPrisma().$transaction(async tx=>{
    const data=await authorizedIntent(tx,actorId,uploadId,policy);
    if(!data.existing && data.intent.expiresAt<Date.now())throw new PlayerDocumentError("UPLOAD_EXPIRED");
    const current=await currentSlot(tx,data.intent);
    if(!data.existing && (current?.documentId ?? null)!==data.intent.replacesDocumentId)throw new PlayerDocumentError("UPLOAD_CONFLICT");
    return {...data.intent,objectKey:storageKey(data),documentId:data.existing?.id ?? null};
  },{timeout:15000});
}
export async function uploadPlayerDocumentForActor(actorId:string,uploadId:string,bytes:Uint8Array,mimeType:string,storage:PlayerDocumentTransport,policy?:PlayerDocumentPolicy){
  const intent=await authorizePlayerDocumentUploadForActor(actorId,uploadId,policy);
  const file=await validatePrivateFileContent(bytes,mimeType);
  if(file.mimeType!==intent.mimeType || file.sizeBytes!==intent.sizeBytes || file.sha256!==intent.sha256)throw new PlayerDocumentError("UPLOAD_CONFLICT");
  if(intent.documentId)return {stored:true,replayed:true};
  const result=await storage.put(intent.objectKey,file);
  // Detectar revocación o cambio de contexto durante la red. El objeto queda sin confirmar.
  await authorizePlayerDocumentUploadForActor(actorId,uploadId,policy);
  return {stored:true,replayed:result.replayed};
}
export async function confirmPlayerDocumentForActor(actorId:string,uploadId:string,storage:PrivatePlayerDocumentStorage,policy?:PlayerDocumentPolicy){
  const db=getPrisma();
  const getIntent=(tx:Prisma.TransactionClient)=>authorizedIntent(tx,actorId,uploadId,policy);
  const first=await db.$transaction(getIntent,{timeout:15000});
  if(first.existing)return {documentId:first.existing.id,replayed:true};
  if(first.intent.expiresAt<Date.now())throw new PlayerDocumentError("UPLOAD_EXPIRED");
  let bytes:Uint8Array;
  const objectKey=storageKey(first);
  try{bytes=await storage.read(objectKey,PRIVATE_FILE_MAX_BYTES,first.intent.mimeType);}catch{throw new PlayerDocumentError("STORAGE_UNCONFIRMED",503);}
  const validated=await validatePrivateFileContent(bytes,first.intent.mimeType);
  if(validated.sizeBytes!==first.intent.sizeBytes || validated.sha256!==first.intent.sha256)throw new PlayerDocumentError("UPLOAD_CONFLICT");
  return db.$transaction(async tx=>{
    const {intent,context,existing}=await getIntent(tx);
    if(existing)return {documentId:existing.id,replayed:true};
    if(intent.expiresAt<Date.now())throw new PlayerDocumentError("UPLOAD_EXPIRED");
    const current=await currentSlot(tx,intent);
    if((current?.documentId ?? null)!==intent.replacesDocumentId)throw new PlayerDocumentError("UPLOAD_CONFLICT");
    await tx.files.create({data:{id:intent.fileId,storage_key:objectKey,original_name:"documento-jugador",mime_type:validated.mimeType,size_bytes:BigInt(validated.sizeBytes),sha256:validated.sha256,uploaded_by:actorId}});
    const document=await tx.player_documents.create({data:{registration_id:intent.registrationId,document_type_id:context.requirement.document_type_id,file_id:intent.fileId,status:"PENDING"},select:{id:true}});
    await tx.audit_logs.create({data:{user_id:actorId,action:"PLAYER_DOCUMENT_CONFIRMED",table_name:"player_documents",entity_id:intent.registrationId,
      reason:"PDGLD-100: archivo confirmado; pendiente de revisión documental",new_data:{requirementId:intent.requirementId,slot:intent.slot,documentId:document.id,fileId:intent.fileId,replacesDocumentId:intent.replacesDocumentId,identityVersion:context.identityVersion}}});
    return {documentId:document.id,replayed:false};
  },{timeout:15000});
}
