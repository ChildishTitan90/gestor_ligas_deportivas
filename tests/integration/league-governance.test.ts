import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPrisma } from "../../src/server/db/prisma";
import { changeGovernanceForActor, getGovernanceWorkspaceForActor } from "../../src/features/governance/server/service";
import { AuthorizationError } from "../../src/server/auth/authorization";

const target = process.env.DATABASE_URL;
assert.ok(target, "DATABASE_URL debe apuntar a la base temporal de PDGLD-37");
const url = new URL(target);
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.search, "");
assert.equal(url.hash, "");
const expectedTarget = process.env.GITHUB_ACTIONS === "true"
  ? "5432/gestor_ligas_ci"
  : "55437/pdgld37";
assert.equal(`${url.port}${url.pathname}`, expectedTarget);

test("registra órganos y periodos con auditoría y alcance de liga, sin conceder permisos", async () => {
  const db = getPrisma();
  try {
    const tag = randomUUID();
    const league = await db.leagues.create({ data: { name: `Liga ${tag}` } });
    const outside = await db.leagues.create({ data: { name: `Externa ${tag}` } });
    const superadmin = await db.roles.findUniqueOrThrow({ where: { code: "SUPERADMIN" } });
    const secretary = await db.roles.findUniqueOrThrow({ where: { code: "SECRETARY" } });
    async function fixture(leagueId: string, roleId: string) {
      return db.$transaction(async tx => {
        const person = await tx.people.create({ data: { first_name: "Fixture", paternal_surname: randomUUID() } });
        const user = await tx.users.create({ data: { person_id: person.id, username: randomUUID(), email: `${randomUUID()}@example.test`,
          password_hash: "fixture-only", must_change_password: false } });
        await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true), set_config('app.reason', 'fixture', true)`;
        await tx.user_roles.create({ data: { user_id: user.id, role_id: roleId, league_id: leagueId, starts_at: new Date("2000-01-01T00:00:00Z") } });
        return { person, user };
      });
    }
    const admin = await fixture(league.id, superadmin.id);
    const member = await fixture(league.id, secretary.id);
    const outsider = await fixture(outside.id, superadmin.id);
    const base = { leagueId: league.id, reason: "Fixture de nombramiento" };
    await assert.rejects(changeGovernanceForActor(member.user.id, { ...base, operation: "initialize" }), AuthorizationError);
    await assert.rejects(getGovernanceWorkspaceForActor(outsider.user.id, { league: league.id }), AuthorizationError);
    await changeGovernanceForActor(admin.user.id, { ...base, operation: "initialize" });
    await changeGovernanceForActor(admin.user.id, { ...base, operation: "initialize" });
    const workspace = await getGovernanceWorkspaceForActor(admin.user.id, { league: league.id, person: "Fixture" });
    assert.equal(workspace.bodies.length, 3);
    assert.ok(workspace.people.some(person => person.id === member.person.id));
    assert.ok(!workspace.people.some(person => person.id === outsider.person.id));
    const body = workspace.bodies[0];
    await changeGovernanceForActor(admin.user.id, { ...base, operation: "position", bodyId: body.id, name: "Cargo sintético", roleId: superadmin.id });
    const position = await db.positions.findFirstOrThrow({ where: { governing_body_id: body.id } });
    assert.equal(position.role_id, superadmin.id);
    const appoint = { ...base, operation: "appoint", requestId: randomUUID(), positionId: position.id, personId: member.person.id,
      startsAt: "2026-01-01", endsAt: "" };
    await assert.rejects(changeGovernanceForActor(admin.user.id, { ...appoint, personId: outsider.person.id }), AuthorizationError);
    await assert.rejects(changeGovernanceForActor(admin.user.id, { ...appoint, endsAt: "2025-01-01" }), /INVALID/);
    const submitted = await Promise.all([
      changeGovernanceForActor(admin.user.id, appoint),
      changeGovernanceForActor(admin.user.id, appoint),
    ]);
    assert.deepEqual(submitted, [body.id, body.id]);
    await assert.rejects(changeGovernanceForActor(admin.user.id, { ...appoint, reason: "Motivo distinto" }), /REQUEST_CONFLICT/);
    assert.equal(await db.appointments.count({ where: { position_id: position.id } }), 1);
    assert.equal(await db.user_roles.count({ where: { user_id: member.user.id } }), 1);
    await assert.rejects(getGovernanceWorkspaceForActor(member.user.id, { league: league.id }), AuthorizationError);
    const appointment = await db.appointments.findFirstOrThrow({ where: { position_id: position.id } });
    assert.equal(await db.audit_logs.count({ where: { entity_id: appointment.id, action: 'INSERT' } }), 1);
    const finish = { ...base, operation: "finish", appointmentId: appointment.id, expectedEnd: "", endsAt: "2026-02-01" };
    const outcomes = await Promise.allSettled([changeGovernanceForActor(admin.user.id, finish), changeGovernanceForActor(admin.user.id, finish)]);
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(outcomes.find(result => result.status === "rejected")?.reason.message, "STALE");
    const history = await getGovernanceWorkspaceForActor(admin.user.id, { league: league.id, body: body.id, period: "past" });
    assert.equal(history.positions[0].appointments[0].id, appointment.id);
    const audit = await db.audit_logs.findFirstOrThrow({ where: { entity_id: appointment.id, action: "UPDATE" } });
    assert.equal(audit.user_id, admin.user.id);
    assert.equal(audit.reason, base.reason);
    assert.deepEqual(audit.new_data, { endsAt: finish.endsAt });
    assert.deepEqual(audit.previous_data, { endsAt: null });
    await db.people.update({ where: { id: member.person.id }, data: { first_name: "Nombre corregido" } });
    assert.equal((await db.appointments.findUniqueOrThrow({ where: { id: appointment.id } })).person_id, member.person.id);
    await assert.rejects(db.appointments.update({ where: { id: appointment.id }, data: { person_id: outsider.person.id } }));
    await assert.rejects(db.appointments.delete({ where: { id: appointment.id } }));
  } finally {
    await db.$disconnect();
  }
});
