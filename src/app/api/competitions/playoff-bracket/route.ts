import { previewPlayoffBracket, confirmPlayoffBracket, readConfirmedPlayoffBracket } from "@/features/competitions/server/playoff-bracket";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { createPlayoffQuarterfinals } from "@/features/competitions/server/playoff-matches";
import { confirmPlayoffPenalties } from "@/features/competitions/server/playoff-penalties";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readCompetitionBody(request);
    if (!body || typeof body !== "object" || !("action" in body)) return Response.json({ code: "INVALID_CONFIGURATION" }, { status: 400 });
    if (body.action === "read" && "seasonId" in body && "categoryId" in body && typeof body.seasonId === "string" && typeof body.categoryId === "string")
      return Response.json(await readConfirmedPlayoffBracket(body.seasonId, body.categoryId), { headers: competitionHeaders });
    if (body.action === "preview" && "seasonId" in body && "categoryId" in body && typeof body.seasonId === "string" && typeof body.categoryId === "string")
      return Response.json(await previewPlayoffBracket(body.seasonId, body.categoryId), { headers: competitionHeaders });
    if (body.action === "confirm" && "command" in body) return Response.json(await confirmPlayoffBracket(body.command), { headers: competitionHeaders });
    if (body.action === "createMatches" && "command" in body) return Response.json(await createPlayoffQuarterfinals(body.command), { headers: competitionHeaders });
    if (body.action === "confirmPenalties" && "command" in body) return Response.json(await confirmPlayoffPenalties(body.command), { headers: competitionHeaders });
    return Response.json({ code: "INVALID_CONFIGURATION" }, { status: 400 });
  } catch (error) {
    const known = ["PLAYOFF_STANDINGS_CHANGED", "PLAYOFF_ALREADY_CONFIRMED", "OFFICIAL_RESULTS_INCOMPLETE", "REGULAR_SCHEDULE_INCOMPLETE", "UNRESOLVED_STANDINGS", "PLAYOFF_RULE_REQUIRED", "INSUFFICIENT_TEAMS", "UNSUPPORTED_GROUP_COUNT", "HOME_TEAM_UNDECIDED", "PLAYOFF_MATCHES_ALREADY_CREATED", "PLAYOFF_PREVIOUS_ROUND_INCOMPLETE", "PLAYOFF_DATES_REQUIRED", "INVALID_PLAYOFF_DATES", "PENALTIES_NOT_AVAILABLE", "PENALTIES_NOT_REQUIRED", "PLAYOFF_NEXT_SLOT_CONFLICT", "OPERATION_KEY_REUSED"];
    if (error instanceof Error && known.includes(error.message)) return Response.json({ code: error.message }, { status: 409, headers: competitionHeaders });
    return competitionFailure(error);
  }
}
