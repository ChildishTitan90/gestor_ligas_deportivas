import { z } from "zod";
import { providerRetryRequestSchema } from "@/features/players/provider-retry";
import { CurpVerificationError } from "@/features/players/server/curp-check-record";
import { authorizeCurpProviderRetryForActor } from "@/features/players/server/curp-verification-service";
import { documentActor, documentBody, documentFailure, documentHeaders } from "@/features/players/server/document-http";
import { authorizeIneProviderRetryForActor, IneVerificationError } from "@/features/players/server/ine-verification-service";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ registrationId: string }> }) {
  try {
    const actor = await documentActor(request, true);
    const registrationId = z.uuid().safeParse((await context.params).registrationId);
    const input = providerRetryRequestSchema.safeParse(await documentBody(request));
    if (!registrationId.success || !input.success)
      return Response.json({ code: "VALIDATION_ERROR" }, { status: 400, headers: documentHeaders });
    const authorize = input.data.kind === "CURP" ? authorizeCurpProviderRetryForActor : authorizeIneProviderRetryForActor;
    const state = await authorize(actor.id, registrationId.data, input.data.attemptId);
    return Response.json(state, { headers: documentHeaders });
  } catch (error) {
    if (error instanceof CurpVerificationError || error instanceof IneVerificationError)
      return Response.json({ code: error.code }, { status: error.status, headers: documentHeaders });
    return documentFailure(error);
  }
}
