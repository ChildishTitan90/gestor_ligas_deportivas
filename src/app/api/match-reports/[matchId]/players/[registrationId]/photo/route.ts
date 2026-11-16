import { requireOperationalUser } from "@/server/auth/session";
import { createSupabasePlayerDocumentStorage } from "@/features/players/server/supabase-document-storage";
import { readMatchPlayerPhoto } from "@/features/match-reports/server/player-photos";
import { reportHttpError } from "@/features/match-reports/server/http";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string; registrationId: string }> }) {
  try {
    const actor = await requireOperationalUser();
    const { matchId, registrationId } = await params;
    const photo = await readMatchPlayerPhoto(actor.id, matchId, registrationId, { read: (key, max, mime) => createSupabasePlayerDocumentStorage().read(key, max, mime) });
    return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  } catch (error) { return reportHttpError(error); }
}
