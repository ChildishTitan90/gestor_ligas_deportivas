import "server-only";
import {BinaryFileValidationError,PRIVATE_FILE_MAX_BYTES,validatePrivateFileContent,type ValidatedBinaryFile} from "@/server/files/private-file-validation";
export const SIGNATURE_MAX_BYTES=PRIVATE_FILE_MAX_BYTES;
export type ValidatedSignature=ValidatedBinaryFile;
export class SignatureValidationError extends Error {
  constructor(public readonly code:"INVALID_SIGNATURE"|"SIGNATURE_TOO_LARGE",public readonly status=400){super(code);}
}
export async function validateSignatureContent(input:Uint8Array,declaredMimeType:string):Promise<ValidatedSignature>{
  try{return await validatePrivateFileContent(input,declaredMimeType);}
  catch(error){if(error instanceof BinaryFileValidationError)throw new SignatureValidationError(error.code==="FILE_TOO_LARGE"?"SIGNATURE_TOO_LARGE":"INVALID_SIGNATURE",error.status);throw error;}
}
