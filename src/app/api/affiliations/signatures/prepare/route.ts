import { prepareSignatureUpload } from "@/features/clubs/server/signature-service";
import { createSupabaseSignatureStorage } from "@/features/clubs/server/supabase-signature-storage";
import {
  readSignatureJson,
  signatureErrorResponse,
  signatureResponseHeaders,
} from "@/features/clubs/server/signature-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await readSignatureJson(request);

    // Comprueba permisos y contexto antes de contactar con Storage.
    const prepared = await prepareSignatureUpload(input);

    const adapter = createSupabaseSignatureStorage();
    const upload = await adapter.createUploadUrl(prepared.storageKey);

    return Response.json(
      {
        ticket: prepared.ticket,
        uploadUrl: upload.signedUrl,
      },
      {
        status: 200,
        headers: signatureResponseHeaders,
      },
    );
  } catch (error) {
    return signatureErrorResponse(error);
  }
}