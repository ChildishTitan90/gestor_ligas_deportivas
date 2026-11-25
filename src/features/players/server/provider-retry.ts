import "server-only";
import type { Prisma } from "@prisma/client";
import { AuthorizationError } from "@/server/auth/authorization";
import type { ProviderRetryKind, ProviderRetryState } from "../provider-retry";
import { lockPlayerTeamContext } from "./access";

type RetryKey = { kind: ProviderRetryKind; registrationId: string; attemptId: string };

function retryFilter(key: RetryKey) {
  return { action: `PLAYER_${key.kind}_RETRY_AUTHORIZED`, table_name: "player_registrations", entity_id: key.registrationId };
}

export async function hasProviderRetryAuthorization(tx: Prisma.TransactionClient, key: RetryKey) {
  return Boolean(await tx.audit_logs.findFirst({
    where: { ...retryFilter(key), new_data: { path: ["attemptId"], equals: key.attemptId } },
    select: { id: true },
  }));
}

export async function readProviderRetryState(tx: Prisma.TransactionClient, key: RetryKey, actorId: string, seasonTeamId: string): Promise<ProviderRetryState> {
  if (await hasProviderRetryAuthorization(tx, key)) return { providerRetryAuthorized: true };
  try {
    await lockPlayerTeamContext(tx, actorId, seasonTeamId, "APPROVE");
    return { canAuthorizeProviderRetry: true };
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return {};
  }
}

/** El llamador comprueba APPROVE y conserva el mismo lock que arbitra los intentos del proveedor. */
export async function recordProviderRetryAuthorization(tx: Prisma.TransactionClient, key: RetryKey, actorId: string) {
  if (await hasProviderRetryAuthorization(tx, key)) return;
  await tx.audit_logs.create({ data: {
    ...retryFilter(key), user_id: actorId, new_data: { attemptId: key.attemptId },
    reason: "Administración confirmó que se resolvió el bloqueo del proveedor y autorizó un nuevo intento.",
  } });
}
