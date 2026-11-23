import "server-only";
import { consumeRecoveryBudget, recoveryClientKey } from "./recovery-abuse";
import { recoveryPolicy, requestPasswordRecovery, completePasswordRecovery } from "./password-recovery";
import { readRecoveryBody, recoveryResponse } from "./recovery-http";
import { recoveryCompletionSchema, recoveryRequestSchema } from "@/features/auth/schemas";
import { getEmailTransport, type EmailTransport } from "@/server/email/transport";

type Policy = NonNullable<ReturnType<typeof recoveryPolicy>>;
/** Dependencias solo de servidor. Los handlers públicos nunca reciben configuración del cliente. */
export async function handleRecoveryRequest(request: Request, enqueue: (work: () => Promise<void>) => void,
  settings: { policy: Policy | null; transport: EmailTransport | null } = { policy: recoveryPolicy(), transport: getEmailTransport() }) {
  const {policy, transport} = settings;
  if (!policy || !transport) return recoveryResponse("UNAVAILABLE", 503);
  const parsed = recoveryRequestSchema.safeParse(await readRecoveryBody(request).catch(() => null));
  if (!parsed.success) return recoveryResponse("INVALID_REQUEST", 400);
  const client = recoveryClientKey(request, policy.abuse);
  if (!client) return recoveryResponse("UNAVAILABLE", 503);
  try {
    if (!await consumeRecoveryBudget("request", client, parsed.data.email, policy.abuse, policy.maxPerHour))
      return recoveryResponse("REQUEST_RECEIVED", 202);
  } catch {
    console.error("[auth] PASSWORD_RECOVERY_BUDGET_UNAVAILABLE");
    return recoveryResponse("UNAVAILABLE", 503);
  }
  enqueue(async () => {
    try { await requestPasswordRecovery(parsed.data.email, transport, policy); }
    catch { console.error("[auth] PASSWORD_RECOVERY_REQUEST_FAILED"); }
  });
  return recoveryResponse("REQUEST_RECEIVED", 202);
}

export async function handleRecoveryCompletion(request: Request, policy = recoveryPolicy()) {
  if (!policy) return recoveryResponse("UNAVAILABLE", 503);
  const parsed = recoveryCompletionSchema.safeParse(await readRecoveryBody(request).catch(() => null));
  if (!parsed.success) return recoveryResponse("INVALID_REQUEST", 400);
  const client = recoveryClientKey(request, policy.abuse);
  if (!client) return recoveryResponse("UNAVAILABLE", 503);
  try {
    if (!await consumeRecoveryBudget("complete", client, parsed.data.token, policy.abuse, policy.abuse.completeIp))
      return recoveryResponse("RATE_LIMITED", 429);
    return await completePasswordRecovery(parsed.data.token, parsed.data.newPassword)
      ? recoveryResponse("PASSWORD_CHANGED") : recoveryResponse("INVALID_LINK", 400);
  } catch {
    console.error("[auth] PASSWORD_RECOVERY_COMPLETE_FAILED");
    return recoveryResponse("UNAVAILABLE", 503);
  }
}
