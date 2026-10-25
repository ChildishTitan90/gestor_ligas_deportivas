import { reviewAffiliation } from "@/features/clubs/server/affiliation-review-service";
import { affiliationBody, affiliationResponse } from "@/features/clubs/server/affiliation-http";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return affiliationResponse(async () => reviewAffiliation((await params).id, await affiliationBody(request)));
}
