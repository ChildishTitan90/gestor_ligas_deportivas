import { NextResponse } from "next/server";
import { accountEmailChanges } from "@/features/accounts/server/email-change";
import { maintenanceFailure, maintenanceHeaders, readMaintenanceBody } from "@/features/accounts/server/maintenance-http";
export const runtime = "nodejs";
// Solo POST consume el secreto en el cuerpo: nunca query string, logs o respuesta.
export async function POST(request: Request) {
  try {
    return NextResponse.json(await accountEmailChanges().confirm(await readMaintenanceBody(request)), { headers: maintenanceHeaders });
  } catch (error) { return maintenanceFailure(error); }
}
