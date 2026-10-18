import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../src/server/db/prisma";
import {
  assertCanGrantRole, assertPermission, AuthorizationError, lockAuthorization,
  type AuthorizationContext,
} from "../../src/server/auth/authorization";
import {
  assertOwnRefereeAssignment, assertOwnPlayerRegistration, assertSeparationOfDuties,
} from "../../src/server/auth/authorization-domain";

/** Isolated permissions exercise the engine; this file is not an RF22 matrix. */
test("PDGLD-54: autorización dinámica, ámbitos coherentes y delegación limitada", async (t) => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.AUTH_TEST_RUN, "1", "Ejecutar exclusivamente con el runner de autorización.");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname), "Solo PostgreSQL loopback.");
  assert.match(target.pathname, /^\/pdgld(?:48|54)_test_[a-f0-9]{16}$/, "Solo bases desechables del runner.");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.equal(target.hash, "");
  assert.equal(target.search, "", "El runner elimina parámetros capaces de cambiar el destino.");
  const db = getPrisma();
  const suffix = randomUUID();
  const permissionModule = `fixture.engine.${suffix}`;
  const person = await db.people.create({ data: { first_name: "Motor sintético", paternal_surname: "Autorización" } });
  const actor = await db.users.create({ data: { person_id: person.id, username: `engine-${suffix}`,
    email: `engine-${suffix}@example.test`, password_hash: "fixture-without-login", must_change_password: false } });
  const write = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async (tx) => {
    await lockAuthorization(tx, "exclusive");
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
      set_config('app.reason', 'PDGLD-54: fixture aislado del motor, no matriz RF22', true)`;
    return work(tx);
  });
  const leagueA = await db.leagues.create({ data: { name: `Motor A ${suffix}` } });
  const leagueB = await db.leagues.create({ data: { name: `Motor B ${suffix}` } });
  const clubA = await db.clubs.create({ data: { name: "Club A sintético", league_id: leagueA.id, reference_number: `engine-a-${suffix}` } });
  const clubB = await db.clubs.create({ data: { name: "Club B sintético", league_id: leagueB.id, reference_number: `engine-b-${suffix}` } });
  const teamA = await db.teams.create({ data: { club_id: clubA.id, name: "Equipo sintético", reference_number: `engine-team-${suffix}` } });
  const soccer = await db.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
  const seasonA = await write((tx) => tx.seasons.create({ data: { league_id: leagueA.id, sport_id: soccer.id,
    name: `Temporada motor ${suffix}`, start_date: new Date("2026-01-01"), end_date: new Date("2026-12-31") } }));
  const roles = await db.roles.findMany({ where: { code: { in: ["SECRETARY", "SCHEDULER", "SUPERADMIN", "PLAYER", "REFEREE"] } } });
  const role = (code: string) => roles.find((entry) => entry.code === code)!.id;
  const permission = await db.permissions.create({ data: { module: permissionModule, action: "READ" } });
  const authorization = (context: AuthorizationContext = {}) => db.$transaction((tx) => assertPermission(tx, actor.id,
    { module: permissionModule, action: "READ", context }));
  const denied = (work: Promise<unknown>) => assert.rejects(work,
    (error: unknown) => error instanceof AuthorizationError && error.status === 403 && error.code === "FORBIDDEN");
  let assignmentA: string;
  let assignmentB: string;
  let delegationPermissionId: string | undefined;
  let createdDelegationPermission = false;
  let previousDelegation: { id: string; context_only: boolean } | null = null;
  const additionalPermissions: string[] = [];
  const additionalRoleGrants: { roleId: string; permissionId: string;
    previous: { id: string; context_only: boolean } | null }[] = [];
  try {
    await t.test("SUPERADMIN sin permiso explícito se deniega y no crea un bypass", async () => {
      await write((tx) => tx.user_roles.create({ data: { user_id: actor.id, role_id: role("SUPERADMIN") } }));
      await denied(authorization());
      await denied(authorization({ leagueId: leagueA.id }));
    });
    await t.test("un permiso y su ámbito deben proceder de la misma asignación", async () => {
      await write(async (tx) => {
        await tx.role_permissions.create({ data: { role_id: role("SECRETARY"), permission_id: permission.id, context_only: true } });
        assignmentA = (await tx.user_roles.create({ data: { user_id: actor.id, role_id: role("SECRETARY"), league_id: leagueA.id } })).id;
        assignmentB = (await tx.user_roles.create({ data: { user_id: actor.id, role_id: role("SCHEDULER"), league_id: leagueB.id } })).id;
      });
      await authorization({ leagueId: leagueA.id });
      await denied(authorization({ leagueId: leagueB.id }));
      await denied(authorization());
      await authorization({ clubId: clubA.id });
      await denied(authorization({ leagueId: leagueA.id, clubId: clubB.id }));
    });
    await t.test("roles múltiples suman concesiones completas y las revocaciones son inmediatas", async () => {
      await write((tx) => tx.role_permissions.create({ data: { role_id: role("SCHEDULER"), permission_id: permission.id, context_only: true } }));
      await authorization({ leagueId: leagueB.id });
      await write((tx) => tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: role("SCHEDULER"), permission_id: permission.id } } }));
      await denied(authorization({ leagueId: leagueB.id }));
      await authorization({ leagueId: leagueA.id });
    });
    await t.test("vigencias futuras/vencidas y cuentas restringidas se deniegan", async () => {
      await write((tx) => tx.user_roles.update({ where: { id: assignmentA }, data: { starts_at: new Date(Date.now() + 86_400_000) } }));
      await denied(authorization({ leagueId: leagueA.id }));
      await write((tx) => tx.user_roles.update({ where: { id: assignmentA }, data: { starts_at: new Date(Date.now() - 86_400_000), ends_at: new Date(Date.now() - 1_000) } }));
      await denied(authorization({ leagueId: leagueA.id }));
      await write((tx) => tx.user_roles.update({ where: { id: assignmentA }, data: { ends_at: null } }));
      for (const restriction of [{ is_active: false }, { must_change_password: true }, { locked_until: new Date(Date.now() + 60_000) }]) {
        await db.users.update({ where: { id: actor.id }, data: restriction });
        await denied(authorization({ leagueId: leagueA.id }));
        await db.users.update({ where: { id: actor.id }, data: { is_active: true, must_change_password: false, locked_until: null } });
      }
    });
    await t.test("context_only=false no convierte una asignación local en global", async () => {
      await write((tx) => tx.role_permissions.update({ where: { role_id_permission_id: { role_id: role("SECRETARY"), permission_id: permission.id } }, data: { context_only: false } }));
      await authorization({ teamId: teamA.id });
      await denied(authorization());
      await denied(authorization({ leagueId: leagueB.id }));
      await denied(authorization({ teamId: teamA.id, seasonId: seasonA.id }));
      await denied(authorization({ teamId: teamA.id, leagueId: leagueB.id }));
    });
    await t.test("el ámbito de club se comprueba sin mezclarlo con otra liga", async () => {
      await write((tx) => tx.user_roles.update({ where: { id: assignmentA }, data: { club_id: clubA.id } }));
      await authorization({ clubId: clubA.id });
      await authorization({ teamId: teamA.id });
      await denied(authorization({ leagueId: leagueA.id }));
      await denied(authorization({ clubId: clubB.id }));
      await denied(authorization({ clubId: randomUUID() }));
    });
    await t.test("una concesión global exige permiso explícito no contextual y admite revocación", async () => {
      await write((tx) => tx.role_permissions.create({ data: { role_id: role("SUPERADMIN"), permission_id: permission.id, context_only: true } }));
      await denied(authorization());
      await denied(authorization({ leagueId: leagueB.id }));
      await write((tx) => tx.role_permissions.update({ where: { role_id_permission_id: { role_id: role("SUPERADMIN"), permission_id: permission.id } }, data: { context_only: false } }));
      await authorization();
      await authorization({ leagueId: leagueB.id });
      await write((tx) => tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: role("SUPERADMIN"), permission_id: permission.id } } }));
      await denied(authorization());
    });
    await t.test("propiedad arbitral y separación de funciones se derivan de recursos reales", async () => {
      const otherPerson = await db.people.create({ data: { first_name: "Otro actor sintético", paternal_surname: "Independiente" } });
      const other = await db.users.create({ data: { person_id: otherPerson.id, username: `other-engine-${suffix}`,
        email: `other-engine-${suffix}@example.test`, password_hash: "fixture-without-login", must_change_password: false } });
      const resources = await write(async (tx) => {
        const rule = await tx.competition_rules.create({ data: { season_id: seasonA.id, version_number: 1 } });
        const category = await tx.categories.create({ data: { league_id: leagueA.id, sport_id: soccer.id, name: "Categoría sintética" } });
        const seasonCategory = await tx.season_categories.create({ data: { season_id: seasonA.id, category_id: category.id,
          competition_rule_id: rule.id, hierarchy_order: 1, type: "OPEN", age_cutoff_date: new Date("2026-01-01") } });
        const group = await tx.groups.create({ data: { season_id: seasonA.id, season_category_id: seasonCategory.id, name: "Grupo sintético" } });
        const matchday = await tx.matchdays.create({ data: { season_id: seasonA.id, number: 1,
          start_date: new Date("2026-10-01"), end_date: new Date("2026-10-31") } });
        const opponent = await tx.clubs.create({ data: { league_id: leagueA.id, name: "Rival sintético", reference_number: `rival-${suffix}` } });
        const opponentTeam = await tx.teams.create({ data: { club_id: opponent.id, name: "Equipo rival", reference_number: `rival-team-${suffix}` } });
        const seasonTeams = [];
        for (const entry of [{ club: clubA, team: teamA }, { club: opponent, team: opponentTeam }]) {
          await tx.club_affiliations.create({ data: { season_id: seasonA.id, club_id: entry.club.id, league_id: leagueA.id,
            reference_number: `affiliation-${entry.club.id}`, uniform_colors: "Azul sintético", requested_by: actor.id } });
          seasonTeams.push(await tx.season_teams.create({ data: { season_id: seasonA.id, team_id: entry.team.id,
            club_id: entry.club.id, group_id: group.id } }));
        }
        const proposal = await tx.schedule_proposals.create({ data: { season_id: seasonA.id, matchday_id: matchday.id,
          created_by: actor.id, competition_rule_id: rule.id } });
        const match = await tx.matches.create({ data: { season_id: seasonA.id, group_id: group.id,
          matchday_id: matchday.id, number: "motor-sintético", home_team_id: seasonTeams[0].id,
          away_team_id: seasonTeams[1].id, schedule_proposal_id: proposal.id } });
        const report = await tx.match_reports.create({ data: { match_id: match.id, client_id: randomUUID(), captured_by: actor.id, source: "PAPER" } });
        const incidentType = await tx.event_types.findUniqueOrThrow({ where: { sport_id_code: { sport_id: soccer.id, code: "SERIOUS_INCIDENT" } } });
        const event = await tx.match_events.create({ data: { match_report_id: report.id, event_type_id: incidentType.id } });
        const disciplinaryCase = await tx.disciplinary_cases.create({ data: { season_id: seasonA.id, event_id: event.id,
          reference_number: `case-${suffix}`, opened_by: other.id, description: "Incidente sintético" } });
        const caseWithoutReport = await tx.disciplinary_cases.create({ data: { season_id: seasonA.id,
          reference_number: `case-without-report-${suffix}`, opened_by: other.id, description: "Expediente sin cédula" } });
        const referee = await tx.referees.create({ data: { person_id: person.id } });
        const assignment = await tx.referee_assignments.create({ data: { match_id: match.id, referee_id: referee.id,
          created_by: other.id, approved_by: other.id, approved_at: new Date(), status: "APPROVED" } });
        const concept = await tx.charge_concepts.findUniqueOrThrow({ where: { code: "REGISTRATION" } });
        const charge = await tx.charges.create({ data: { season_id: seasonA.id, club_id: clubA.id,
          charge_concept_id: concept.id, amount: 100, created_by: other.id,
          issued_on: new Date("2026-10-01"), due_on: new Date("2026-10-31"),
          period_start_date: new Date("2026-10-01"), period_end_date: new Date("2026-10-31") } });
        return { match, report, proposal, assignment, charge, opponent, disciplinaryCase, caseWithoutReport };
      });
      await authorization({ matchId: resources.match.id, teamId: teamA.id, seasonId: seasonA.id });
      await denied(authorization({ matchId: resources.match.id, clubId: clubB.id }));
      await denied(authorization({ matchId: resources.match.id, clubId: resources.opponent.id }));
      await db.$transaction((tx) => assertOwnRefereeAssignment(tx, actor.id, resources.match.id));
      await denied(db.$transaction((tx) => assertOwnRefereeAssignment(tx, other.id, resources.match.id)));
      await write((tx) => tx.referee_assignments.update({ where: { id: resources.assignment.id }, data: { status: "REVOKED" } }));
      await denied(db.$transaction((tx) => assertOwnRefereeAssignment(tx, actor.id, resources.match.id)));
      await denied(db.$transaction((tx) => assertOwnPlayerRegistration(tx, actor.id, randomUUID())));
      await denied(db.$transaction((tx) => assertSeparationOfDuties(tx, actor.id,
        { kind: "schedule-publication", proposalId: resources.proposal.id })));
      await db.$transaction((tx) => assertSeparationOfDuties(tx, other.id,
        { kind: "schedule-publication", proposalId: resources.proposal.id }));
      await denied(db.$transaction((tx) => assertSeparationOfDuties(tx, actor.id,
        { kind: "disciplinary-resolution", caseId: resources.disciplinaryCase.id })));
      await db.$transaction((tx) => assertSeparationOfDuties(tx, other.id,
        { kind: "disciplinary-resolution", caseId: resources.disciplinaryCase.id }));
      await denied(db.$transaction((tx) => assertSeparationOfDuties(tx, other.id,
        { kind: "disciplinary-resolution", caseId: resources.caseWithoutReport.id })));
      await denied(db.$transaction((tx) => assertSeparationOfDuties(tx, actor.id,
        { kind: "charge-approval", chargeId: resources.charge.id })));
      await denied(db.$transaction((tx) => assertSeparationOfDuties(tx, other.id,
        { kind: "charge-approval", chargeId: resources.charge.id })));
      const payment = await write((tx) => tx.payments.create({ data: { charge_id: resources.charge.id, amount: 100,
        paid_at: new Date(), method: "CASH", recorded_by: actor.id, reference_number: `payment-${suffix}` } }));
      await db.$transaction((tx) => assertSeparationOfDuties(tx, actor.id,
        { kind: "charge-approval", chargeId: resources.charge.id }));
      await db.$transaction((tx) => assertSeparationOfDuties(tx, other.id,
        { kind: "charge-approval", chargeId: resources.charge.id }));
      await write((tx) => tx.payment_voids.create({ data: { payment_id: payment.id,
        authorized_by: other.id, reason: "Anulación sintética para comprobar evidencia vigente" } }));
      await denied(db.$transaction((tx) => assertSeparationOfDuties(tx, other.id,
        { kind: "charge-approval", chargeId: resources.charge.id })));
    });
    await t.test("delegar exige permiso específico y autoridad permanente del mismo ámbito", async () => {
      const existing = await db.permissions.findUnique({ where: { module_action: { module: "user_roles", action: "CREATE" } } });
      createdDelegationPermission = !existing;
      const delegate = existing ?? await db.permissions.create({ data: { module: "user_roles", action: "CREATE" } });
      delegationPermissionId = delegate.id;
      previousDelegation = await db.role_permissions.findUnique({
        where: { role_id_permission_id: { role_id: role("PLAYER"), permission_id: delegate.id } },
        select: { id: true, context_only: true },
      });
      let delegatorAssignment: string;
      await write(async (tx) => {
        await tx.role_permissions.create({ data: { role_id: role("REFEREE"), permission_id: permission.id, context_only: true } });
        await tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role("PLAYER"), permission_id: delegate.id } }, update: { context_only: true }, create: { role_id: role("PLAYER"), permission_id: delegate.id, context_only: true } });
        await tx.role_permissions.create({ data: { role_id: role("PLAYER"), permission_id: permission.id, context_only: true } });
        delegatorAssignment = (await tx.user_roles.create({ data: { user_id: actor.id, role_id: role("PLAYER"), league_id: leagueA.id, ends_at: new Date(Date.now() + 60_000) } })).id;
      });
      const grant = (context: AuthorizationContext) => db.$transaction((tx) => assertCanGrantRole(tx, actor.id, role("REFEREE"), context));
      await denied(grant({ leagueId: leagueA.id }));
      await write((tx) => tx.user_roles.update({ where: { id: delegatorAssignment }, data: { ends_at: null } }));
      await grant({ leagueId: leagueA.id });
      await denied(grant({ leagueId: leagueB.id }));
      await denied(grant({}));
      await write((tx) => tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: role("PLAYER"), permission_id: delegate.id } } }));
      await denied(grant({ leagueId: leagueA.id }));
    });
    await t.test("aprobar roles operativos es una capacidad explícita y no eleva autoridad administrativa", async () => {
      const operational = await db.permissions.create({ data: { module: permissionModule, action: "UPDATE" } });
      additionalPermissions.push(operational.id);
      const ensurePermission = async (permissionModule: string, action: "READ" | "UPDATE" | "APPROVE") => {
        const existing = await db.permissions.findUnique({ where: { module_action: { module: permissionModule, action } } });
        if (existing) return existing;
        const created = await db.permissions.create({ data: { module: permissionModule, action } });
        additionalPermissions.push(created.id);
        return created;
      };
      const approve = await ensurePermission("user_roles", "APPROVE");
      const addGrant = async (roleId: string, permissionId: string) => write(async (tx) => {
        const previous = await tx.role_permissions.findUnique({ where: { role_id_permission_id: { role_id: roleId, permission_id: permissionId } },
          select: { id: true, context_only: true } });
        additionalRoleGrants.push({ roleId, permissionId, previous });
        return tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: roleId, permission_id: permissionId } },
          update: { context_only: true }, create: { role_id: roleId, permission_id: permissionId, context_only: true } });
      });
      await write(async (tx) => {
        await tx.role_permissions.create({ data: { role_id: role("REFEREE"), permission_id: operational.id, context_only: true } });
        await tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role("PLAYER"), permission_id: delegationPermissionId! } },
          update: { context_only: true }, create: { role_id: role("PLAYER"), permission_id: delegationPermissionId!, context_only: true } });
      });
      const grant = (context: AuthorizationContext) => db.$transaction((tx) => assertCanGrantRole(tx, actor.id, role("REFEREE"), context));
      // CREATE authorizes provisioning, but by itself cannot transfer unrelated operational authority.
      await denied(grant({ leagueId: leagueA.id }));
      await addGrant(role("SCHEDULER"), approve.id); // Actor's SCHEDULER assignment belongs to B.
      await denied(grant({ leagueId: leagueA.id }));
      await write((tx) => tx.user_roles.create({ data: { user_id: actor.id, role_id: role("SCHEDULER"),
        league_id: leagueA.id, ends_at: new Date(Date.now() + 60_000) } }));
      await denied(grant({ leagueId: leagueA.id })); // A finite approval cannot create an indefinite grant.
      const approval = await addGrant(role("PLAYER"), approve.id); // Actor's PLAYER assignment belongs to A.
      await grant({ leagueId: leagueA.id });
      await grant({ leagueId: leagueA.id, clubId: clubA.id });
      await denied(grant({ leagueId: leagueB.id }));
      await denied(grant({}));
      for (const [permissionModule, action] of [["accounts", "READ"], ["user_roles", "UPDATE"], ["role_permissions", "READ"]] as const) {
        const control = await ensurePermission(permissionModule, action);
        const targetGrant = await addGrant(role("REFEREE"), control.id);
        await denied(grant({ leagueId: leagueA.id }));
        await write((tx) => tx.role_permissions.delete({ where: { id: targetGrant.id } }));
      }
      await write((tx) => tx.role_permissions.delete({ where: { id: approval.id } }));
      await denied(grant({ leagueId: leagueA.id }));
    });
    await t.test("acciones desconocidas, contexto extra y UUID incorrecto se deniegan", async () => {
      await denied(db.$transaction((tx) => assertPermission(tx, actor.id,
        { module: permissionModule, action: "DELETE" as "READ", context: {} })));
      await denied(authorization({ leagueId: "invalid" }));
      await denied(authorization({ leagueId: leagueA.id, ignoredScope: leagueB.id } as AuthorizationContext));
      assert.ok(assignmentB!);
    });
  } finally {
    await write(async (tx) => {
      await tx.user_roles.deleteMany({ where: { user_id: actor.id } });
      await tx.role_permissions.deleteMany({ where: { permission_id: permission.id } });
      await tx.permissions.delete({ where: { id: permission.id } });
      if (delegationPermissionId) {
        if (previousDelegation) {
          await tx.role_permissions.upsert({
            where: { role_id_permission_id: { role_id: role("PLAYER"), permission_id: delegationPermissionId } },
            create: { id: previousDelegation.id, role_id: role("PLAYER"), permission_id: delegationPermissionId,
              context_only: previousDelegation.context_only },
            update: { context_only: previousDelegation.context_only },
          });
        } else await tx.role_permissions.deleteMany({ where: { role_id: role("PLAYER"), permission_id: delegationPermissionId } });
        if (createdDelegationPermission) await tx.permissions.delete({ where: { id: delegationPermissionId } });
      }
      for (const grant of additionalRoleGrants) {
        if (grant.previous) await tx.role_permissions.upsert({
          where: { role_id_permission_id: { role_id: grant.roleId, permission_id: grant.permissionId } },
          create: { id: grant.previous.id, role_id: grant.roleId, permission_id: grant.permissionId,
            context_only: grant.previous.context_only }, update: { context_only: grant.previous.context_only },
        });
        else await tx.role_permissions.deleteMany({ where: { role_id: grant.roleId, permission_id: grant.permissionId } });
      }
      for (const permissionId of additionalPermissions) {
        await tx.role_permissions.deleteMany({ where: { permission_id: permissionId } });
        await tx.permissions.delete({ where: { id: permissionId } });
      }
    });
    await db.$disconnect();
  }
});
