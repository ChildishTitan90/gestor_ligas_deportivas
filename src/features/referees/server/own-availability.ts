import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, getActorPermissionGrants, grantCoversContext, type PermissionGrant } from "@/server/auth/authorization";
import { readOwnReferee } from "@/server/auth/authorization-domain";
import { availabilityMutation } from "../contract";
import type { OwnAvailabilityContext, OwnAvailabilityWorkspace } from "../own-availability-contract";
import { lockRefereeing, RefereeError, saveRefereeAvailability, throwRefereeFailure, type Receipt } from "./service";

type Tx = Prisma.TransactionClient;
const isOwnGrant = (g: PermissionGrant, action: "READ" | "UPDATE") => g.module === "refereeing" && g.action === action && g.contextOnly && !g.clubId;
function covers(grants: PermissionGrant[], context: OwnAvailabilityContext, action: "READ" | "UPDATE") {
  return grants.some(g => isOwnGrant(g, action) && grantCoversContext(g, { leagueId: context.leagueId, seasonId: context.seasonId, clubIds: [context.clubId], hasContext: true }));
}
async function scope(tx: Tx, actorId: string) {
  const grants = await getActorPermissionGrants(tx, actorId);
  if (!grants.some(g => isOwnGrant(g, "READ"))) throw new AuthorizationError();
  const referee = await readOwnReferee(tx, actorId);
  const links = referee ? await tx.club_season_referees.findMany({
    where: { referee_id: referee.id, club_affiliations: { status: "APPROVED", clubs: { status: "ACTIVE" }, seasons: { status: { not: "CLOSED" }, leagues: { is_active: true } } } },
    select: { club_id: true, season_id: true, club_affiliations: { select: { league_id: true, clubs: { select: { name: true } }, seasons: { select: { name: true, leagues: { select: { name: true, timezone: true } } } } } } },
    orderBy: [{ season_id: "asc" }, { club_id: "asc" }],
  }) : [];
  const allContexts: OwnAvailabilityContext[] = links.map(l => ({ clubId: l.club_id, club: l.club_affiliations.clubs.name,
    seasonId: l.season_id, season: l.club_affiliations.seasons.name, leagueId: l.club_affiliations.league_id,
    league: l.club_affiliations.seasons.leagues.name, timezone: l.club_affiliations.seasons.leagues.timezone }));
  return { grants, referee, allContexts, contexts: allContexts.filter(c => covers(grants, c, "READ")) };
}
export async function canReadOwnRefereeAvailability() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await getActorPermissionGrants(tx, actor.id)).some(g => isOwnGrant(g, "READ")), { timeout: 20000 });
}
export async function getOwnAvailabilityWorkspace(leagueId = "", seasonId = "") {
  return getOwnAvailabilityWorkspaceForActor((await requireOperationalUser()).id, leagueId, seasonId);
}
export function getOwnAvailabilityWorkspaceForActor(actorId: string, leagueId = "", seasonId = "") {
  return getPrisma().$transaction(tx => readOwnAvailabilityWorkspace(tx, actorId, leagueId, seasonId), { timeout: 20000 });
}
/** Entrada interna de lectura autorizada; no depende de tener partidos asignados. */
export async function readOwnAvailabilityWorkspace(tx: Tx, actorId: string, leagueId = "", seasonId = "", asOf = new Date()): Promise<OwnAvailabilityWorkspace> {
  const s = await scope(tx, actorId);
  const selected = s.contexts.find(c => c.leagueId === leagueId && c.seasonId === seasonId);
  if ((leagueId || seasonId) && !selected) throw new AuthorizationError();
  const blockedCode = s.referee && !s.referee.active ? "INACTIVE" : s.allContexts.some(c => !covers(s.grants, c, "READ") || !covers(s.grants, c, "UPDATE")) ? "SHARED_AVAILABILITY_SCOPE" : null;
  const intervals = selected && s.referee ? await tx.referee_availability.findMany({ where: { referee_id: s.referee.id, ends_at: { gt: asOf } }, select: { id: true, referee_id: true, starts_at: true, ends_at: true, is_available: true }, orderBy: [{ starts_at: "asc" }, { id: "asc" }] }) : [];
  return { actorId, referee: s.referee, contexts: s.contexts, leagueId, seasonId, blockedCode,
    canUpdate: !!selected && !!s.referee?.active && !blockedCode,
    intervals: intervals.map(i => ({ id: i.id, refereeId: i.referee_id, startsAt: i.starts_at.toISOString(), endsAt: i.ends_at.toISOString(), available: i.is_available })) };
}
export async function mutateOwnAvailability(actorId: string, input: unknown): Promise<Receipt> {
  try { return await getPrisma().$transaction(tx => mutateOwnAvailabilityInTransaction(tx, actorId, input), { timeout: 20000 }); }
  catch (error) { throwRefereeFailure(error); }
}
export async function mutateOwnAvailabilityInTransaction(tx: Tx, actorId: string, input: unknown): Promise<Receipt> {
  const parsed = availabilityMutation.safeParse(input);
  if (!parsed.success) throw new RefereeError("INVALID_PAYLOAD", 400);
  const command = parsed.data, hash = createHash("sha256").update(`own-availability:${JSON.stringify(command)}`).digest("hex");
  await lockRefereeing(tx);
  const s = await scope(tx, actorId);
  if (!s.referee || s.referee.id !== command.refereeId) throw new AuthorizationError();
  const selected = s.contexts.find(c => c.leagueId === command.leagueId && c.seasonId === command.seasonId);
  if (!selected || !covers(s.grants, selected, "UPDATE")) throw new AuthorizationError();
  if (s.allContexts.some(c => !covers(s.grants, c, "READ") || !covers(s.grants, c, "UPDATE"))) throw new RefereeError("SHARED_AVAILABILITY_SCOPE", 403);
  const [prior] = await tx.$queryRaw<{ input_hash: string; result: Receipt }[]>`SELECT input_hash,result FROM sports_management.referee_operations WHERE actor_id=${actorId}::uuid AND operation_key=${command.operationKey}::uuid`;
  if (prior) { if (prior.input_hash !== hash) throw new RefereeError("OPERATION_KEY_REUSED"); return prior.result; }
  if (!s.referee.active) throw new RefereeError("INACTIVE");
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${command.reason},true)`;
  // Mismas reglas, versión, guards SQL y auditoría que la corrección de Comisión.
  const result = await saveRefereeAvailability(tx, command);
  const receipt = { ...result, operationKey: command.operationKey };
  await tx.$executeRaw`INSERT INTO sports_management.referee_operations(actor_id,operation_key,input_hash,league_id,season_id,action,referee_id,reason,result)
    VALUES(${actorId}::uuid,${command.operationKey}::uuid,${hash},${command.leagueId}::uuid,${command.seasonId}::uuid,'availability',${s.referee.id}::uuid,${command.reason},${JSON.stringify(receipt)}::jsonb)`;
  return receipt;
}
export async function recoverOwnAvailability(actorId: string, key: string) {
  if (!z.uuid().safeParse(key).success) throw new RefereeError("INVALID_PAYLOAD", 400);
  return getPrisma().$transaction(async tx => {
    const s = await scope(tx, actorId);
    const [prior] = await tx.$queryRaw<{ referee_id: string; league_id: string; season_id: string; action: string; result: Receipt }[]>`SELECT referee_id,league_id,season_id,action,result FROM sports_management.referee_operations WHERE actor_id=${actorId}::uuid AND operation_key=${key}::uuid`;
    if (!prior || prior.action !== "availability") return null;
    if (!s.referee || prior.referee_id !== s.referee.id) throw new AuthorizationError();
    const grants = await assertPermission(tx, actorId, { module: "refereeing", action: "READ", context: { leagueId: prior.league_id, seasonId: prior.season_id } });
    if (!grants.some(g => isOwnGrant(g, "READ"))) throw new AuthorizationError();
    return prior.result;
  }, { timeout: 20000 });
}
