import { documentActor, documentBody, documentFailure, documentHeaders } from "@/features/players/server/document-http";
import { downloadPlayerIneEvidenceForActor, IneVerificationError } from "@/features/players/server/ine-verification-service";
import { createSupabasePlayerDocumentStorage } from "@/features/players/server/supabase-document-storage";
import { z } from "zod";
import { ineParts } from "@/features/players/ine-verification";
export async function POST(request: Request, context: { params: Promise<{ registrationId: string }> }) {
  try {
    const actor = await documentActor(request, true), { registrationId } = await context.params;
    const parsed = z.strictObject({ attemptId: z.uuid(), part: z.enum(ineParts) }).safeParse(await documentBody(request));
    if (!parsed.success) return Response.json({ code: "INVALID_PAYLOAD" }, { status: 400, headers: documentHeaders });
    return Response.json(await downloadPlayerIneEvidenceForActor(actor.id, registrationId, parsed.data.attemptId, parsed.data.part, createSupabasePlayerDocumentStorage()), { headers: documentHeaders });
  } catch (error) {
    if (error instanceof IneVerificationError) return Response.json({ code: error.code }, { status: error.status, headers: documentHeaders });
    return documentFailure(error);
  }
}
