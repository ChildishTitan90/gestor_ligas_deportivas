import { ZodError } from "zod";
import { competitionFailure, competitionHeaders } from "@/features/competitions/server/http";
import { SchedulePdfUnavailable } from "@/features/scheduling/server/schedule-pdf";
import { updatedSchedulePdf } from "@/features/scheduling/server/updated-schedule-pdf";

export async function GET(_request:Request,context:{params:Promise<{proposalId:string}>}) {
  try {
    const {proposalId}=await context.params;
    const bytes=await updatedSchedulePdf(proposalId);
    return new Response(new Uint8Array(bytes),{headers:{...competitionHeaders,"Content-Type":"application/pdf",
      "Content-Disposition":`attachment; filename="programacion-actualizada-${proposalId}.pdf"`,"X-Content-Type-Options":"nosniff"}});
  } catch(error) {
    if(error instanceof ZodError)return Response.json({code:"INVALID_INPUT"},{status:400,headers:competitionHeaders});
    if(error instanceof SchedulePdfUnavailable)return Response.json({code:"UPDATED_SCHEDULE_UNAVAILABLE"},{status:409,headers:competitionHeaders});
    return competitionFailure(error);
  }
}
