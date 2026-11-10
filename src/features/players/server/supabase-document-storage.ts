import "server-only";
import {createClient} from "@supabase/supabase-js";
import {z} from "zod";
import {PRIVATE_FILE_MAX_BYTES} from "@/server/files/private-file-validation";
import {PLAYER_DOCUMENT_BUCKET,type PlayerDocumentTransport} from "./document-storage";

export class PlayerDocumentStorageError extends Error {
  readonly code="STORAGE_UNAVAILABLE";readonly status=503;
  constructor(){super("STORAGE_UNAVAILABLE");}
}
const mimeTypes=["application/pdf","image/jpeg","image/png"];
function checkKey(key:string){const p=key.split("/");if(p.length!==7 || p[0]!=="player-documents" || p[1]!=="v1" || !p.slice(2).every(v=>z.uuid().safeParse(v).success))throw new PlayerDocumentStorageError();}
/** Pasar configuración/transportes es una capacidad exclusiva de servidor. Nunca devolver el cliente. */
export function createSupabasePlayerDocumentStorage(environment:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch):PlayerDocumentTransport {
  const rawUrl=environment.SUPABASE_URL,key=environment.SUPABASE_STORAGE_SERVER_KEY,bucketName=environment.SUPABASE_PLAYER_DOCUMENTS_BUCKET;
  if(!rawUrl || !key || /\s/.test(key) || bucketName!==PLAYER_DOCUMENT_BUCKET || (environment.AUTH_TEST_RUN==="1" && environment.PLAYER_DOCUMENT_STORAGE_REAL_TEST!=="1"))throw new PlayerDocumentStorageError();
  let url:URL;try{url=new URL(rawUrl);}catch{throw new PlayerDocumentStorageError();}
  if(url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash)throw new PlayerDocumentStorageError();
  const origin=url.origin;
  const boundedFetch:typeof fetch=(input,options)=>fetcher(input,{...options,redirect:"error",cache:"no-store",signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  const client=createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}});
  const bucket=client.storage.from(bucketName);
  async function checkBucket(){
    const {data,error}=await client.storage.getBucket(bucketName!);
    if(error || !data || data.public!==false || Number(data.file_size_limit)!==PRIVATE_FILE_MAX_BYTES || !Array.isArray(data.allowed_mime_types) || data.allowed_mime_types.length!==3 || !mimeTypes.every(m=>data.allowed_mime_types!.includes(m)))throw new PlayerDocumentStorageError();
  }
  async function read(keyPath:string,maxBytes:number,expectedMimeType?:string){
    checkKey(keyPath);await checkBucket();
    const response=await boundedFetch(`${origin}/storage/v1/object/${bucketName}/${keyPath}`,{headers:{apikey:key!,Authorization:`Bearer ${key}`}});
    const length=response.headers.get("content-length");
    const mime=response.headers.get("content-type")?.split(";")[0].trim();
    if(!response.ok || (length && Number(length)>Math.min(maxBytes,PRIVATE_FILE_MAX_BYTES)) || !mimeTypes.includes(mime ?? "") || (expectedMimeType && mime!==expectedMimeType)){await response.body?.cancel();throw new PlayerDocumentStorageError();}
    const reader=response.body?.getReader();if(!reader)throw new PlayerDocumentStorageError();
    let total=0;const chunks:Uint8Array[]=[];
    try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>Math.min(maxBytes,PRIVATE_FILE_MAX_BYTES)){await reader.cancel();throw new PlayerDocumentStorageError();}chunks.push(value);}}
    finally{reader.releaseLock();}
    if(!total)throw new PlayerDocumentStorageError();return new Uint8Array(Buffer.concat(chunks));
  }
  return {
    async read(path,max,mime){try{return await read(path,max,mime);}catch{throw new PlayerDocumentStorageError();}},
    async put(path,object){
      try{
        checkKey(path);if(!object.bytes.byteLength || object.bytes.byteLength>PRIVATE_FILE_MAX_BYTES || !mimeTypes.includes(object.mimeType))throw new PlayerDocumentStorageError();
        await checkBucket();
        const {error}=await bucket.upload(path,object.bytes,{contentType:object.mimeType,upsert:false,cacheControl:"0"});
        if(!error)return {replayed:false};
        // Una respuesta perdida o 409 solo se recupera si el objeto existente es idéntico.
        const previous=await read(path,PRIVATE_FILE_MAX_BYTES,object.mimeType);
        if(!Buffer.from(previous).equals(Buffer.from(object.bytes)))throw new PlayerDocumentStorageError();
        return {replayed:true};
      }catch{throw new PlayerDocumentStorageError();}
    },
    async createDownloadUrl(path){
      try{checkKey(path);await checkBucket();const {data,error}=await bucket.createSignedUrl(path,60,{download:true});
        if(error || !data?.signedUrl || new URL(data.signedUrl).origin!==origin)throw new PlayerDocumentStorageError();
        return {downloadUrl:data.signedUrl,expiresInSeconds:60};
      }catch{throw new PlayerDocumentStorageError();}
    },
  };
}
