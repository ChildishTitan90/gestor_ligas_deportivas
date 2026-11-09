import { NextResponse } from "next/server";
import { getAccountIdentifiers, changeAccountIdentifiers } from "@/features/accounts/server/maintenance";
import { maintenanceFailure, maintenanceHeaders, readMaintenanceBody } from "@/features/accounts/server/maintenance-http";
export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ accountId: string }> }) {
  try { return NextResponse.json(await getAccountIdentifiers((await context.params).accountId), { headers: maintenanceHeaders }); }
  catch (error) { return maintenanceFailure(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    return NextResponse.json(await changeAccountIdentifiers((await context.params).accountId, await readMaintenanceBody(request)),
      { headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
