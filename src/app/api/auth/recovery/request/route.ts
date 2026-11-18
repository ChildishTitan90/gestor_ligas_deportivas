import { after } from "next/server";
import { recoveryRequestSchema } from "@/features/auth/schemas";
import { recoveryPolicy, requestPasswordRecovery } from "@/server/auth/password-recovery";
import { readRecoveryBody, recoveryResponse } from "@/server/auth/recovery-http";
import { getEmailTransport } from "@/server/email/transport";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const policy = recoveryPolicy();
  const transport = getEmailTransport();
  if (!policy || !transport) return recoveryResponse("UNAVAILABLE", 503);
  const parsed = recoveryRequestSchema.safeParse(await readRecoveryBody(request).catch(() => null));
  if (!parsed.success) return recoveryResponse("INVALID_REQUEST", 400);
  // Account lookup, throttling and delivery must not affect the public response.
  after(async () => {
    try { await requestPasswordRecovery(parsed.data.email, transport, policy); }
    catch { console.error("[auth] PASSWORD_RECOVERY_REQUEST_FAILED"); }
  });
  return recoveryResponse("REQUEST_RECEIVED", 202);
}
