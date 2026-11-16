import "server-only";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, isAuthorityPermissionModule } from "@/server/auth/authorization";
import { hashPassword } from "@/server/auth/password";
import { authorizeRefereeing, lockRefereeing, RefereeError, type Receipt } from "@/features/referees/server/service";
import { refereeAccessMutation, type RefereeAccessMutation, type RefereeAccessWorkspace } from "../referee-access-contract";
import { insertAccountForPerson } from "./account-creation";

type Tx = Prisma.TransactionClient;
const action = "referee-account-access";

export async function assertCanProvisionRefereeAccess(tx: Tx, actorId: string, leagueId: string, seasonId?: string) {
  await authorizeRefereeing(tx, actorId, "READ", leagueId, seasonId);
  await authorizeRefereeing(tx, actorId, "APPROVE", leagueId, seasonId);
  const grants = await assertPermission(tx, actorId, { module: "referee-accounts", action: "CREATE", context: { leagueId, ...(seasonId ? { seasonId } : {}) } });
  if (!grants.some(g => !g.contextOnly && !g.clubId)) throw new AuthorizationError();
}

async function target(tx: Tx, actorId: string, refereeId: string, seasonId: string) {
  if (!z.uuid().safeParse(refereeId).success || !z.uuid().safeParse(seasonId).success) throw new AuthorizationError();
  const link = await tx.club_season_referees.findUnique({
    where: { referee_id_season_id: { referee_id: refereeId, season_id: seasonId } },
    select: { club_id: true, club_affiliations: { select: { status: true, league_id: true, clubs: { select: { name: true, status: true } },
      seasons: { select: { name: true, status: true, leagues: { select: { name: true } } } } } },
      referees: { select: { person_id: true, version: true, is_active: true, people: { select: { identity_version: true, first_name: true, paternal_surname: true, maternal_surname: true } } } } },
  });
  if (!link || link.club_affiliations.status !== "APPROVED" || link.club_affiliations.clubs.status !== "ACTIVE") throw new AuthorizationError();
  const c = link.club_affiliations, r = link.referees;
  await assertCanProvisionRefereeAccess(tx, actorId, c.league_id, seasonId);
  // El código identifica únicamente el rol a conceder; nunca autoriza al actor.
  const role = await tx.roles.findUniqueOrThrow({ where: { code: "REFEREE" }, select: { id: true } });
  const permissions = await tx.role_permissions.findMany({ where: { role_id: role.id }, select: { permissions: { select: { module: true } } } });
  if (!permissions.length || permissions.some(p => isAuthorityPermissionModule(p.permissions.module))) throw new AuthorizationError();
  const [account] = await tx.$queryRaw<{ id: string; version: number; is_active: boolean; locked: boolean }[]>`
    SELECT id,version,is_active,(locked_until IS NOT NULL AND locked_until>clock_timestamp()) AS locked
    FROM sports_management.users WHERE person_id=${r.person_id}::uuid FOR UPDATE`;
  const assignments = account ? await tx.$queryRaw<{ effective: boolean }[]>`
    SELECT starts_at<=clock_timestamp() AND (ends_at IS NULL OR ends_at>clock_timestamp()) AS effective
    FROM sports_management.user_roles WHERE user_id=${account.id}::uuid AND role_id=${role.id}::uuid
      AND club_id IS NULL AND (league_id IS NULL OR league_id=${c.league_id}::uuid) FOR SHARE` : [];
  const hasAccess = assignments.some(a => a.effective);
  const blockedCode = c.seasons.status === "CLOSED" ? "CLOSED_CONTEXT" : !r.is_active ? "REFEREE_INACTIVE"
    : account && (!account.is_active || account.locked || assignments.length > 0 && !hasAccess) ? "ACCOUNT_REVIEW_REQUIRED" : null;
  const workspace: RefereeAccessWorkspace = { actorId, refereeId, seasonId, leagueId: c.league_id,
    name: c.seasons.status === "CLOSED" ? "Contexto de temporada cerrada" : [r.people.first_name, r.people.paternal_surname, r.people.maternal_surname].filter(Boolean).join(" "),
    club: c.clubs.name, season: c.seasons.name, league: c.seasons.leagues.name,
    refereeVersion: r.version, identityVersion: r.people.identity_version, blockedCode,
    account: account ? { id: account.id, version: account.version, hasAccess } : null };
  return { workspace, personId: r.person_id, roleId: role.id };
}

