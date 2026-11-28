import "server-only";
import { z } from "zod";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { proposePlayoffBracket } from "../playoff-qualification";
import { previewPlayoffQualifiersForActor, previewPlayoffQualifiersInTransaction } from "./playoff-qualifiers";

const commandSchema = z.strictObject({ seasonId: z.uuid(), categoryId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), groupOrder: z.array(z.uuid()).max(8), operationId: z.uuid(), reason: z.string().trim().min(8).max(500) });

export async function readConfirmedPlayoffBracket(seasonId: string, categoryId: string) {
  const actor = await requireOperationalUser();
  return readConfirmedPlayoffBracketForActor(actor.id, seasonId, categoryId);
}

export async function readConfirmedPlayoffBracketForActor(actorId: string, seasonId: string, categoryId: string) {
  z.uuid().parse(seasonId); z.uuid().parse(categoryId);
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actorId, { module: "competitions", action: "READ", context: { seasonId } });
    const stages = await tx.competition_stages.findMany({ where: { season_id: seasonId, season_category_id: categoryId }, select: { id: true, format: true } });
    const stage = stages.find(item => item.format && typeof item.format === "object" && !Array.isArray(item.format) && item.format.kind === "PLAYOFF_8");
    if (!stage) return { confirmed: false as const };
    const all = await tx.brackets.findMany({ where: { stage_id: stage.id }, select: { id: true, number: true, team_a_id: true, team_b_id: true, winner_id:true, bracket_matches: { select: { id: true } } }, orderBy: { number: "asc" } });
    const entries = all.filter(entry=>entry.number<=4);
    if (entries.length !== 4 || entries.some((entry, i) => entry.number !== i + 1 || !entry.team_a_id || !entry.team_b_id)) throw Error("INVALID_SAVED_BRACKET");
    const ids = [...new Set(all.flatMap(entry => [entry.team_a_id, entry.team_b_id]).filter((id):id is string=>id!==null))];
    const teams = await tx.season_teams.findMany({ where: { season_id: seasonId, id: { in: ids } }, select: { id: true, teams: { select: { name: true } } } });
    const names = new Map(teams.map(team => [team.id, team.teams.name]));
    if (ids.some(id => !names.has(id))) throw Error("PLAYOFF_NAMES_UNAVAILABLE");
    const penaltyCandidates=all.filter(entry=>entry.team_a_id && entry.team_b_id && !entry.winner_id && entry.bracket_matches.length>0).map(entry=>({bracketId:entry.id,number:entry.number,teams:[names.get(entry.team_a_id!)!,names.get(entry.team_b_id!)!]}));
    const laterRounds=all.filter(entry=>entry.number>=5 && entry.number<=7).map(entry=>({ bracketId:entry.id,number:entry.number,teamIds:[entry.team_a_id,entry.team_b_id],teams:[entry.team_a_id?names.get(entry.team_a_id)!:"Por definir",entry.team_b_id?names.get(entry.team_b_id)!:"Por definir"],created:entry.bracket_matches.length>0 }));
    const champion=all.find(entry=>entry.number===7)?.winner_id;
    if(champion && !names.has(champion)) throw Error("PLAYOFF_NAMES_UNAVAILABLE");
    return { confirmed: true as const, champion: champion ? names.get(champion)! : null, created: entries.every(entry => entry.bracket_matches.length > 0), penaltyCandidates, laterRounds, rounds: entries.map(entry => ({ bracketId: entry.id, number: entry.number, teamIds: [entry.team_a_id!,entry.team_b_id!], teams: [names.get(entry.team_a_id!)!, names.get(entry.team_b_id!)!] })) };
  }, { isolationLevel: "RepeatableRead" });
}

