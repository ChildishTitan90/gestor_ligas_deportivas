import { recoveryCompletionSchema } from "@/features/auth/schemas";
import { completePasswordRecovery, recoveryPolicy } from "@/server/auth/password-recovery";
import { readRecoveryBody, recoveryResponse } from "@/server/auth/recovery-http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!recoveryPolicy()) return recoveryResponse("UNAVAILABLE", 503);
  const parsed = recoveryCompletionSchema.safeParse(await readRecoveryBody(request).catch(() => null));
  if (!parsed.success) return recoveryResponse("INVALID_REQUEST", 400);
  try {
    return await completePasswordRecovery(parsed.data.token, parsed.data.newPassword)
      ? recoveryResponse("PASSWORD_CHANGED")
      : recoveryResponse("INVALID_LINK", 400);
  } catch {
    console.error("[auth] PASSWORD_RECOVERY_COMPLETE_FAILED");
    return recoveryResponse("UNAVAILABLE", 503);
  }
}
