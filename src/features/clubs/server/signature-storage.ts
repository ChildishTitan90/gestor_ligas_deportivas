import "server-only";

export type SignatureMimeType =
  | "image/png"
  | "image/jpeg"
  | "application/pdf";

export type StoredSignatureObject = {
  bytes: Uint8Array;
  mimeType: SignatureMimeType;
};

// La clave siempre debe generarla el servidor después de autorizar.
// El adaptador guarda archivos; no decide quién puede acceder.
export interface PrivateSignatureStorage {
  put(
    key: string,
    object: StoredSignatureObject,
  ): Promise<void>;

  read(key: string): Promise<StoredSignatureObject>;

  remove(key: string): Promise<void>;
}