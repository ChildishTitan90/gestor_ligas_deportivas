import { NextResponse } from "next/server";
import { resetAccountAccess } from "@/features/accounts/server/administrative-reset";
import { maintenanceFailure, maintenanceHeaders, readMaintenanceBody } from "@/features/accounts/server/maintenance-http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const result = await resetAccountAccess((await context.params).accountId, await readMaintenanceBody(request));
    return NextResponse.json(result, { status: 202, headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
