import { documentActor, documentHeaders, documentFailure } from "@/features/players/server/document-http";
import { authorizePlayerIneUploadForActor, verifyPlayerIneForActor, readPlayerIneStatusForActor, IneVerificationError } from "@/features/players/server/ine-verification-service";
import { createSupabasePlayerDocumentStorage } from "@/features/players/server/supabase-document-storage";
import { ineParts } from "@/features/players/ine-verification";
export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ registrationId: string }> };
function failure(error: unknown) {
  return error instanceof IneVerificationError ? Response.json({ code: error.code }, { status: error.status, headers: documentHeaders }) : documentFailure(error);
}
export async function GET(request: Request, context: Context) {
  try {
    const actor = await documentActor(request), { registrationId } = await context.params;
    return Response.json(await readPlayerIneStatusForActor(actor.id, registrationId, new URL(request.url).searchParams.get("attemptId") ?? undefined), { headers: documentHeaders });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await documentActor(request, true), { registrationId } = await context.params;
    await authorizePlayerIneUploadForActor(actor.id, registrationId);
    const type = request.headers.get("content-type") ?? "";
    const limit = 3 * 10485760 + 16384;
    if (!type.startsWith("multipart/form-data;") || Number(request.headers.get("content-length") ?? 0) > limit) throw new IneVerificationError("INVALID_PAYLOAD", 400);
    const reader = request.body?.getReader(); if (!reader) throw new IneVerificationError("INVALID_PAYLOAD", 400);
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > limit) { await reader.cancel(); throw new IneVerificationError("PAYLOAD_TOO_LARGE", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const form = await new Request(request.url, { method: "POST", headers: { "content-type": type }, body: Buffer.concat(chunks) }).formData();
    if ([...form.keys()].some(k => !["intent", ...ineParts].includes(k)) || [...form.keys()].length !== 4) throw new IneVerificationError("INVALID_PAYLOAD", 400);
    const intent = form.get("intent"); if (typeof intent !== "string" || intent.length > 2048) throw new IneVerificationError("INVALID_PAYLOAD", 400);
    const images = {} as Parameters<typeof verifyPlayerIneForActor>[3];
    for (const part of ineParts) {
      const file = form.get(part);
      if (!(file instanceof File) || !file.size || file.size > 10485760) throw new IneVerificationError("INVALID_PAYLOAD", 400);
      images[part] = { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type };
    }
    let input: unknown; try { input = JSON.parse(intent); } catch { throw new IneVerificationError("INVALID_PAYLOAD", 400); }
    const result = await verifyPlayerIneForActor(actor.id, registrationId, input, images, { storage: createSupabasePlayerDocumentStorage() });
    return Response.json(result, { headers: documentHeaders });
  } catch (error) { return failure(error); }
}
