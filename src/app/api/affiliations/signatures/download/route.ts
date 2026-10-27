import { z } from "zod";
import { createSignatureDownload } from
  "@/features/clubs/server/signature-download-service";
import {
  readSignatureJson,
  signatureErrorResponse,
  signatureResponseHeaders,
  SignatureHttpError,
} from "@/features/clubs/server/signature-http";

export const runtime = "nodejs";

const downloadSchema = z.strictObject({
  signatureFileId: z.uuid().transform(
    (id) => id.toLowerCase(),
  ),
});

export async function POST(request: Request) {
  try {
    const input = await readSignatureJson(request);
    const parsed = downloadSchema.safeParse(input);

    if (!parsed.success) {
      throw new SignatureHttpError("INVALID_PAYLOAD", 400);
    }

    const result = await createSignatureDownload(
      parsed.data.signatureFileId,
    );

    return Response.json(result, {
      status: 200,
      headers: signatureResponseHeaders,
    });
  } catch (error) {
    return signatureErrorResponse(error);
  }
}