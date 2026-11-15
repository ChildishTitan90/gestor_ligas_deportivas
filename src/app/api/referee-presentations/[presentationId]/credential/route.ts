import {requireOperationalUser,AuthAccessError} from "@/server/auth/session";
import {AuthorizationError} from "@/server/auth/authorization";
import {readCompetitionBody,competitionHeaders} from "@/features/competitions/server/http";
import {CompetitionError} from "@/features/competitions/server/configuration";
import {RefereeError} from "@/features/referees/server/service";
import {createCredentialPreview} from "@/features/referees/server/presentation-credentials";
import {createRefereeCredentialStorage} from "@/features/referees/server/credential-storage";
import {PrivateDocumentStorageError} from "@/server/files/private-document-storage";
export async function POST(request:Request,{params}:{params:Promise<{presentationId:string}>}){
  try{const actor=await requireOperationalUser();await readCompetitionBody(request);const {presentationId}=await params;return Response.json(await createCredentialPreview(actor.id,presentationId,createRefereeCredentialStorage()),{headers:{...competitionHeaders,"Referrer-Policy":"no-referrer"}});}
  catch(e){if(e instanceof AuthAccessError||e instanceof AuthorizationError||e instanceof RefereeError||e instanceof CompetitionError||e instanceof PrivateDocumentStorageError)return Response.json({code:e.code},{status:e.status,headers:competitionHeaders});return Response.json({code:"SERVICE_UNAVAILABLE"},{status:503,headers:competitionHeaders});}
}
