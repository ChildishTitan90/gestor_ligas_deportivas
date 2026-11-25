import { readStoredProposalForActor } from "../../src/features/scheduling/server/stored-proposal";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../../src/server/auth/password";
import test from "node:test";
import { getPrisma } from "../../src/server/db/prisma";
import { AuthorizationError } from "../../src/server/auth/authorization";
import { changeProposalReviewForActor, saveScheduleAdjustmentForActor, validateAdjustment } from "../../src/features/scheduling/server/adjustment";

assert.ok(process.env.DATABASE_URL, "Configura una base temporal para PDGLD-138");
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.protocol, "postgresql:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.search + target.hash, "");
if (process.env.PDGLD25_HTTP === "1") {
  assert.equal(target.port, "55425");
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
} else {
  assert.equal(`${target.port}${target.pathname}`, process.env.GITHUB_ACTIONS === "true" ? "5432/gestor_ligas_ci" : "55425/pdgld25");
}

test("el ajuste de borrador revalida la cancha y registra una sola escritura auditada", async () => {
  const db = getPrisma();
  try {
    const tag = randomUUID();
    const runHttp = process.env.PDGLD25_HTTP === "1";
    const password = randomBytes(24).toString("hex");
    const passwordHash = runHttp ? await hashPassword(password) : "fixture-only";
    const date = new Date("2026-11-14");
    const at = (time: string) => new Date(`2026-11-14T${time}:00Z`);
    const fixture = await db.$transaction(async tx => {
      const league = await tx.leagues.create({ data: { name: tag, timezone: "UTC" } });
      const sport = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
      async function account(code: string, leagueId: string) {
        const name = randomUUID();
        const role = await tx.roles.findUniqueOrThrow({ where: { code } });
        const person = await tx.people.create({ data: { first_name: "Fixture", paternal_surname: name } });
        const user = await tx.users.create({ data: {
          person_id: person.id, username: name, email: `${name}@example.test`, password_hash: passwordHash,
          must_change_password: false,
        } });
        await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true), set_config('app.reason', 'PDGLD-138 fixture', true)`;
        await tx.user_roles.create({ data: { user_id: user.id, role_id: role.id, league_id: leagueId } });
        return user.id;
      }
      const outside = await tx.leagues.create({ data: { name: `Externa ${tag}` } });
      const outsider = await account("SCHEDULER", outside.id);
      const scheduler = await account("SCHEDULER", league.id);
      const reviewer = await account("EXECUTIVE_PRESIDENT", league.id);
      const season = await tx.seasons.create({ data: {
        league_id: league.id, sport_id: sport.id, name: tag, start_date: date, end_date: new Date("2026-11-21"),
      } });
      const rule = await tx.competition_rules.create({ data: { season_id: season.id, version_number: 1 } });
      await tx.competition_rule_parameters.create({ data: {
        competition_rule_id: rule.id, parameter_key: "calendar",
        parameter_value: { rounds: 1, matchDurationMinutes: 60, complexOnlyFinalRounds: 0 },
      } });
      await tx.competition_rules.update({ where: { id: rule.id }, data: {
        status: "APPROVED", approved_by: scheduler, approved_at: new Date(),
      } });
      const catalog = await tx.categories.create({ data: { league_id: league.id, sport_id: sport.id, name: tag } });
      const category = await tx.season_categories.create({ data: {
        season_id: season.id, category_id: catalog.id, competition_rule_id: rule.id, hierarchy_order: 1,
        type: "OPEN", eligibility_pending: true, competition_format: "GENERAL_TABLE",
      } });
      const group = await tx.groups.create({ data: { season_id: season.id, season_category_id: category.id, name: "General" } });
      const day = await tx.matchdays.create({ data: { season_id: season.id, number: 1, start_date: date, end_date: date } });
      async function enroll() {
        const name = randomUUID();
        const club = await tx.clubs.create({ data: { league_id: league.id, name, reference_number: name } });
        await tx.club_affiliations.create({ data: {
          season_id: season.id, club_id: club.id, league_id: league.id,
          reference_number: name, uniform_colors: "Azul", requested_by: scheduler,
        } });
        const team = await tx.teams.create({ data: { club_id: club.id, name, reference_number: name } });
        return tx.season_teams.create({ data: {
          season_id: season.id, club_id: club.id, team_id: team.id, group_id: group.id, status: "ACTIVE",
        } });
      }
      const home = await enroll();
      const away = await enroll();
      const venue = await tx.venues.create({ data: {
        league_id: league.id, code: "UNIDAD", name: "Unidad", address: "Domicilio sintético",
        is_league_sports_complex: true, match_duration_minutes: 60, buffer_minutes: 15,
      } });
      await tx.venue_availability.create({ data: {
        venue_id: venue.id, type: "AVAILABLE", starts_at: at("10:00"), ends_at: at("15:00"),
      } });
      const proposal = await tx.schedule_proposals.create({ data: {
        season_id: season.id, matchday_id: day.id, competition_rule_id: rule.id, created_by: scheduler,
      } });
      const match = await tx.matches.create({ data: {
        season_id: season.id, matchday_id: day.id, schedule_proposal_id: proposal.id, group_id: group.id,
        home_team_id: home.id, away_team_id: away.id, number: "001",
      } });
      return { scheduler, reviewer, outsider, venue, proposal, match };
    });

    const { scheduler, reviewer, outsider, venue, proposal, match } = fixture;
    const seasonVersion = (await db.seasons.findUniqueOrThrow({ where: { id: match.season_id } })).version;
    const generated = {
      formatVersion: 1, groupId: match.group_id,
      categoryId: (await db.groups.findUniqueOrThrow({ where: { id: match.group_id } })).season_category_id,
      seasonVersion, ruleId: proposal.competition_rule_id, ruleVersion: 1, timezone: "UTC",
      requestHash: "conservar-hash-de-generación", state: "DRAFT_PROPOSAL", reservesResources: false,
      matches: [{
        matchdayId: match.matchday_id, round: 1, home: match.home_team_id, away: match.away_team_id,
        venueId: venue.id, start: at("11:00").toISOString(), end: at("12:00").toISOString(),
        reservedUntil: at("12:15").toISOString(), preference: 0,
      }],
      byes: [],
    };
    const draft = await db.schedule_proposals.create({ data: {
      season_id: match.season_id, matchday_id: match.matchday_id,
      competition_rule_id: proposal.competition_rule_id, created_by: scheduler, parameters: generated,
    } });
    const detail = await readStoredProposalForActor(scheduler, { proposalId: draft.id });
    assert.equal(detail.code, "PROPOSAL_DETAIL");
    if (detail.code !== "PROPOSAL_DETAIL") throw Error("Falta detalle");
    assert.equal(detail.authorId, scheduler);
    assert.equal(detail.proposal.matches[0].reservedUntil, generated.matches[0].reservedUntil);
    assert.ok(!JSON.stringify(detail).includes(generated.requestHash));
    await assert.rejects(readStoredProposalForActor(outsider, { proposalId: draft.id }), AuthorizationError);
    const reason = "Ajuste de horario de prueba";
    const request = { proposalId: proposal.id, matchId: match.id, expectedVersion: match.version,
      startsAt: "2026-11-14T11:00", venueId: venue.id, reason };
    const rollbackSanction = new Error("ROLLBACK_SANCTION");
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.user_id',${scheduler},true),set_config('app.reason','Sanción de prueba',true)`;
      const sanctionType = await tx.sanction_types.findUniqueOrThrow({where:{code:"TIME"}});
      const draftRule = await tx.competition_rules.create({data:{season_id:match.season_id,version_number:2}});
      const sanctionArticle = await tx.regulation_articles.create({data:{competition_rule_id:draftRule.id,number:`S-${tag}`,description:"Prueba",sanction_type_id:sanctionType.id}});
      const disciplinaryCase = await tx.disciplinary_cases.create({data:{season_id:match.season_id,reference_number:tag,opened_by:scheduler,description:"Prueba"}});
      const ruling = await tx.disciplinary_rulings.create({data:{case_id:disciplinaryCase.id,version_number:1,decided_by:scheduler,decision:"Prueba",reason:"Prueba"}});
      await tx.sanctions.create({data:{ruling_id:ruling.id,article_id:sanctionArticle.id,sanction_type_id:sanctionType.id,season_team_id:match.home_team_id,starts_at:at("11:30"),ends_at:at("12:30"),blocks_participation:true}});
      assert.equal((await validateAdjustment(tx,scheduler,request)).code,"TEAM_SANCTION");
      assert.equal((await validateAdjustment(tx,scheduler,{...request,startsAt:"2026-11-14T10:30"})).code,"VENUE_OPTIONS");
      assert.equal((await validateAdjustment(tx,scheduler,{...request,startsAt:"2026-11-14T12:30"})).code,"VENUE_OPTIONS");
      throw rollbackSanction;
    }),error=>error===rollbackSanction);
    await assert.rejects(saveScheduleAdjustmentForActor(outsider, request), AuthorizationError);
    const review = { proposalId: proposal.id, expectedVersion: proposal.version, reason: "Revisión operativa de prueba" };
    assert.equal((await changeProposalReviewForActor(reviewer, { ...review, operation: "approve" })).code, "INVALID_PROPOSAL_TRANSITION");
    assert.equal((await changeProposalReviewForActor(scheduler, { ...review, operation: "submit" })).code, "INCOMPLETE_PROPOSAL_MATCH");
    assert.equal((await saveScheduleAdjustmentForActor(scheduler, { ...request, startsAt: "2026-11-14T14:00" })).code, "NO_ELIGIBLE_VENUES");
    const outcomes = await Promise.all([
      saveScheduleAdjustmentForActor(scheduler, request),
      saveScheduleAdjustmentForActor(scheduler, { ...request, startsAt: "2026-11-14T12:00" }),
    ]);
    assert.equal(outcomes.filter(result => result.code === "ADJUSTMENT_SAVED").length, 1);
    assert.ok(outcomes.some(result => result.code === "STALE_MATCH" || result.code === "ADJUSTMENT_CONFLICT"));
    const persisted = await db.matches.findUniqueOrThrow({ where: { id: match.id }, include: { match_statuses: true } });
    assert.equal(persisted.match_statuses.code, "DRAFT");
    assert.equal(persisted.version, match.version + 1);
    assert.equal(persisted.venue_id, venue.id);
    assert.equal(persisted.reserved_until!.getTime() - persisted.ends_at!.getTime(), 15 * 60_000);
    assert.equal(await db.venue_reservations.count({ where: { match_id: match.id } }), 0);
    assert.equal(await db.audit_logs.count({ where: { entity_id: match.id, user_id: scheduler, action: "UPDATE", reason } }), 1);
    assert.equal((await changeProposalReviewForActor(scheduler, { ...review, operation: "submit" })).code, "STALE_PROPOSAL");
    const saved = { ...review, expectedVersion: proposal.version + 1 };
    const submitted = await changeProposalReviewForActor(scheduler, { ...saved, operation: "submit" });
    assert.deepEqual(submitted, { code: "PROPOSAL_UPDATED", status: "IN_REVIEW", version: proposal.version + 2 });
    const pending = { ...review, expectedVersion: proposal.version + 2 };
    await assert.rejects(changeProposalReviewForActor(scheduler, { ...pending, operation: "approve" }), AuthorizationError);
    assert.equal((await saveScheduleAdjustmentForActor(scheduler, { ...request, expectedVersion: persisted.version })).code, "INVALID_PROPOSAL_TRANSITION");

    const block = await db.venue_availability.create({ data: {
      venue_id: venue.id, type: "BLOCK", reason: "Bloqueo sobrevenido de prueba",
      starts_at: persisted.starts_at!, ends_at: persisted.ends_at!,
    } });
    assert.equal((await changeProposalReviewForActor(reviewer, { ...pending, operation: "approve" })).code, "NO_ELIGIBLE_VENUES");
    const returned = await changeProposalReviewForActor(reviewer, { ...pending, operation: "return" });
    assert.deepEqual(returned, { code: "PROPOSAL_UPDATED", status: "DRAFT", version: proposal.version + 3 });
    await db.venue_availability.delete({ where: { id: block.id } });
    assert.equal((await changeProposalReviewForActor(scheduler, {
      ...review, expectedVersion: proposal.version + 3, operation: "submit",
    })).code, "PROPOSAL_UPDATED");
    const responses = await Promise.all(["approve", "return"].map(operation =>
      changeProposalReviewForActor(reviewer, { ...review, expectedVersion: proposal.version + 4, operation })));
    assert.equal(responses.filter(result => result.code === "PROPOSAL_UPDATED").length, 1);
    assert.equal(await db.audit_logs.count({ where: { entity_id: proposal.id, action: "UPDATE", reason: review.reason } }), 4);

    const current = await db.schedule_proposals.findUniqueOrThrow({ where: { id: proposal.id } });
    if (current.status === "DRAFT") {
      assert.equal((await changeProposalReviewForActor(scheduler, {
        ...review, expectedVersion: current.version, operation: "submit",
      })).code, "PROPOSAL_UPDATED");
      assert.equal((await changeProposalReviewForActor(reviewer, {
        ...review, expectedVersion: current.version + 1, operation: "approve",
      })).code, "PROPOSAL_UPDATED");
    }
    assert.equal((await db.schedule_proposals.findUniqueOrThrow({ where: { id: proposal.id } })).status, "APPROVED");
    assert.equal(await db.publications.count({ where: { match_id: match.id } }), 0);
    assert.equal(await db.venue_reservations.count({ where: { match_id: match.id } }), 0);
    if (runHttp) {
      const httpFixture = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${scheduler}, true), set_config('app.reason', 'PDGLD-140 fixture', true)`;
        const freshProposal = await tx.schedule_proposals.create({ data: {
          season_id: proposal.season_id, matchday_id: proposal.matchday_id,
          competition_rule_id: proposal.competition_rule_id, created_by: scheduler,
        } });
        const freshMatch = await tx.matches.create({ data: {
          season_id: match.season_id, matchday_id: match.matchday_id, schedule_proposal_id: freshProposal.id,
          group_id: match.group_id, home_team_id: match.home_team_id, away_team_id: match.away_team_id, number: "002",
        } });
        const actor = (id: string) => tx.users.findUniqueOrThrow({ where: { id }, select: { id: true, email: true } });
        return {
          proposalId: freshProposal.id, storedProposalId: draft.id, matchId: freshMatch.id, venueId: venue.id, password,
          scheduler: await actor(scheduler), reviewer: await actor(reviewer), outsider: await actor(outsider),
        };
      });
      const { verifyScheduleAdjustmentHttp } = await import("./schedule-adjustment-http");
      await verifyScheduleAdjustmentHttp(target, httpFixture);
      assert.equal((await db.schedule_proposals.findUniqueOrThrow({ where: { id: httpFixture.proposalId } })).status, "APPROVED");
      assert.equal(await db.publications.count({ where: { match_id: httpFixture.matchId } }), 0);
    }
  } finally {
    await db.$disconnect();
  }
});
