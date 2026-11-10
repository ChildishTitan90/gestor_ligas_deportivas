import "server-only";
import {createHash} from "node:crypto";
import {requireOperationalUser} from "@/server/auth/session";
import {AuthorizationError} from "@/server/auth/authorization";
import {registerPlayerForActor} from "./service";
import {readPlayerCurpStatusForActor,verifyPlayerCurpForActor} from "./curp-verification-service";
import {CurpVerificationError} from "./curp-check-record";

/** El POST humano de alta autoriza una consulta inicial; lecturas y renders nunca la ejecutan. */
export async function registerAndVerifyPlayer(input:unknown,expectedActorId?:string){
  const actor=await requireOperationalUser();
  if(expectedActorId && actor.id!==expectedActorId.toLowerCase())throw new AuthorizationError();
  return registerAndVerifyPlayerForActor(actor.id,input);
}
export async function registerAndVerifyPlayerForActor(actorId:string,input:unknown,dependencies?:Parameters<typeof verifyPlayerCurpForActor>[3]){
  const registration=await registerPlayerForActor(actorId,input);
  if (registration.ageExceptionPending) return { ...registration, curpVerification: "NOT_PERFORMED" };
  const current=await readPlayerCurpStatusForActor(actorId,registration.registrationId);
  const h=createHash("sha256").update(JSON.stringify(["registration-curp:v1",actorId,registration.registrationId,current.identityVersion])).digest("hex");
  const operationKey=`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
  try{
    // Sin retryOf: el servicio recupera cualquier intento existente, incluso incierto,
    // y jamás lo convierte en una segunda consulta por reenviar el registro.
    const curp=await verifyPlayerCurpForActor(actorId,registration.registrationId,{operationKey,identityVersion:current.identityVersion,confirmCharge:true},dependencies);
    return {...registration,externalVerification:curp.status,status:curp.registrationStatus ?? registration.status,identityReviewStatus:curp.identityReviewStatus ?? registration.identityReviewStatus,curpVerification:curp.status};
  }catch(error){
    if(!(error instanceof CurpVerificationError))throw error;
    // El alta ya se confirmó. Un fallo de verificación no debe presentarse como alta perdida.
    return {...registration,curpVerification:error.code==="USAGE_LIMIT_REACHED"?"USAGE_LIMIT_REACHED":"CHECK_UNCONFIRMED"};
  }
}
