import { readCorrectionEvidenceForActor } from "@/features/players/server/identity-correction";
import { documentActor, documentHeaders } from "@/features/players/server/document-http";
import { correctionFailure } from "@/features/players/server/identity-correction-http";
export async function GET(request: Request, context: {
    params: Promise<{
        registrationId: string;
        evidenceId: string;
    }>;
}) { try {
    const actor = await documentActor(request), p = await context.params;
    const file = await readCorrectionEvidenceForActor(actor.id, p.registrationId, p.evidenceId);
    return new Response(new Uint8Array(file.bytes), { headers: { ...documentHeaders, "Content-Type": file.mimeType, "Content-Disposition": "inline; filename=\"evidencia-privada\"", "Content-Security-Policy": "sandbox" } });
}
catch (e) {
    return correctionFailure(e);
} }
