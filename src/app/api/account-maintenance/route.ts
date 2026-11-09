import { NextResponse } from "next/server";
import { listAccounts } from "@/features/accounts/server/maintenance";
import { maintenanceFailure, maintenanceHeaders } from "@/features/accounts/server/maintenance-http";
import { AccountMaintenanceError } from "@/features/accounts/maintenance-contract";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new AccountMaintenanceError("VALIDATION_ERROR");
    return NextResponse.json(await listAccounts(Object.fromEntries(params)), { headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
