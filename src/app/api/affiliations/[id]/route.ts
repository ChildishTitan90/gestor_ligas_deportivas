import { getAffiliation } from "@/features/clubs/server/affiliation-review-service";
import { affiliationResponse } from "@/features/clubs/server/affiliation-http";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return affiliationResponse(async () => getAffiliation((await params).id));
}
