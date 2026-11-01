import "server-only";
import {z} from "zod";
import {isCalendarDate} from "../identity-rules";
import type {PlayerDocumentPolicy} from "./document-service";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError} from "@/server/auth/authorization";

/** Decisión de Víctor: edad al registro y carga mientras INELIGIBLE. El fixture adicional solo existe en BD desechables. */
export async function getPlayerDocumentPolicy(registrationId?:string):Promise<PlayerDocumentPolicy|undefined> {
  if(process.env.AUTH_TEST_RUN!=="1" || !process.env.PLAYER_DOCUMENT_TEST_POLICY){
    if(!z.uuid().safeParse(registrationId).success)return undefined;
    const registration=await getPrisma().player_registrations.findUnique({where:{id:registrationId},select:{registered_at:true}});
    if(!registration)return undefined;
    return {referenceDate:new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(registration.registered_at),window:"PENDING_DOSSIER_V1"};
  }
  let target:URL;try{target=new URL(process.env.DATABASE_URL ?? "");}catch{return undefined;}
  if(!["localhost","127.0.0.1","[::1]"].includes(target.hostname) || !/^\/pdgld48_test_[a-f0-9]{16}$/.test(target.pathname))return undefined;
  try{
    const data=z.strictObject({referenceDate:z.string().refine(isCalendarDate),opensAt:z.iso.datetime(),closesAt:z.iso.datetime()}).parse(JSON.parse(process.env.PLAYER_DOCUMENT_TEST_POLICY));
    return {referenceDate:data.referenceDate,opensAt:new Date(data.opensAt),closesAt:new Date(data.closesAt)};
  }catch{return undefined;}
}
export async function getPlayerDocumentUploadPolicy(actorId:string,uploadId:string){
  if(!z.uuid().safeParse(uploadId).success)throw new AuthorizationError();
  const entry=await getPrisma().audit_logs.findUnique({where:{id:uploadId},select:{user_id:true,action:true,new_data:true}});
  if(!entry || entry.user_id!==actorId || entry.action!=="PLAYER_DOCUMENT_PREPARED")throw new AuthorizationError();
  return getPlayerDocumentPolicy((entry.new_data as {registrationId:string}).registrationId);
}
