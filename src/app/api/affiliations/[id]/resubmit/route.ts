import { submitAffiliation } from "@/features/clubs/server/affiliation-service";
import { affiliationBody, affiliationResponse } from "@/features/clubs/server/affiliation-http";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return affiliationResponse(async () => submitAffiliation(await affiliationBody(request), (await params).id));
}