export async function previewPlayoffBracket(seasonId: string, categoryId: string) {
  const actor = await requireOperationalUser();
  const qualifiers = await previewPlayoffQualifiersForActor(actor.id, seasonId, categoryId);
  const ids = [...new Set(qualifiers.qualified.map(item => item.groupId))];
  const groups = ids.map(id => ({ id, teams: qualifiers.qualified.filter(item => item.groupId === id).map(item => ({ teamId: item.teamId, rank: item.rank, unresolved: null })) }));
  const order = [...ids];
  if (order.length > 2) for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const bracket = proposePlayoffBracket(groups, order);
  if (!bracket.ok) throw Error(bracket.code);
  const names = await getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "competitions", action: "READ", context: { seasonId } });
    return tx.season_teams.findMany({ where: { season_id: seasonId, id: { in: qualifiers.qualified.map(item => item.teamId) } }, select: { id: true, teams: { select: { name: true } } } });
  });
  if (names.length !== 8) throw Error("PLAYOFF_NAMES_UNAVAILABLE");
  const byId = Object.fromEntries(names.map(item => [item.id, item.teams.name]));
  return { fingerprint: qualifiers.fingerprint, groupOrder: order, operationId: randomUUID(), rounds: bracket.rounds.quarterfinals.map(match => ({ number: match.number, teams: match.teams.map(id => byId[id]) })) };
}

/** No se confía en equipos ni cruces enviados por el navegador. */
export async function confirmPlayoffBracket(input: unknown) {
  const actor = await requireOperationalUser();
  return confirmPlayoffBracketForActor(actor.id, input);
}

/** Actor interno validado por sesión; la escritura se hace en una sola transacción. */
export async function confirmPlayoffBracketForActor(actorId: string, input: unknown) {
  const command = commandSchema.parse(input);
  const requestHash = createHash("sha256").update(JSON.stringify({ actorId, ...command })).digest("hex");
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await assertPermission(tx, actorId, { module: "competitions", action: "APPROVE", context: { seasonId: command.seasonId } });
    await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${command.seasonId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM sports_management.season_categories WHERE id=${command.categoryId}::uuid AND season_id=${command.seasonId}::uuid FOR UPDATE`;
    const qualifiers = await previewPlayoffQualifiersInTransaction(tx, actorId, command.seasonId, command.categoryId);
    if (qualifiers.fingerprint !== command.fingerprint) throw Error("PLAYOFF_STANDINGS_CHANGED");
    const groupIds = [...new Set(qualifiers.qualified.map(item => item.groupId))];
    const groups = groupIds.map(id => ({ id, teams: qualifiers.qualified.filter(item => item.groupId === id).map(item => ({ teamId: item.teamId, rank: item.rank, unresolved: null })) }));
    const proposal = proposePlayoffBracket(groups, command.groupOrder);
    if (!proposal.ok) throw Error(proposal.code);
    const category = await tx.season_categories.findFirstOrThrow({ where: { id: command.categoryId, season_id: command.seasonId }, select: { competition_rule_id: true } });
    const previous = await tx.competition_stages.findMany({ where: { season_category_id: command.categoryId }, select: { id: true, sort_order: true, format: true } });
    const existing = previous.find(stage => typeof stage.format === "object" && stage.format !== null && !Array.isArray(stage.format) && stage.format.kind === "PLAYOFF_8");
    if (existing) {
      const saved = existing.format as { operationId?: string; requestHash?: string };
      if (saved.operationId === command.operationId && saved.requestHash === requestHash) return { id: existing.id, reused: true };
      throw Error("PLAYOFF_ALREADY_CONFIRMED");
    }
    await tx.$executeRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${command.reason},true)`;
    const stage = await tx.competition_stages.create({ data: { season_id: command.seasonId, season_category_id: command.categoryId, competition_rule_id: category.competition_rule_id, name: "Liguilla", sort_order: Math.max(0, ...previous.map(s => s.sort_order)) + 1, format: { kind: "PLAYOFF_8", operationId: command.operationId, requestHash, fingerprint: command.fingerprint, groupOrder: command.groupOrder, confirmedBy: actorId, qualifiers: qualifiers.qualified } }, select: { id: true } });
    const final = await tx.brackets.create({ data: { stage_id: stage.id, season_id: command.seasonId, number: 7 }, select: { id: true } });
    const semis = [];
    for (let i = 0; i < 2; i++) semis.push(await tx.brackets.create({ data: { stage_id: stage.id, season_id: command.seasonId, number: 5 + i, next_bracket_id: final.id, next_slot: i + 1 }, select: { id: true } }));
    for (const match of proposal.rounds.quarterfinals) await tx.brackets.create({ data: { stage_id: stage.id, season_id: command.seasonId, number: match.number, team_a_id: match.teams[0], team_b_id: match.teams[1], next_bracket_id: semis[match.winnerTo - 1].id, next_slot: (match.number - 1) % 2 + 1 } });
    return { id: stage.id, reused: false };
  }, { isolationLevel: "Serializable", timeout: 30000 });
}
