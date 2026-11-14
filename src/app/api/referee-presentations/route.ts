import { requireOperationalUser,AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { readCompetitionBody,competitionHeaders } from "@/features/competitions/server/http";
import { CompetitionError } from "@/features/competitions/server/configuration";
import { RefereeError } from "@/features/referees/server/service";
import { mutatePresentation,recoverPresentation } from "@/features/referees/server/presentations";
import {mutatePresentationWithCredential} from "@/features/referees/server/presentation-credentials";
import {readCredentialMultipart} from "@/features/referees/server/presentation-credential-http";
import {createRefereeCredentialStorage} from "@/features/referees/server/credential-storage";
import {PrivateDocumentStorageError} from "@/server/files/private-document-storage";
import {BinaryFileValidationError} from "@/server/files/private-file-validation";
function failure(error:unknown){
  if(error instanceof AuthAccessError||error instanceof AuthorizationError||error instanceof RefereeError||error instanceof CompetitionError||error instanceof PrivateDocumentStorageError||error instanceof BinaryFileValidationError)return Response.json({code:error.code},{status:error.status,headers:competitionHeaders});
  console.error("[referee-presentations] REQUEST_FAILED");return Response.json({code:"SERVICE_UNAVAILABLE"},{status:503,headers:competitionHeaders});
}
export async function POST(request:Request){try{const actor=await requireOperationalUser();if(request.headers.get("content-type")?.startsWith("multipart/form-data;")){const {command,attachment}=await readCredentialMultipart(request,actor.id);return Response.json(await mutatePresentationWithCredential(actor.id,command,attachment,createRefereeCredentialStorage()),{headers:competitionHeaders});}return Response.json(await mutatePresentation(actor.id,await readCompetitionBody(request)),{headers:competitionHeaders});}catch(e){return failure(e);}}
export async function GET(request:Request){try{const actor=await requireOperationalUser();const key=new URL(request.url).searchParams.get("operationKey")??"";return Response.json({receipt:await recoverPresentation(actor.id,key)},{headers:competitionHeaders});}catch(e){return failure(e);}}
