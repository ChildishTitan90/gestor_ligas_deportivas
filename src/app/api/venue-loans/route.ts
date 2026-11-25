import { z } from "zod";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { BinaryFileValidationError, PRIVATE_FILE_MAX_BYTES } from "@/server/files/private-file-validation";
import { cleanCancelledVenueLoanFiles } from "@/features/venues/server/loan-cleanup";
import { LoanError, resolveLegacyVenueLoanForActor, decideVenueLoan, previewVenueLoanLetter, submitVenueLoan } from "@/features/venues/server/loans";
import { getVenueLoanWorkspace } from "@/features/venues/server/loan-workspace";
import { venueTimeToIso } from "@/features/venues/time";

function invalid(status = 400) {
  return Response.json({ code: "INVALID_PAYLOAD" }, { status, headers: competitionHeaders });
}

export async function POST(request: Request) {
  try {
    const actor = await requireOperationalUser();
    if (request.headers.get("X-Expected-Actor-Id") !== actor.id ||
        request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? "").origin ||
        request.headers.get("sec-fetch-site") === "cross-site") throw new AuthorizationError();
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;")) {
      const command = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("preview"), requestId: z.uuid() }).strict(),
        z.object({ kind: z.literal("cleanup") }).strict(),
        z.object({ kind: z.literal("resolve-legacy"), requestId: z.uuid(), contextId: z.uuid() }).strict(),
        z.object({ kind: z.literal("decide"), requestId: z.uuid(), status: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().min(8).max(500) }).strict(),
      ]).parse(await readCompetitionBody(request));
      if (command.kind === "cleanup") return Response.json(await cleanCancelledVenueLoanFiles(undefined, actor.id), { headers: competitionHeaders });
      if (command.kind === "preview") return Response.json(await previewVenueLoanLetter(command.requestId), { headers: { ...competitionHeaders, "Referrer-Policy": "no-referrer" } });
      if (command.kind === "resolve-legacy") {
        const workspace = await getVenueLoanWorkspace();
        const context = workspace.contexts.find(c => c.id === command.contextId);
        if (!context) throw new AuthorizationError();
        return Response.json(await resolveLegacyVenueLoanForActor(actor.id, {
          requestId: command.requestId, clubId: context.clubId, seasonId: context.seasonId,
        }), { headers: competitionHeaders });
      }
      const { requestId, status, reason } = command;
      return Response.json(await decideVenueLoan({ requestId, status, reason }), { headers: competitionHeaders });
    }

    const limit = PRIVATE_FILE_MAX_BYTES + 1024 * 1024 + 32768;
    if (Number(request.headers.get("content-length") ?? 0) > limit) return invalid(413);
    const reader = request.body?.getReader();
    if (!reader) return invalid();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) { await reader.cancel(); return invalid(413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let form: FormData;
    try { form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": type } }).formData(); }
    catch { return invalid(); }
    const file = form.get("letter");
    const signature = form.get("signature");
    const parsed = z.object({ requestId: z.uuid(), contextId: z.uuid(), venueId: z.uuid(),
      windows: z.array(z.object({ start: z.string().max(25), end: z.string().max(25) }).strict()).min(1).max(50),
    }).strict().parse(JSON.parse(z.string().max(16000).parse(form.get("payload"))));
    if (!(file instanceof File) || !file.size || file.size > PRIVATE_FILE_MAX_BYTES) return invalid();
    if (signature !== null && (!(signature instanceof File) || signature.type !== "image/png" || !signature.size || signature.size > 1024 * 1024)) return invalid();
    const workspace = await getVenueLoanWorkspace();
    const context = workspace.contexts.find(c => c.id === parsed.contextId && c.venues.some(v => v.value === parsed.venueId));
    if (!context) throw new AuthorizationError();
    const windows = parsed.windows.map(w => ({ startsAt: venueTimeToIso(w.start, context.zone), endsAt: venueTimeToIso(w.end, context.zone) }));
    return Response.json(await submitVenueLoan({ requestId: parsed.requestId, venueId: parsed.venueId, clubId: context.clubId, seasonId: context.seasonId, windows },
      { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type,
        ...(signature instanceof File ? { signature: new Uint8Array(await signature.arrayBuffer()) } : {}) }), { headers: competitionHeaders });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return invalid();
    if (error instanceof BinaryFileValidationError) return invalid(error.status);
    if (error instanceof LoanError) {
      const status = ["INVALID_WINDOWS", "WINDOW_OUTSIDE_SEASON", "SIGNATURE_REQUIRED", "INVALID_SIGNATURE"].includes(error.message) ? 400 : 409;
      return Response.json({ code: error.message }, { status, headers: competitionHeaders });
    }
    return competitionFailure(error);
  }
}
