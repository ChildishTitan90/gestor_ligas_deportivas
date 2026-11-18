import "server-only";
import {createClient} from "@supabase/supabase-js";
import {z} from "zod";
import {PRIVATE_FILE_MAX_BYTES} from "./private-file-validation";

export interface PrivateDocumentTransport {
  read(key:string,maxBytes:number,expectedMimeType?:string):Promise<Uint8Array>;
  put(key:string,object:{bytes:Uint8Array;mimeType:string}):Promise<{replayed:boolean}>;
  createDownloadUrl(key:string):Promise<{downloadUrl:string;expiresInSeconds:number}>;
  remove?(key:string):Promise<void>;
}
export class PrivateDocumentStorageError extends Error {
  readonly code="STORAGE_UNAVAILABLE";readonly status=503;
  constructor(){super("STORAGE_UNAVAILABLE");}
}
type Configuration={bucket:string;variable:string;prefix:string;testFlag:string};
const mimeTypes=["application/pdf","image/jpeg","image/png"];
/** Configuración exclusiva del servidor. Ni bucket ni prefijo se reciben del navegador. */
export function createSupabasePrivateDocumentStorage(config:Configuration,environment:Record<string,string|undefined>=process.env,fetcher:typeof fetch=fetch):PrivateDocumentTransport {
  const rawUrl=environment.SUPABASE_URL,key=environment.SUPABASE_STORAGE_SERVER_KEY;
  if(!rawUrl || !key || /\s/.test(key) || environment[config.variable]!==config.bucket || (environment.AUTH_TEST_RUN==="1" && environment[config.testFlag]!=="1"))throw new PrivateDocumentStorageError();
  let url:URL;try{url=new URL(rawUrl);}catch{throw new PrivateDocumentStorageError();}
  if(url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash)throw new PrivateDocumentStorageError();
  const origin=url.origin;
  const boundedFetch:typeof fetch=(input,options)=>fetcher(input,{...options,redirect:"error",cache:"no-store",signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  const client=createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}});
  const bucket=client.storage.from(config.bucket);
  function checkKey(path:string){const p=path.split("/");if(p.length!==7 || p[0]!==config.prefix || p[1]!=="v1" || !p.slice(2).every(v=>z.uuid().safeParse(v).success))throw new PrivateDocumentStorageError();}
  async function checkBucket(){const {data,error}=await client.storage.getBucket(config.bucket);if(error || !data || data.public!==false || Number(data.file_size_limit)!==PRIVATE_FILE_MAX_BYTES || !Array.isArray(data.allowed_mime_types) || data.allowed_mime_types.length!==3 || !mimeTypes.every(m=>data.allowed_mime_types!.includes(m)))throw new PrivateDocumentStorageError();}
  async function read(path:string,maxBytes:number,expectedMimeType?:string){
    checkKey(path);await checkBucket();
    const response=await boundedFetch(`${origin}/storage/v1/object/${config.bucket}/${path}`,{headers:{apikey:key!,Authorization:`Bearer ${key}`}});
    const length=response.headers.get("content-length"),mime=response.headers.get("content-type")?.split(";")[0].trim();
    if(!response.ok || (length && Number(length)>Math.min(maxBytes,PRIVATE_FILE_MAX_BYTES)) || !mimeTypes.includes(mime ?? "") || (expectedMimeType && mime!==expectedMimeType)){await response.body?.cancel();throw new PrivateDocumentStorageError();}
    const reader=response.body?.getReader();if(!reader)throw new PrivateDocumentStorageError();let total=0;const chunks:Uint8Array[]=[];
    try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>Math.min(maxBytes,PRIVATE_FILE_MAX_BYTES)){await reader.cancel();throw new PrivateDocumentStorageError();}chunks.push(value);}}finally{reader.releaseLock();}
    if(!total)throw new PrivateDocumentStorageError();return new Uint8Array(Buffer.concat(chunks));
  }
  return {
    async read(path,max,mime){try{return await read(path,max,mime);}catch{throw new PrivateDocumentStorageError();}},
    async put(path,object){try{
      checkKey(path);if(!object.bytes.byteLength || object.bytes.byteLength>PRIVATE_FILE_MAX_BYTES || !mimeTypes.includes(object.mimeType))throw new PrivateDocumentStorageError();
      await checkBucket();const {error}=await bucket.upload(path,object.bytes,{contentType:object.mimeType,upsert:false,cacheControl:"0"});
      if(!error)return {replayed:false};
      const previous=await read(path,PRIVATE_FILE_MAX_BYTES,object.mimeType);if(!Buffer.from(previous).equals(Buffer.from(object.bytes)))throw new PrivateDocumentStorageError();return {replayed:true};
    }catch{throw new PrivateDocumentStorageError();}},
    async remove(path){try{checkKey(path);await checkBucket();const {error}=await bucket.remove([path]);if(error)throw error;}catch{throw new PrivateDocumentStorageError();}},
    async createDownloadUrl(path){try{checkKey(path);await checkBucket();const {data,error}=await bucket.createSignedUrl(path,60,{download:true});if(error || !data?.signedUrl || new URL(data.signedUrl).origin!==origin)throw new PrivateDocumentStorageError();return {downloadUrl:data.signedUrl,expiresInSeconds:60};}catch{throw new PrivateDocumentStorageError();}},
  };
}
