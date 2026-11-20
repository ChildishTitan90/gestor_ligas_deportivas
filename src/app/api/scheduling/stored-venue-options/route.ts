import { ZodError } from "zod";
import { competitionFailure, competitionHeaders, readCompetitionBody } from "@/features/competitions/server/http";
import { previewStoredVenueOptions } from "@/features/scheduling/server/service";

export async function POST(request:Request) {
  try {
    const result=await previewStoredVenueOptions(await readCompetitionBody(request));
    return Response.json(result,{status:result.code==="VENUE_OPTIONS" ? 200 : 409,headers:competitionHeaders});
  } catch(error) {
    if(error instanceof ZodError) return Response.json({code:"INVALID_PAYLOAD"},{status:400,headers:competitionHeaders});
    return competitionFailure(error);
  }
}