export async function getRefereeAccessWorkspace(refereeId: string, seasonId: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => { await lockRefereeing(tx); return (await target(tx, actor.id, refereeId, seasonId)).workspace; }, { timeout: 20000 });
}

function fingerprint(command: RefereeAccessMutation) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("REEMPLAZAR")) throw Error("AUTH_CONFIGURATION_REQUIRED");
  // El acuse verifica también la contraseña original, sin guardar su texto ni un hash atacable sin secreto.
  return createHmac("sha256", secret).update("referee-access-v1:").update(JSON.stringify(command)).digest("hex");
}

async function priorOperation(tx: Tx, actorId: string, key: string) {
  const [prior] = await tx.$queryRaw<{ input_hash: string; action: string; referee_id: string; season_id: string; result: Receipt }[]>`
    SELECT input_hash,action,referee_id,season_id,result FROM sports_management.referee_operations
    WHERE actor_id=${actorId}::uuid AND operation_key=${key}::uuid`;
  return prior;
}

export async function provisionRefereeAccess(actorId: string, input: unknown) {
  const parsed = refereeAccessMutation.safeParse(input);
  if (!parsed.success) throw new RefereeError("INVALID_PAYLOAD", 400);
  const command = parsed.data;
  await getPrisma().$transaction(async tx => { await lockRefereeing(tx); await target(tx, actorId, command.refereeId, command.seasonId); }, { timeout: 20000 });
  const passwordHash = command.kind === "create" ? await hashPassword(command.temporaryPassword) : undefined;
  try {
    return await getPrisma().$transaction(tx => provisionRefereeAccessInTransaction(tx, actorId, command, passwordHash), { timeout: 20000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new RefereeError("DUPLICATE_ACCOUNT");
    throw error;
  }
}

/** Entrada interna para transacciones y validación local; conserva toda la autorización. */
export async function provisionRefereeAccessInTransaction(tx: Tx, actorId: string, input: unknown, passwordHash?: string): Promise<Receipt> {
  const parsed = refereeAccessMutation.safeParse(input);
  if (!parsed.success) throw new RefereeError("INVALID_PAYLOAD", 400);
  const command = parsed.data, inputHash = fingerprint(command);
  await lockRefereeing(tx);
  const { workspace: w, personId, roleId } = await target(tx, actorId, command.refereeId, command.seasonId);
  const prior = await priorOperation(tx, actorId, command.operationKey);
  if (prior) {
    if (prior.action !== action || prior.input_hash !== inputHash) throw new RefereeError("OPERATION_KEY_REUSED");
    return prior.result;
  }
  if (w.blockedCode) throw new RefereeError(w.blockedCode);
  if (w.refereeVersion !== command.expectedRefereeVersion || w.identityVersion !== command.expectedIdentityVersion) throw new RefereeError("STALE_VERSION");
  if (command.kind === "create" && w.account || command.kind === "enable" && (!w.account || w.account.id !== command.userId || w.account.version !== command.expectedUserVersion)) throw new RefereeError("ACCOUNT_CHANGED");
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${command.reason},true)`;
  const user = command.kind === "create"
    ? await insertAccountForPerson(tx, { actorId, personId, username: command.username, email: command.email, passwordHash: passwordHash ?? await hashPassword(command.temporaryPassword), reason: command.reason })
    : w.account!;
  if (!w.account?.hasAccess) await tx.user_roles.create({ data: { user_id: user.id, role_id: roleId, league_id: w.leagueId }, select: { id: true } });
  // user_roles tiene su trigger de auditoría; este acuse registra la operación, no otro cambio de rol.
  const result: Receipt = { id: user.id, version: user.version, operationKey: command.operationKey };
  await tx.$executeRaw`INSERT INTO sports_management.referee_operations(actor_id,operation_key,input_hash,league_id,season_id,action,referee_id,reason,result)
    VALUES(${actorId}::uuid,${command.operationKey}::uuid,${inputHash},${w.leagueId}::uuid,${command.seasonId}::uuid,${action},${command.refereeId}::uuid,${command.reason},${JSON.stringify(result)}::jsonb)`;
  return result;
}

export async function recoverRefereeAccess(actorId: string, key: string) {
  if (!z.uuid().safeParse(key).success) throw new RefereeError("INVALID_PAYLOAD", 400);
  return getPrisma().$transaction(async tx => {
    await lockRefereeing(tx);
    const prior = await priorOperation(tx, actorId, key);
    if (!prior || prior.action !== action) return null;
    await target(tx, actorId, prior.referee_id, prior.season_id);
    return prior.result;
  }, { timeout: 20000 });
}
