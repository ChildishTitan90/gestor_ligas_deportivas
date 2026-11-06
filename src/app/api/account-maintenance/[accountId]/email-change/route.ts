import { NextResponse } from "next/server";
import { accountEmailChanges } from "@/features/accounts/server/email-change";
import { maintenanceFailure, maintenanceHeaders, readMaintenanceBody } from "@/features/accounts/server/maintenance-http";
import { AccountMaintenanceError } from "@/features/accounts/maintenance-contract";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "operationKey") || params.getAll("operationKey").length !== 1)
      throw new AccountMaintenanceError("VALIDATION_ERROR");
    return NextResponse.json(await accountEmailChanges().status((await context.params).accountId, params.get("operationKey")!),
      { headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ accountId: string }> }) {
  try {
    const result = await accountEmailChanges().request((await context.params).accountId, await readMaintenanceBody(request));
    return NextResponse.json(result, { status: 202, headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
