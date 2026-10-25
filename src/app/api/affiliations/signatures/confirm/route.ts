import { z } from "zod";
import { confirmSignatureUpload } from "@/features/clubs/server/signature-service";
import { createSupabaseSignatureStorage } from "@/features/clubs/server/supabase-signature-storage";
import type { PrivateSignatureStorage } from "@/features/clubs/server/signature-storage";
import {
  readSignatureJson,
  signatureErrorResponse,
  signatureResponseHeaders,
  SignatureHttpError,
} from "@/features/clubs/server/signature-http";

export const runtime = "nodejs";

const confirmSchema = z.strictObject({
  ticket: z.string().min(1).max(4096),
});

export async function POST(request: Request) {
  try {
    const input = await readSignatureJson(request);
    const parsed = confirmSchema.safeParse(input);

    if (!parsed.success) {
      throw new SignatureHttpError("INVALID_PAYLOAD", 400);
    }

    // Inicializar el adaptador solo cuando el servicio necesite Storage.
    // Así los permisos se verifican antes de acceder al bucket.
    const storage: PrivateSignatureStorage = {
      async put(key, object) {
        await createSupabaseSignatureStorage().storage.put(key, object);
      },
      async read(key) {
        return createSupabaseSignatureStorage().storage.read(key);
      },
      async remove(key) {
        await createSupabaseSignatureStorage().storage.remove(key);
      },
    };

    const result = await confirmSignatureUpload(
      parsed.data.ticket,
      storage,
    );

    return Response.json(result, {
      status: 200,
      headers: signatureResponseHeaders,
    });
  } catch (error) {
    return signatureErrorResponse(error);
  }
}