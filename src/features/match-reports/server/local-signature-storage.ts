import "server-only";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrivateDocumentTransport } from "@/server/files/private-document-storage";
/** Solo el runner aislado lo habilita. No es un bucket ni un sustituto de producción. */
export function localSignatureStorage(directory: string): PrivateDocumentTransport {
  const path = (key: string) => {
    if (!/^report-signatures\/v1\/(?:[a-f0-9-]{36}\/){4}[a-f0-9-]{36}$/.test(key)) throw Error("INVALID_LOCAL_OBJECT_KEY");
    return join(directory, createHash("sha256").update(key).digest("hex") + ".png");
  };
  return {
    async put(key, object) {
      try { await writeFile(path(key), object.bytes, { flag: "wx", mode: 0o600 }); return { replayed: false }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; if (!Buffer.from(await readFile(path(key))).equals(Buffer.from(object.bytes))) throw Error("LOCAL_OBJECT_CONFLICT"); return { replayed: true }; }
    },
    async read(key, max) { const bytes = await readFile(path(key)); if (bytes.length > max) throw Error("LOCAL_OBJECT_TOO_LARGE"); return bytes; },
    async createDownloadUrl() { throw Error("LOCAL_OBJECTS_REQUIRE_AUTHORIZED_ROUTE"); },
  };
}
