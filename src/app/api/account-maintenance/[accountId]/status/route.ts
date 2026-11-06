import { NextResponse } from "next/server";
import { changeAccountStatus } from "@/features/accounts/server/maintenance";
import { maintenanceFailure, maintenanceHeaders, readMaintenanceBody } from "@/features/accounts/server/maintenance-http";
export const runtime = "nodejs";
export async function PATCH(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    return NextResponse.json(await changeAccountStatus((await context.params).accountId, await readMaintenanceBody(request)), { headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
