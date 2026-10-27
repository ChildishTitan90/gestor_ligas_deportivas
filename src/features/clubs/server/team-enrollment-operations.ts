import "server-only";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { enrollmentCancellationSchema, enrollmentOperationQuerySchema } from "../team-enrollment";
import { assertEnrollmentActor, TeamEnrollmentError } from "./team-enrollment-access";
import { enrollmentFingerprint, enrollmentResult, findEnrollmentOperation, lockEnrollmentOperation } from "./team-enrollment-record";

/** UNRESOLVED is deliberately not NOT_FOUND: a request can still arrive later. */
export async function getTeamEnrollmentOperation(input: unknown, expectedActorId?: string) {
  const actor = await requireOperationalUser();
  assertEnrollmentActor(actor.id, expectedActorId);
  const parsed = enrollmentOperationQuerySchema.safeParse(input);
  if (!parsed.success) throw new TeamEnrollmentError("VALIDATION_ERROR");
  const { clubId, enrollmentKey } = parsed.data;
  return getPrisma().$transaction(async (tx) => {
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ", context: { clubId } });
    await lockEnrollmentOperation(tx, actor.id, enrollmentKey);
    const operation = await findEnrollmentOperation(tx, actor.id, enrollmentKey);
    if (operation && operation.club_id !== clubId) throw new AuthorizationError();
    const enrollment = operation?.season_teams ? enrollmentResult(operation.season_teams, true) : null;
    return { enrollmentKey, clubId, outcome: operation?.outcome ?? "UNRESOLVED", enrollment };
  }, { timeout: 15_000 });
}

/** Cancel the intention, never withdraw/delete an enrollment that already won. */
export async function cancelTeamEnrollment(input: unknown, expectedActorId?: string) {
  const actor = await requireOperationalUser();
  assertEnrollmentActor(actor.id, expectedActorId);
  const parsed = enrollmentCancellationSchema.safeParse(input);
  if (!parsed.success) throw new TeamEnrollmentError("VALIDATION_ERROR");
  const data = parsed.data;
  const fingerprint = "team" in data ? enrollmentFingerprint(data) : null;
  return getPrisma().$transaction(async (tx) => {
    // READ permits recovering/stopping one's own intention after CREATE was revoked.
    await assertPermission(tx, actor.id, { module: "clubs", action: "READ", context: { clubId: data.clubId } });
    await lockEnrollmentOperation(tx, actor.id, data.enrollmentKey);
    const prior = await findEnrollmentOperation(tx, actor.id, data.enrollmentKey);
    if (prior && (prior.club_id !== data.clubId || (fingerprint && prior.fingerprint && prior.fingerprint !== fingerprint)))
      throw new TeamEnrollmentError("IDEMPOTENCY_CONFLICT", 409);
    if (!prior) {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
        set_config('app.reason', 'PDGLD-64: cancelación de intención de inscripción', true)`;
      await tx.team_enrollment_operations.create({ data: { actor_id: actor.id, enrollment_key: data.enrollmentKey,
        club_id: data.clubId, fingerprint, outcome: "CANCELLED" } });
    }
    return { enrollmentKey: data.enrollmentKey, clubId: data.clubId, outcome: prior?.outcome ?? "CANCELLED",
      enrollment: prior?.season_teams ? enrollmentResult(prior.season_teams, true) : null };
  }, { timeout: 15_000 });
}
