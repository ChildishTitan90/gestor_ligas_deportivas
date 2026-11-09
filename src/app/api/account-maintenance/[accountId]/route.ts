import { NextResponse } from "next/server";
import { getAccount } from "@/features/accounts/server/maintenance";
import { maintenanceFailure, maintenanceHeaders } from "@/features/accounts/server/maintenance-http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  try { return NextResponse.json(await getAccount((await context.params).accountId), { headers: maintenanceHeaders }); }
  catch (error) { return maintenanceFailure(error); }
}
