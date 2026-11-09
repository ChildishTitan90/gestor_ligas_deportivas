import { correctionWorkspaceForActor, requestIdentityCorrectionForActor, IdentityCorrectionError } from "@/features/players/server/identity-correction";
import { documentActor, documentHeaders } from "@/features/players/server/document-http";
import { correctionFailure, correctionMultipart } from "@/features/players/server/identity-correction-http";
import { correctionEvidenceKinds } from "@/features/players/identity-correction";
export async function GET(request: Request, context: {
    params: Promise<{
        registrationId: string;
    }>;
}) { try {
    const actor = await documentActor(request);
    return Response.json(await correctionWorkspaceForActor(actor.id, (await context.params).registrationId), { headers: documentHeaders });
}
catch (e) {
    return correctionFailure(e);
} }
export async function POST(request: Request, context: {
    params: Promise<{
        registrationId: string;
    }>;
}) {
    try {
        const actor = await documentActor(request, true), id = (await context.params).registrationId;
        const workspace = await correctionWorkspaceForActor(actor.id, id);
        if (!workspace.canRequest)
            throw new IdentityCorrectionError("FORBIDDEN", 403);
        const form = await correctionMultipart(request);
        if ([...form.keys()].some(k => k !== "intent" && !(correctionEvidenceKinds as readonly string[]).includes(k)) || form.getAll("intent").length !== 1)
            throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
        let intent: unknown;
        try {
            intent = JSON.parse(String(form.get("intent")));
        }
        catch {
            throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
        }
        const files = [];
        for (const kind of correctionEvidenceKinds) {
            if (form.getAll(kind).length > 1)
                throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
            const f = form.get(kind);
            if (f !== null) {
                if (!(f instanceof File))
                    throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
                files.push({ kind, mimeType: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
            }
        }
        return Response.json(await requestIdentityCorrectionForActor(actor.id, id, intent, files), { status: 201, headers: documentHeaders });
    }
    catch (e) {
        return correctionFailure(e);
    }
}
