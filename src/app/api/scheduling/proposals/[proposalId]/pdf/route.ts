import { ZodError } from "zod";
import { competitionFailure, competitionHeaders } from "@/features/competitions/server/http";
import { approvedSchedulePdf, SchedulePdfUnavailable } from "@/features/scheduling/server/schedule-pdf";

export async function GET(_request:Request, context:{params:Promise<{proposalId:string}>}) {
  try {
    const {proposalId}=await context.params;
    const bytes=await approvedSchedulePdf(proposalId);
    return new Response(new Uint8Array(bytes),{headers:{...competitionHeaders,"Content-Type":"application/pdf",
      "Content-Disposition":`attachment; filename="programacion-${proposalId}.pdf"`,"X-Content-Type-Options":"nosniff"}});
  } catch(error) {
    if(error instanceof ZodError)return Response.json({code:"INVALID_INPUT"},{status:400,headers:competitionHeaders});
    if(error instanceof SchedulePdfUnavailable)return Response.json({code:"SCHEDULE_NOT_APPROVED"},{status:409,headers:competitionHeaders});
    return competitionFailure(error);
  }
}
