import { decideIdentityCorrectionForActor } from "@/features/players/server/identity-correction";
import { documentActor, documentBody, documentHeaders } from "@/features/players/server/document-http";
import { correctionFailure } from "@/features/players/server/identity-correction-http";
export async function POST(request: Request, context: {
    params: Promise<{
        registrationId: string;
        correctionId: string;
    }>;
}) { try {
    const actor = await documentActor(request, true), p = await context.params;
    return Response.json(await decideIdentityCorrectionForActor(actor.id, p.registrationId, p.correctionId, await documentBody(request)), { headers: documentHeaders });
}
catch (e) {
    return correctionFailure(e);
} }
