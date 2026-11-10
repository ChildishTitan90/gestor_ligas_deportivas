import "server-only";
/** Contrato de servidor; no se proporciona un adaptador de red en esta entrega. */
export interface PrivatePlayerDocumentStorage { read(key:string,maxBytes:number,expectedMimeType?:string):Promise<Uint8Array>; }
export interface PlayerDocumentTransport extends PrivatePlayerDocumentStorage {
  put(key:string,object:{bytes:Uint8Array;mimeType:string}):Promise<{replayed:boolean}>;
  createDownloadUrl(key:string):Promise<{downloadUrl:string;expiresInSeconds:number}>;
}
export const PLAYER_DOCUMENT_BUCKET="expedientes-jugadores";
