import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { getPrisma } from '../../src/server/db/prisma';
import { createReportWriter, getReportPage, mutateReport, readReportOperation } from '../../src/features/match-reports/server/service';
import { getConfirmationAvailability, confirmationBlockers, type ConfirmationEffects } from '../../src/features/match-reports/server/confirmation-effects';
import { calculateForActor, calculateConfirmedReportStandingsInTransaction } from '../../src/features/standings/server/service';
import { getStandingWorkspaceForActor } from '../../src/features/standings/server/queries';
import type { ReportCommand } from '../../src/features/match-reports/contract';
import { finishConfirmedReportMatch } from '../../src/features/matches/server/report-finish';
import { openIncidentCases } from '../../src/features/match-reports/server/incident-cases';

/** Only called by the disposable match-reports runner with its real signed draft.
 * Real effects are injected into a test writer; the public writer remains gated. */
export async function verifyStandingConfirmation(f: { db: Client; actors: Record<string,string>; rule: string; group: string; season: string; teams: string[]; command: ReportCommand }) {
  const { db, actors, group, season, teams } = f;
  assert.match(db.database!, /^pdgld48_test_[a-f0-9]+$/);
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
  // Exercise the actual Preview provisioner; no extra grants or RLS policies.
  const actualPrivileges = (await q(`SELECT
    has_column_privilege('gestor_ligas_preview','sports_management.match_results','match_id','INSERT') result_insert,
    has_column_privilege('gestor_ligas_preview','sports_management.match_reports','confirmed_at','UPDATE') report_confirm,
    has_column_privilege('gestor_ligas_preview','sports_management.standing_versions','group_id','INSERT') standing_insert`))[0];
  assert.deepEqual(actualPrivileges,{result_insert:true,report_confirm:true,standing_insert:true});
  const rule = (await q('INSERT INTO sports_management.competition_rules(season_id,version_number) SELECT $1,max(version_number)+1 FROM sports_management.competition_rules WHERE season_id=$1 RETURNING id',[season]))[0].id;
  for (const [key,value] of Object.entries({ points: { win:3, draw:1, loss:0 }, tieBreakers:['GOAL_DIFFERENCE','GOALS_FOR'] })) {
    await q('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by) VALUES($1,$2,$3,$4) ON CONFLICT(competition_rule_id,parameter_key) DO UPDATE SET parameter_value=excluded.parameter_value,validated_by=excluded.validated_by,requires_validation=false', [rule,key,JSON.stringify(value),actors.lector]);
  }
  await q("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[rule,actors.lector]);
  await q('UPDATE sports_management.season_categories SET competition_rule_id=$2 WHERE id=(SELECT season_category_id FROM sports_management.groups WHERE id=$1)',[group,rule]);
  const source = (await q('SELECT matchday_id FROM sports_management.matches WHERE id=$1',[f.command.matchId]))[0];
  const input = { groupId:group, matchdayId:source.matchday_id as string };
  const base = await calculateForActor(actors.lector,input);
  assert.ok(base.data.rows.every(r=>r.played===0&&r.points===0));
  // Existing later cut must also be refreshed after this earlier report is confirmed.
  const later = (await q("INSERT INTO sports_management.matchdays(season_id,number,start_date,end_date) SELECT $1,max(number)+1,'2026-12-06'::date,'2026-12-06'::date FROM sports_management.matchdays WHERE season_id=$1 RETURNING id",[season]))[0].id;
  await calculateForActor(actors.lector,{groupId:group,matchdayId:later});
  await assert.rejects(calculateForActor(actors.capturista,input),/FORBIDDEN/,'capture never gains general competitions UPDATE');
  const filters = { competitionId:(await q('SELECT league_id FROM sports_management.seasons WHERE id=$1',[season]))[0].league_id, seasonId:season, categoryId:(await q('SELECT season_category_id FROM sports_management.groups WHERE id=$1',[group]))[0].season_category_id, groupId:group };
  const snapshot = () => q(`SELECT
    (SELECT row_to_json(r) FROM sports_management.match_reports r WHERE match_id=$1) report,
    (SELECT row_to_json(m) FROM sports_management.matches m WHERE id=$1) match,
    (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM sports_management.match_events e JOIN sports_management.match_reports r ON r.id=e.match_report_id WHERE r.match_id=$1) events,
    (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM sports_management.lineups l JOIN sports_management.match_reports r ON r.id=l.match_report_id WHERE r.match_id=$1) lineups,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM sports_management.player_period_participations p JOIN sports_management.lineups l ON l.id=p.lineup_id JOIN sports_management.match_reports r ON r.id=l.match_report_id WHERE r.match_id=$1) periods,
    (SELECT count(*)::int FROM sports_management.match_results) results,
    (SELECT count(*)::int FROM sports_management.match_status_history) history,
    (SELECT count(*)::int FROM sports_management.standing_versions) versions,
    (SELECT count(*)::int FROM sports_management.standing_entries) entries,
    (SELECT count(*)::int FROM sports_management.match_report_syncs) receipts,
    (SELECT count(*)::int FROM sports_management.disciplinary_cases) cases,
    (SELECT count(*)::int FROM sports_management.audit_logs) audits`,[f.command.matchId]);
  const command = { ...structuredClone(f.command), kind:'confirm' as const, operationId:randomUUID() };
  const adapters: ConfirmationEffects = { finishMatch:finishConfirmedReportMatch, openIncidentCases };
  assert.equal(getConfirmationAvailability().available,true);
  assert.ok(!confirmationBlockers.some(b=>b.includes('PDGLD-29')));
  const before = await snapshot();
  await assert.rejects(getPrisma().$transaction(tx=>calculateConfirmedReportStandingsInTransaction(tx,actors.capturista,(before[0].report as {id:string}).id)),/STANDINGS_SERIALIZABLE_REQUIRED/);
  await assert.rejects(createReportWriter(()=>adapters)(actors.capturista,{...command,draft:{...command.draft,incidents:'Cambio no guardado'}}),/CONFIRMATION_REQUIRES_SAVED_DRAFT/);
  assert.deepEqual(await snapshot(),before);
  const fault = createReportWriter(()=>({...adapters, async openIncidentCases(tx,c) {
    await adapters.openIncidentCases(tx,c);
    assert.equal((await tx.match_reports.findUniqueOrThrow({where:{id:c.reportId}})).status,'CONFIRMED');
    assert.equal(await tx.match_results.count({where:{match_id:c.matchId}}),1);
    assert.equal(await tx.standing_versions.count({where:{group_id:group}}),4);
    throw Error('PDGLD152_CONTROLLED_ROLLBACK');
  }}));
  await assert.rejects(fault(actors.capturista,command),/PDGLD152_CONTROLLED_ROLLBACK/);
  assert.deepEqual(await snapshot(),before,'rollback restores report/events/lineups/result/match/history/table/incident/audit/receipt');
  assert.equal((await readReportOperation(actors.capturista,command.matchId,command.operationId)).status,'UNKNOWN');
  const writer = mutateReport;
  await assert.rejects(writer(actors.capturistaAjeno,command),/FORBIDDEN/);
  // Race the SAME operation before any successful commit; all replies must agree.
  const replies = await Promise.all(Array.from({length:3},()=>writer(actors.capturista,command,'sync')));
  for (const reply of replies) assert.deepEqual(reply,replies[0]);
  assert.equal(replies[0].status,'CONFIRMED');
  await assert.rejects(writer(actors.arbitro,command),/OPERATION_KEY_REUSED/,'another authorized actor cannot reuse the receipt');
  assert.deepEqual(await writer(actors.capturista,command),replies[0],'sequential resend returns original receipt');
  const reopened = await getReportPage(actors.capturista,command.matchId);
  assert.equal(reopened.report.status,'CONFIRMED');
  assert.ok(reopened.report.confirmedAt);
  assert.equal(reopened.match.status.code,'FINISHED');
  assert.equal(reopened.match.status.captureAllowed,false);
  const after = await snapshot();
  assert.equal(after[0].results,before[0].results+1);
  assert.equal(after[0].history,before[0].history+1);
  assert.equal(after[0].versions,before[0].versions+2,'one version per affected existing cut');
  assert.equal(after[0].receipts,before[0].receipts+1);
  assert.equal(after[0].cases,before[0].cases+1);
  const current = await calculateForActor(actors.lector,input);
  assert.equal(current.reused,true,'readback calculation reuses exactly the confirmation fingerprint');
  const home = current.data.rows.find(r=>r.teamId===teams[0])!, away=current.data.rows.find(r=>r.teamId===teams[1])!;
  assert.deepEqual([home.played,home.won,home.scoreFor,home.scoreAgainst,home.points],[1,1,1,0,3]);
  assert.deepEqual([away.played,away.lost,away.scoreFor,away.scoreAgainst,away.points],[1,1,0,1,0]);
  assert.equal(current.data.statistics.find(r=>r.teamId===teams[0])!.observedDirectDismissals,1);
  assert.equal(current.data.statistics.find(r=>r.teamId===teams[1])!.observedCautions,1);
  assert.equal(current.data.playerStatistics.players.reduce((n,p)=>n+p.goals,0),1);
  assert.equal(current.data.events.length,command.draft.events.length);
  const workspace = await getStandingWorkspaceForActor(actors.lector,filters);
  assert.equal(workspace.table?.version,2);
  assert.equal(workspace.table?.rows.find(r=>r.teamId===teams[0])?.points,3);
  await assert.rejects(writer(actors.capturista,{...command,draft:{...command.draft,remarks:'otra intención'}}),/OPERATION_KEY_REUSED/);
  await assert.rejects(writer(actors.capturista,{...command,operationId:randomUUID()}),/MATCH_STATE_BLOCKED/);
  assert.deepEqual(await snapshot(),after,'replay and rejected corrections do not duplicate statistics or any effects');
  console.log('PDGLD-152/85: cierre oficial, clasificación, concurrencia, reenvío y rollback comprobados con Preview.');
}
