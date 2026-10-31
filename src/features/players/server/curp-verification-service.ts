import "server-only";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { curpCheckOutcomes, curpVerificationRequestSchema, identityFields, type CurpVerificationStatus } from "../curp-verification";
import { curpCheckSelect, curpStatus, CurpVerificationError, lockCurpSnapshot } from "./curp-check-record";
import { getVerificamexCurpProvider, type CurpProvider } from "./verificamex-curp";

// Límites de gasto conservadores de esta entrega; compartidos por todos los procesos en PostgreSQL.
const defaultPolicy = { globalDailyLimit: 3, actorDailyLimit: 2, cooldownMs: 60_000 };
type CheckPolicy = typeof defaultPolicy;
type Dependencies = { provider: CurpProvider; policy?: CheckPolicy };
const providerResultSchema = z.strictObject({ status: z.enum(curpCheckOutcomes), mismatchedFields: z.array(z.enum(identityFields)).max(5) })
  .refine(result => result.status === "DISCREPANCY" ? result.mismatchedFields.length > 0 : result.mismatchedFields.length === 0);

export async function verifyPlayerCurp(registrationId: string, input: unknown, expectedActorId?: string): Promise<CurpVerificationStatus> {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  return verifyPlayerCurpForActor(actor.id, registrationId, input);
}

/** actor y dependencias provienen exclusivamente del servidor; la entrada HTTP no los acepta. */
export async function verifyPlayerCurpForActor(actorId: string, registrationId: string, input: unknown, dependencies?: Dependencies): Promise<CurpVerificationStatus> {
  const parsed = curpVerificationRequestSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(registrationId).success) throw new CurpVerificationError("VALIDATION_ERROR", 400);
  const data = parsed.data;
  const db = getPrisma();
  const prepared = await db.$transaction(async tx => {
    const snapshot = await lockCurpSnapshot(tx, actorId, registrationId, "UPDATE");
    if (snapshot.version !== data.identityVersion) throw new CurpVerificationError("IDENTITY_CHANGED");
    // El lock se libera antes de la red; arbitra cuotas e intenciones de todos los procesos.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(97,2026)::text`;
    const prior = await tx.player_curp_checks.findUnique({ where: { actor_id_operation_key: {
      actor_id: actorId, operation_key: data.operationKey } }, select: curpCheckSelect });
    if (prior) {
      if (prior.registration_id !== registrationId || prior.fingerprint !== snapshot.fingerprint)
        throw new CurpVerificationError("OPERATION_CONFLICT");
      return { done: curpStatus(snapshot, prior, true) };
    }
    const latest = await tx.player_curp_checks.findFirst({ where: { person_id: snapshot.personId,
      identity_version: snapshot.version, fingerprint: snapshot.fingerprint }, orderBy: [{ created_at: "desc" }, { id: "desc" }], select: curpCheckSelect });
    if (latest) {
      const current = curpStatus(snapshot, latest, true);
      // Un cambio de clave por sí solo no vuelve a consultar ni gastar.
      if (current.status === "VERIFIED" || !data.retryOf || current.status === "PENDING") return { done: current };
      if (data.retryOf !== latest.id) throw new CurpVerificationError("OPERATION_CONFLICT");
      if (current.status === "UNCERTAIN" && !data.acknowledgePossiblePreviousCharge)
        throw new CurpVerificationError("RETRY_CONFIRMATION_REQUIRED");
    } else if (data.retryOf) throw new CurpVerificationError("OPERATION_CONFLICT");
    if (!snapshot.available) throw new CurpVerificationError("CONTEXT_NOT_AVAILABLE");
    const provider = dependencies?.provider ?? getVerificamexCurpProvider();
    if (!provider.configured) return { done: { ...curpStatus(snapshot, null, false), status: "NOT_CONFIGURED" as const } };
    const policy = dependencies?.policy ?? defaultPolicy;
    const [clock] = await tx.$queryRaw<{ now: Date; day: Date }[]>`SELECT clock_timestamp() AS now,
      date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Mexico_City') AT TIME ZONE 'America/Mexico_City' AS day`;
    const [globalCount, actorCount] = await Promise.all([
      tx.player_curp_checks.count({ where: { created_at: { gte: clock.day } } }),
      tx.player_curp_checks.count({ where: { actor_id: actorId, created_at: { gte: clock.day } } }),
    ]);
    const recent = await tx.player_curp_checks.findFirst({ where: { person_id: snapshot.personId,
      created_at: { gt: new Date(clock.now.getTime() - policy.cooldownMs) } }, select: { id: true } });
    if (globalCount >= policy.globalDailyLimit || actorCount >= policy.actorDailyLimit || recent)
      throw new CurpVerificationError("USAGE_LIMIT_REACHED", 429);
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),
      set_config('app.reason','PDGLD-97: intención explícita de consulta CURP',true)`;
    const check = await tx.player_curp_checks.create({ data: { actor_id: actorId, operation_key: data.operationKey,
      person_id: snapshot.personId, registration_id: registrationId, identity_version: snapshot.version,
      fingerprint: snapshot.fingerprint, status: "PENDING" }, select: curpCheckSelect });
    return { snapshot, check, provider };
  }, { timeout: 15_000 });
  if (prepared.done) return prepared.done;
  const { snapshot, check, provider } = prepared;
  // No hay transacción de BD abierta durante la consulta, ni reintentos automáticos.
  let outcome;
  try {
    const parsedResult = providerResultSchema.safeParse(await provider.verify(snapshot.identity));
    outcome = parsedResult.success ? parsedResult.data : { status: "UNEXPECTED_RESPONSE" as const, mismatchedFields: [] };
  } catch { outcome = { status: "UNCERTAIN" as const, mismatchedFields: [] }; }
  try {
    await db.$transaction(async tx => {
      const [person] = await tx.$queryRaw<{ version: number }[]>`SELECT identity_version AS version
        FROM sports_management.people WHERE id=${snapshot.personId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),
        set_config('app.reason','PDGLD-97: resultado de consulta CURP sin aprobación deportiva',true)`;
      await tx.player_curp_checks.update({ where: { id: check.id }, data: {
        status: person?.version === snapshot.version ? outcome.status : "STALE",
        mismatched_fields: person?.version === snapshot.version ? outcome.mismatchedFields : [], finished_at: new Date() } });
    });
  } catch { throw new CurpVerificationError("SERVICE_UNAVAILABLE", 503); }
  // Guardar el acuse aunque haya revocación, pero comprobar permisos vigentes antes de responder.
  return readPlayerCurpStatusForActor(actorId, registrationId, check.id);
}

export async function getPlayerCurpStatus(registrationId: string, checkId?: string, expectedActorId?: string): Promise<CurpVerificationStatus> {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  return readPlayerCurpStatusForActor(actor.id, registrationId, checkId);
}

export async function readPlayerCurpStatusForActor(actorId: string, registrationId: string, checkId?: string): Promise<CurpVerificationStatus> {
  if (!z.uuid().safeParse(registrationId).success || (checkId !== undefined && !z.uuid().safeParse(checkId).success))
    throw new CurpVerificationError("VALIDATION_ERROR", 400);
  return getPrisma().$transaction(async tx => {
    const snapshot = await lockCurpSnapshot(tx, actorId, registrationId, "READ");
    const row = await tx.player_curp_checks.findFirst({ where: { person_id: snapshot.personId,
      ...(checkId ? { id: checkId } : {}) },
      orderBy: [{ created_at: "desc" }, { id: "desc" }], select: curpCheckSelect });
    return curpStatus(snapshot, row, true);
  });
}
