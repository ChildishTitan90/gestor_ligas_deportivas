import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization, type PermissionAction } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { lockSeasonIdentityHistory } from "@/features/players/server/season-identity-history";
import { refereeMutation, blockerMessages, type RefereeMutation } from "../contract";
import type { AssignmentAssessment } from "../types";
type Tx = Prisma.TransactionClient;
export class RefereeError extends Error { constructor(public code: string, public status = 409) { super(code); } }
export type Receipt = { id: string; version: number; operationKey: string };
/** Misma incorporación vigente utilizada para provisionar el acceso a una Persona. */
export function incorporatedRefereeInLeague(leagueId: string): Prisma.refereesWhereInput {
  return { is_active: true, club_season_referees: { some: { club_affiliations: {
    status: "APPROVED", league_id: leagueId, clubs: { status: "ACTIVE" },
    seasons: { status: { not: "CLOSED" }, leagues: { is_active: true } },
  } } } };
}
export async function lockRefereeing(tx: Tx) {
  await lockAuthorization(tx, "exclusive");
  await lockSeasonIdentityHistory(tx);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(86,141)::text`;
}
export async function authorizeRefereeing(tx: Tx, actorId: string, action: PermissionAction, leagueId: string, seasonId?: string, clubId?: string, matchId?: string) {
  const grants = await assertPermission(tx, actorId, { module: "refereeing", action, context: { leagueId, ...(seasonId ? { seasonId } : {}), ...(clubId ? { clubId } : {}), ...(matchId ? { matchId } : {}) } });
  // R* permite la consulta propia, nunca un padrón completo de la liga. No se
  // decide por nombre de rol: una concesión contextual sola requiere propiedad.
  if (!grants.some(grant => !grant.contextOnly && !grant.clubId)) throw new AuthorizationError();
}
export async function readRefereeingLeagues(tx: Tx, actorId: string) {
  const grants = (await getPermissionGrants(tx, actorId, "refereeing", "READ")).filter(g => !g.contextOnly && !g.clubId);
  return tx.leagues.findMany({ where: { is_active: true, ...(grants.some(g => !g.leagueId) ? {} : { id: { in: grants.flatMap(g => g.leagueId ? [g.leagueId] : []) } }) }, select: { id: true, name: true, timezone: true }, orderBy: { name: "asc" } });
}
export async function canReadRefereeing() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await readRefereeingLeagues(tx, actor.id)).length > 0);
}
export async function assessAssignment(tx: Tx, matchId: string, refereeId: string, assignmentId: string | null = null): Promise<AssignmentAssessment> {
  const [row] = await tx.$queryRaw<{ codes: string[] }[]>`SELECT sports_management.referee_assignment_blockers(${matchId}::uuid,${refereeId}::uuid,${assignmentId}::uuid) AS codes`;
  return { availability: row.codes.includes("UNAVAILABLE") ? "UNAVAILABLE" : row.codes.some(c => ["INVALID_TIME", "UNKNOWN_AVAILABILITY"].includes(c)) ? "UNKNOWN" : "COVERED", blockers: row.codes.map(code => ({ code, message: blockerMessages[code] ?? code })) };
}
async function assertRefereeScope(tx: Tx, actorId: string, refereeId: string, action: PermissionAction) {
  const refs = await tx.club_season_referees.findMany({ where: { referee_id: refereeId }, select: { club_id: true, season_id: true, club_affiliations: { select: { league_id: true } } } });
  for (const ref of refs) await authorizeRefereeing(tx, actorId, action, ref.club_affiliations.league_id, ref.season_id, ref.club_id);
  // Global activity/availability affects assignments without a presenting club too.
  const matches = await tx.$queryRaw<{league_id:string;season_id:string;id:string}[]>`SELECT m.id,m.season_id,s.league_id FROM sports_management.matches m JOIN sports_management.seasons s ON s.id=m.season_id WHERE EXISTS(SELECT 1 FROM sports_management.referee_assignments a WHERE a.match_id=m.id AND a.referee_id=${refereeId}::uuid)`;
  for (const match of matches) await authorizeRefereeing(tx, actorId, action, match.league_id, match.season_id, undefined, match.id);
}
async function existingReceipt(tx: Tx, actorId: string, key: string) {
  const rows = await tx.$queryRaw<{ result: Receipt; input_hash: string; league_id: string; season_id: string }[]>`SELECT result,input_hash,league_id,season_id FROM sports_management.referee_operations WHERE actor_id=${actorId}::uuid AND operation_key=${key}::uuid`;
  return rows[0];
}
export async function recoverRefereeOperation(actorId: string, key: string) {
  if (!z.uuid().safeParse(key).success) throw new RefereeError("INVALID_PAYLOAD", 400);
  return getPrisma().$transaction(async tx => {
    const receipt = await existingReceipt(tx, actorId, key);
    if (!receipt) return null;
    await authorizeRefereeing(tx, actorId, "READ", receipt.league_id, receipt.season_id);
    return receipt.result;
  });
}
export async function mutateRefereeing(actorId: string, input: unknown): Promise<Receipt> {
  const parsed = refereeMutation.safeParse(input);
  if (!parsed.success) throw new RefereeError("INVALID_PAYLOAD", 400);
  const command = parsed.data;
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  try { return await getPrisma().$transaction(async tx => {
    await lockRefereeing(tx);
    const action: PermissionAction = command.kind === "approve" || command.kind === "revoke" ? "APPROVE" : command.kind === "register" && command.expectedVersion === 0 ? "CREATE" : "UPDATE";
    await authorizeRefereeing(tx, actorId, "READ", command.leagueId, command.seasonId);
    await authorizeRefereeing(tx, actorId, action, command.leagueId, command.seasonId);
    const prior = await existingReceipt(tx, actorId, command.operationKey);
    if (prior) {
      if (prior.input_hash !== hash) throw new RefereeError("OPERATION_KEY_REUSED");
      return prior.result;
    }
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: command.seasonId }, select: { league_id: true, status: true } });
    if (season.league_id !== command.leagueId) throw new AuthorizationError();
    if (season.status === "CLOSED") throw new RefereeError("CLOSED_CONTEXT");
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${command.reason},true)`;
    let result: { id: string; version: number }; let refereeId: string; let assignmentId: string | null = null;
    if (command.kind === "register") {
      await authorizeRefereeing(tx, actorId, action, command.leagueId, command.seasonId, command.clubId);
      const club = await tx.club_affiliations.findUnique({ where: { club_id_season_id: { club_id: command.clubId, season_id: command.seasonId } }, select: { status: true, clubs: { select: { status: true } } } });
      if (!club || club.status !== "APPROVED" || club.clubs.status !== "ACTIVE") throw new RefereeError("INVALID_PRESENTATION");
      // Catalogue visibility and write use the same person-in-league predicate.
      if (!(await tx.people.findFirst({ where: { id: command.personId, ...personInRefereeingLeague(command.leagueId) }, select: { id: true } }))) throw new AuthorizationError();
      const referee = await tx.referees.findUnique({ where: { person_id: command.personId }, select: { id: true, version: true, is_active: true } });
      if ((referee?.version ?? 0) !== command.expectedVersion) throw new RefereeError("STALE_VERSION");
      if (referee) await assertRefereeScope(tx, actorId, referee.id, "UPDATE");
      const saved = referee ? await tx.referees.update({ where: { id: referee.id }, data: { is_active: command.active }, select: { id: true, version: true } })
        : await tx.referees.create({ data: { person_id: command.personId, is_active: command.active }, select: { id: true, version: true } });
      const link = await tx.club_season_referees.findUnique({ where: { referee_id_season_id: { referee_id: saved.id, season_id: command.seasonId } } });
      await ensurePresentingClub(tx,saved.id,command.clubId,command.seasonId,link);
      result = await tx.referees.findUniqueOrThrow({where:{id:saved.id},select:{id:true,version:true}}); refereeId = saved.id;
    } else if (command.kind === "availability") {
      const referee = await tx.referees.findUniqueOrThrow({ where: { id: command.refereeId }, select: { version: true } });
      await assertRefereeScope(tx, actorId, command.refereeId, "UPDATE");
      if (!await tx.club_season_referees.findUnique({ where: { referee_id_season_id: { referee_id: command.refereeId, season_id: command.seasonId } } })) throw new AuthorizationError();
      if (referee.version !== command.expectedVersion) throw new RefereeError("STALE_VERSION");
      if (Date.parse(command.endsAt) <= Date.parse(command.startsAt)) throw new RefereeError("INVALID_TIME", 400);
      const interval = { referee_id: command.refereeId, starts_at: new Date(command.startsAt), ends_at: new Date(command.endsAt), is_available: command.available };
      if (command.intervalId) {
        const existing = await tx.referee_availability.findUnique({ where: { id: command.intervalId } });
        if (existing?.referee_id !== command.refereeId) throw new AuthorizationError();
        await tx.referee_availability.update({ where: { id: existing.id }, data: {starts_at:interval.starts_at,ends_at:interval.ends_at,is_available:interval.is_available} });
      } else await tx.referee_availability.create({ data: interval });
      result = await tx.referees.findUniqueOrThrow({ where: { id: command.refereeId }, select: { id: true, version: true } }); refereeId = command.refereeId;
    } else {
      const existing = command.kind === "propose" ? null : await tx.referee_assignments.findUniqueOrThrow({ where: { id: command.assignmentId } });
      const matchId = command.kind === "propose" ? command.matchId : existing!.match_id;
      refereeId = command.kind === "propose" ? command.refereeId : existing!.referee_id;
      await authorizeRefereeing(tx, actorId, action, command.leagueId, command.seasonId, undefined, matchId);
      const match = await tx.matches.findUniqueOrThrow({ where: { id: matchId }, select: { season_id: true, version: true, match_statuses: { select: { code: true } } } });
      if (match.season_id !== command.seasonId) throw new AuthorizationError();
      if (match.version !== command.expectedMatchVersion || (existing && existing.version !== (command as Extract<RefereeMutation, {kind: "approve" | "revoke"}>).expectedVersion)) throw new RefereeError("STALE_VERSION");
      if (["FINISHED", "NO_SHOW", "ADMINISTRATIVELY_RESOLVED"].includes(match.match_statuses.code)) throw new RefereeError("CLOSED_CONTEXT");
      if (command.kind === "propose") result = await tx.referee_assignments.create({ data: { match_id: matchId, referee_id: refereeId, created_by: actorId }, select: { id: true, version: true } });
      else {
        if (existing!.status === "REVOKED" || command.kind === "approve" && existing!.status !== "PROPOSED") throw new RefereeError("INVALID_TRANSITION");
        const person = await tx.referees.findUniqueOrThrow({ where: { id: refereeId }, select: { people: { select: { identity_version: true } } } });
        result = await tx.referee_assignments.update({ where: { id: existing!.id }, data: { status: command.kind === "approve" ? "APPROVED" : "REVOKED", ...(command.kind === "approve" ? { approved_by: actorId, approved_at: new Date(), approved_identity_version: person.people.identity_version } : {}) }, select: { id: true, version: true } });
      }
      assignmentId = result.id;
    }
    const receipt = { ...result, operationKey: command.operationKey };
    await tx.$executeRaw`INSERT INTO sports_management.referee_operations(actor_id,operation_key,input_hash,league_id,season_id,action,referee_id,assignment_id,reason,result)
      VALUES(${actorId}::uuid,${command.operationKey}::uuid,${hash},${command.leagueId}::uuid,${command.seasonId}::uuid,${command.kind},${refereeId}::uuid,${assignmentId}::uuid,${command.reason},${JSON.stringify(receipt)}::jsonb)`;
    return receipt;
  }, { timeout: 20000 }); } catch (error) {
    if (error instanceof RefereeError || error instanceof AuthorizationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const detail = JSON.stringify(error.meta ?? {});
      const known = Object.keys(blockerMessages).find(code => detail.includes(code));
      if (known) throw new RefereeError(known);
      if (["P2002", "P2004", "P2010", "P2034"].includes(error.code)) throw new RefereeError("CONCURRENT_OR_DEPENDENCY_CONFLICT");
    }
    throw error;
  }
}
/** Compartido por alta directa y aceptación del prerregistro. El llamador ya
 * autenticó/autorizó la operación y mantiene lockRefereeing en su transacción. */
export async function ensurePresentingClub(tx:Tx,refereeId:string,clubId:string,seasonId:string,knownLink?:{club_id:string}|null){
  const link=knownLink??await tx.club_season_referees.findUnique({where:{referee_id_season_id:{referee_id:refereeId,season_id:seasonId}},select:{club_id:true}});
  if(link){if(link.club_id!==clubId)throw new RefereeError("PRESENTING_CLUB_FIXED");return;}
  await tx.club_season_referees.create({data:{referee_id:refereeId,club_id:clubId,season_id:seasonId}});
}
export function personInRefereeingLeague(leagueId: string): Prisma.peopleWhereInput {
  return { OR: [ { users: { user_roles: { some: { league_id: leagueId } } } },
    { player_registrations: { some: { season_teams: { club_affiliations: { league_id: leagueId } } } } },
    { club_officers: { some: { club_affiliations: { league_id: leagueId } } } },
    { referees: { club_season_referees: { some: { club_affiliations: { league_id: leagueId } } } } },
  ] };
}
