import { editSeason } from "@/features/competitions/server/edit-season";
import { deleteEmptySeason } from "@/features/competitions/server/maintenance";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await editSeason((await params).id, await readCompetitionBody(request)), { headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await deleteEmptySeason((await params).id, await readCompetitionBody(request)), { headers: competitionHeaders }); }
  catch (error) { return competitionFailure(error); }
}
