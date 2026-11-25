import {credentialMetadata,REFEREE_CREDENTIAL_MAX_BYTES,type CredentialMetadata} from "./presentation-contract";
import {RefereeRequestPreparationError} from "./components/use-referee-operation";
export async function describeCredential(file:File|null):Promise<CredentialMetadata>{
  if(!file)throw new RefereeRequestPreparationError("Selecciona la cédula arbitral. Si recuperas una solicitud, consulta primero su acuse y vuelve a seleccionar el mismo archivo para reintentar.");
  if(!file.size||file.size>REFEREE_CREDENTIAL_MAX_BYTES||!["application/pdf","image/jpeg","image/png"].includes(file.type))throw new RefereeRequestPreparationError("Selecciona un PDF, JPG o PNG de hasta 10 MB.");
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()))).map(b=>b.toString(16).padStart(2,"0")).join("");
  const parsed=credentialMetadata.safeParse({mimeType:file.type,sizeBytes:file.size,sha256});if(!parsed.success)throw new RefereeRequestPreparationError("Selecciona un PDF, JPG o PNG de hasta 10 MB.");return parsed.data;
}
export async function prepareCredentialRequest(payload:Record<string,unknown>,file:File|null):Promise<{headers:Record<string,string>;body:BodyInit}>{
  if(payload.kind!=="submit"&&payload.kind!=="credential")return {headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)};
  const actual=await describeCredential(file),expected=credentialMetadata.safeParse(payload.credential);
  if(!expected.success||actual.sha256!==expected.data.sha256||actual.sizeBytes!==expected.data.sizeBytes||actual.mimeType!==expected.data.mimeType)throw new RefereeRequestPreparationError("Selecciona el mismo archivo de la solicitud conservada. No se enviaron datos nuevos ni se cambió su clave.");
  const form=new FormData();form.set("payload",JSON.stringify(payload));form.set("credential",file!,"cedula-arbitral");return {headers:{},body:form};
}
