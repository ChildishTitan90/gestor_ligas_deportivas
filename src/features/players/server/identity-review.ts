import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import { adjacentBirthDates } from "../identity-rules";
import { findPossibleIdentityMatches, identityFromPerson, personIdentitySelect } from "./identity-matches";
import { lockPlayerTeamContext, PlayerRegistrationError } from "./access";

export async function canReviewPlayerIdentity() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await getPermissionGrants(tx, actor.id, "players", "APPROVE")).length > 0);
}
async function snapshot(tx: Prisma.TransactionClient, actorId: string, registrationId: string) {
  const row = await tx.player_registrations.findUnique({ where: { id: registrationId }, select: {
    id: true, season_team_id: true, status: true, withdrawn_at: true, identity_review_status: true,
    people: { select: { ...personIdentitySelect, identity_version: true } } } });
  if (!row) throw new AuthorizationError();
  const { row: context } = await lockPlayerTeamContext(tx, actorId, row.season_team_id, "APPROVE");
  await lockPlayerTeamContext(tx, actorId, row.season_team_id, "READ");
  if (context.seasonStatus === "CLOSED" || row.withdrawn_at || row.status !== "INELIGIBLE") throw new PlayerRegistrationError("CONTEXT_NOT_AVAILABLE");
  const identity = identityFromPerson(row.people);
  if (!identity.birthDate) throw new PlayerRegistrationError("CONTEXT_NOT_AVAILABLE");
  for (const date of adjacentBirthDates(identity.birthDate))
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:birth:${date}`},0))::text`;
  const ids = await findPossibleIdentityMatches(tx, identity, row.people.id);
  const people = await tx.people.findMany({ where: { id: { in: [row.people.id, ...ids] } },
    select: { ...personIdentitySelect, identity_version: true }, orderBy: { id: "asc" } });
  // Bloquear versiones de todas las identidades incluidas en la decisión.
  for (const person of people) await tx.$queryRaw`SELECT id FROM sports_management.people WHERE id=${person.id}::uuid FOR SHARE`;
  const locked = await tx.people.findMany({ where: { id: { in: people.map(p => p.id) } },
    select: { ...personIdentitySelect, identity_version: true }, orderBy: { id: "asc" } });
  if (locked.some((p,i) => p.identity_version !== people[i].identity_version) || locked.find(p => p.id === row.people.id)?.identity_version !== row.people.identity_version)
    throw new PlayerRegistrationError("RETRY_REQUIRED");
  let outsideScope = false;
  const candidates = [];
  for (const person of locked.filter(p => p.id !== row.people.id)) {
    const registrations = await tx.player_registrations.findMany({ where: { person_id: person.id }, select: { season_team_id: true } });
    let allowed = false;
    for (const registration of registrations) {
      try { await lockPlayerTeamContext(tx, actorId, registration.season_team_id, "APPROVE");
        await lockPlayerTeamContext(tx, actorId, registration.season_team_id, "READ"); allowed = true; break;
      } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    if (allowed) candidates.push({ name: [person.first_name,person.paternal_surname,person.maternal_surname].filter(Boolean).join(" "), birthDate: person.birth_date?.toISOString().slice(0,10) ?? "" });
    else outsideScope = true;
  }
  await tx.$queryRaw`SELECT id FROM sports_management.player_registrations WHERE id=${registrationId}::uuid FOR UPDATE`;
  const identityFingerprint = createHash("sha256").update(JSON.stringify(locked.map(p => [p.id,p.identity_version]))).digest("hex");
  const last = await tx.audit_logs.findFirst({where:{entity_id:registrationId,action:"PLAYER_IDENTITY_REVIEWED"},orderBy:[{occurred_at:"desc"},{id:"desc"}],select:{id:true}});
  const fingerprint = createHash("sha256").update(`${identityFingerprint}:${last?.id ?? "initial"}`).digest("hex");
  return { row, fingerprint, identityFingerprint, candidates, outsideScope, name: [identity.firstName,identity.paternalSurname,identity.maternalSurname].filter(Boolean).join(" "), birthDate: identity.birthDate };
}
export async function reviewDetailForActor(actorId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new AuthorizationError();
  return getPrisma().$transaction(async tx => {
    const data = await snapshot(tx, actorId, id);
    return { registrationId: id, name: data.name, birthDate: data.birthDate, fingerprint: data.fingerprint,
      candidates: data.candidates, outsideScope: data.outsideScope, pending: data.row.identity_review_status === "REQUIRED" };
  }, { timeout: 15000 });
}
export async function getIdentityReviewDetail(id: string) { return reviewDetailForActor((await requireOperationalUser()).id,id); }
export async function getIdentityReviewQueue() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const grants = await getPermissionGrants(tx,actor.id,"players","APPROVE");
    if (!grants.length) throw new AuthorizationError();
    const scope: Prisma.clubsWhereInput = grants.some(g => !g.contextOnly && !g.clubId && !g.leagueId) ? {} : {
      OR: grants.flatMap((g): Prisma.clubsWhereInput[] => g.clubId ? [{ id:g.clubId, ...(g.leagueId ? {league_id:g.leagueId}: {}) }] : g.leagueId ? [{league_id:g.leagueId}] : []) };
    const rows = await tx.player_registrations.findMany({ where: { identity_review_status:"REQUIRED", status:"INELIGIBLE", withdrawn_at:null,
      season_teams:{ teams:{clubs:scope}, club_affiliations:{seasons:{status:{not:"CLOSED"}}} } },
      select:{id:true,season_team_id:true,people:{select:{first_name:true,paternal_surname:true}},season_teams:{select:{teams:{select:{name:true}}}}}, orderBy:{id:"asc"} });
    const result = [];
    for (const row of rows) {
      try { await lockPlayerTeamContext(tx,actor.id,row.season_team_id,"APPROVE"); await lockPlayerTeamContext(tx,actor.id,row.season_team_id,"READ"); }
      catch(error) { if(error instanceof AuthorizationError) continue; throw error; }
      result.push({id:row.id,name:`${row.people.first_name} ${row.people.paternal_surname}`,team:row.season_teams.teams.name});
    }
    return result;
  });
}
export async function decideIdentityReviewForActor(actorId: string, id: string, input: unknown) {
  const body = z.strictObject({ fingerprint:z.string().regex(/^[a-f0-9]{64}$/), reason:z.enum(["DISTINCT_IDENTITIES_CONFIRMED","DOCUMENTS_INSUFFICIENT"]) }).safeParse(input);
  if(!body.success || !z.uuid().safeParse(id).success) throw new PlayerRegistrationError("VALIDATION_ERROR",400);
  return getPrisma().$transaction(async tx => {
    const data = await snapshot(tx,actorId,id);
    await tx.$queryRaw`SELECT id FROM sports_management.player_registrations WHERE id=${id}::uuid FOR UPDATE`;
    const prior = await tx.audit_logs.findFirst({where:{entity_id:id,action:"PLAYER_IDENTITY_REVIEWED",new_data:{path:["fingerprint"],equals:body.data.fingerprint}},orderBy:{occurred_at:"desc"}});
    if(prior && (prior.new_data as {decision?:string})?.decision === body.data.reason) return {confirmed:true};
    if(data.fingerprint !== body.data.fingerprint) throw new PlayerRegistrationError("REGISTRATION_CONFLICT");
    if(data.outsideScope) throw new AuthorizationError();
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','PDGLD-98: revisión motivada de identidad; sin aprobación deportiva',true)`;
    await tx.player_registrations.update({where:{id},data:{identity_review_status:body.data.reason === "DISTINCT_IDENTITIES_CONFIRMED" ? "NOT_REQUIRED":"REQUIRED"}});
    await tx.audit_logs.create({data:{user_id:actorId,action:"PLAYER_IDENTITY_REVIEWED",table_name:"player_registrations",entity_id:id,
      reason:body.data.reason,new_data:{fingerprint:data.fingerprint,identityFingerprint:data.identityFingerprint,decision:body.data.reason}}});
    return {confirmed:true};
  },{timeout:15000});
}
export async function hasCurrentIdentityResolution(tx:Prisma.TransactionClient,id:string,personId:string,matches:string[]) {
  const rows=await tx.people.findMany({where:{id:{in:[personId,...matches]}},select:{id:true,identity_version:true},orderBy:{id:"asc"}});
  const hash=createHash("sha256").update(JSON.stringify(rows.map(p=>[p.id,p.identity_version]))).digest("hex");
  const last=await tx.audit_logs.findFirst({where:{entity_id:id,action:"PLAYER_IDENTITY_REVIEWED"},orderBy:[{occurred_at:"desc"},{id:"desc"}],select:{new_data:true}});
  const data=last?.new_data as {identityFingerprint?:string;decision?:string}|undefined;
  return data?.identityFingerprint === hash && data.decision === "DISTINCT_IDENTITIES_CONFIRMED";
}
export async function decideIdentityReview(id:string,input:unknown,expectedActor?:string) {
  const actor=await requireOperationalUser();
  if(expectedActor && actor.id !== expectedActor) throw new AuthorizationError();
  return decideIdentityReviewForActor(actor.id,id,input);
}
