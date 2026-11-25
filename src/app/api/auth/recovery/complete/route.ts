import { handleRecoveryCompletion } from "@/server/auth/recovery-handlers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleRecoveryCompletion(request);
}
