import "server-only";
import { IdentityCorrectionError } from "./identity-correction";
import { documentFailure, documentHeaders } from "./document-http";
export function correctionFailure(error: unknown) { return error instanceof IdentityCorrectionError ? Response.json({ code: error.code }, { status: error.status, headers: documentHeaders }) : documentFailure(error); }
/** Multipart bounded before parsing; never log its body, names or binary evidence. */
export async function correctionMultipart(request: Request) {
    const limit = 3 * 10485760 + 16384;
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
        throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
    const reader = request.body?.getReader();
    if (!reader)
        throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > limit) {
                await reader.cancel();
                throw new IdentityCorrectionError("PAYLOAD_TOO_LARGE", 413);
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    try {
        return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
    }
    catch {
        throw new IdentityCorrectionError("VALIDATION_ERROR", 400);
    }
}
