import { after } from "next/server";
import { handleRecoveryRequest } from "@/server/auth/recovery-handlers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleRecoveryRequest(request, after);
}
