import "server-only";
import {createSupabasePrivateDocumentStorage} from "@/server/files/private-document-storage";
export const REFEREE_CREDENTIAL_BUCKET="acreditaciones-arbitros";
export function createRefereeCredentialStorage(environment:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch){
  return createSupabasePrivateDocumentStorage({bucket:REFEREE_CREDENTIAL_BUCKET,variable:"SUPABASE_REFEREE_CREDENTIALS_BUCKET",prefix:"referee-credentials",testFlag:"REFEREE_CREDENTIAL_STORAGE_REAL_TEST"},environment,fetcher);
}
