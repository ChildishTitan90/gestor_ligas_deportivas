import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createSupabaseSignatureStorage } from "../src/features/clubs/server/supabase-signature-storage";
import { checkPrivateSignatureDownload, SignatureDownloadCheckError } from "./verification/signature-download-check";
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof import("@next/env");

// Contexto ficticio, sin filas correspondientes en PostgreSQL. Cada archivo usa UUID nuevo.
const testPrefix = "affiliation-signatures/v1/66000000-0000-4000-8000-000000000001/66000000-0000-4000-8000-000000000002/66000000-0000-4000-8000-000000000003/PRESIDENT/";
const fileId = randomUUID();
const cancellation = new AbortController();
const stop = () => cancellation.abort();

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--test-storage")
    throw new SignatureDownloadCheckError("USE_TEST_STORAGE_FLAG");
  loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  for (const name of ["SUPABASE_URL", "SUPABASE_STORAGE_SERVER_KEY", "SUPABASE_SIGNATURES_BUCKET"])
    if (!process.env[name]) throw new SignatureDownloadCheckError(`MISSING_${name}`);
  if (process.env.SUPABASE_SIGNATURES_BUCKET !== "firmas-afiliacion")
    throw new SignatureDownloadCheckError("UNEXPECTED_BUCKET");
  const provider = createSupabaseSignatureStorage();
  const bytes = await sharp({ create: { width: 32, height: 16, channels: 3, background: "#176070" } }).png().toBuffer();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const result = await checkPrivateSignatureDownload(provider, {
      origin: new URL(process.env.SUPABASE_URL!).origin, bucket: process.env.SUPABASE_SIGNATURES_BUCKET!,
      key: `${testPrefix}${fileId}`, bytes, signal: cancellation.signal,
      progress: stage => console.log(`[PDGLD-60 Storage] ${stage}`),
    });
    console.log(JSON.stringify(result));
    console.log("Comprobación aprobada y archivo ficticio eliminado. PostgreSQL no fue modificado.");
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch(error => {
  const code = error instanceof SignatureDownloadCheckError ? error.code : "STORAGE_CHECK_FAILED";
  console.error(`[PDGLD-60 Storage] ${code}`);
  // Permite identificar el objeto de prueba si falla la limpieza, sin publicar enlaces o credenciales.
  if (code === "CLEANUP_FAILED") console.error(`Archivo ficticio pendiente: ${fileId}; usar el prefijo de prueba definido en este script.`);
  process.exitCode = 1;
});
