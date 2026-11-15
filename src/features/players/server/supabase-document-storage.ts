import "server-only";
import {createSupabasePrivateDocumentStorage} from "@/server/files/private-document-storage";
import {PLAYER_DOCUMENT_BUCKET,type PlayerDocumentTransport} from "./document-storage";
export {PrivateDocumentStorageError as PlayerDocumentStorageError} from "@/server/files/private-document-storage";
export function createSupabasePlayerDocumentStorage(environment:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch):PlayerDocumentTransport {
  return createSupabasePrivateDocumentStorage({bucket:PLAYER_DOCUMENT_BUCKET,variable:"SUPABASE_PLAYER_DOCUMENTS_BUCKET",prefix:"player-documents",testFlag:"PLAYER_DOCUMENT_STORAGE_REAL_TEST"},environment,fetcher);
}
