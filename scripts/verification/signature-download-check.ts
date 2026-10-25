import { createHash } from "node:crypto";
import type { PrivateSignatureStorage } from "../../src/features/clubs/server/signature-storage";

type Provider = {
  storage: Pick<PrivateSignatureStorage, "put" | "remove">;
  createDownloadUrl(key: string): Promise<{ signedUrl: string; expiresInSeconds: number }>;
};
type Options = {
  origin: string; bucket: string; key: string; bytes: Uint8Array; signal?: AbortSignal;
  request?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  progress?: (stage: string) => void;
};
export class SignatureDownloadCheckError extends Error {
  constructor(public readonly code: string) { super(code); }
}

/** Solo trabaja sobre la clave ficticia creada por el llamador; no toca PostgreSQL. */
export async function checkPrivateSignatureDownload(provider: Provider, options: Options) {
  const request = options.request ?? fetch;
  const progress = options.progress ?? (() => {});
  const wait = options.wait ?? (milliseconds => new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) { reject(new SignatureDownloadCheckError("CANCELLED")); return; }
    const finish = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new SignatureDownloadCheckError("CANCELLED")); };
    options.signal?.addEventListener("abort", abort, { once: true });
  }));
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  async function get(url: string) {
    return request(url, { credentials: "omit", redirect: "error", cache: "no-store",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  }
  const encodedPath = `${encodeURIComponent(options.bucket)}/${options.key.split("/").map(encodeURIComponent).join("/")}`;
  try {
    progress("Cargar archivo ficticio aislado");
    await provider.storage.put(options.key, { bytes: options.bytes, mimeType: "image/png" });
    const signed = await provider.createDownloadUrl(options.key);
    const url = new URL(signed.signedUrl);
    if (url.origin !== options.origin || url.protocol !== "https:" || url.username || url.password || url.hash ||
        url.pathname !== `/storage/v1/object/sign/${encodedPath}` || !url.searchParams.get("token") ||
        !Number.isInteger(signed.expiresInSeconds) || signed.expiresInSeconds < 1 || signed.expiresInSeconds > 60)
      throw new SignatureDownloadCheckError("INVALID_DOWNLOAD_LINK");
    progress("Verificar descarga y contenido");
    const received = await get(url.href);
    if (received.status !== 200 || received.headers.get("content-type")?.split(";")[0].trim() !== "image/png")
      throw new SignatureDownloadCheckError("DOWNLOAD_FAILED");
    const bytes = new Uint8Array(await received.arrayBuffer());
    if (bytes.byteLength !== options.bytes.byteLength || hash(bytes) !== hash(options.bytes))
      throw new SignatureDownloadCheckError("CONTENT_MISMATCH");
    progress("Verificar rechazo de acceso sin firma y por ruta pública");
    const unsigned = new URL(url);
    unsigned.search = "";
    for (const address of [unsigned.href, `${options.origin}/storage/v1/object/public/${encodedPath}`]) {
      const response = await get(address);
      await response.body?.cancel();
      if (response.ok) throw new SignatureDownloadCheckError("PUBLIC_ACCESS_ALLOWED");
      if (![400, 401, 403, 404].includes(response.status)) throw new SignatureDownloadCheckError("ACCESS_CHECK_INCONCLUSIVE");
    }
    progress(`Esperar ${signed.expiresInSeconds + 5} segundos para comprobar vencimiento`);
    await wait((signed.expiresInSeconds + 5) * 1000);
    const expired = await get(url.href);
    await expired.body?.cancel();
    if (expired.ok) throw new SignatureDownloadCheckError("LINK_DID_NOT_EXPIRE");
    if (![400, 401, 403, 404].includes(expired.status)) throw new SignatureDownloadCheckError("EXPIRATION_CHECK_INCONCLUSIVE");
    return { contentMatches: true, unsignedAccessDenied: true, publicAccessDenied: true, expirationVerified: true };
  } finally {
    progress("Eliminar únicamente el archivo ficticio de esta comprobación");
    try { await provider.storage.remove(options.key); }
    catch { throw new SignatureDownloadCheckError("CLEANUP_FAILED"); }
  }
}
