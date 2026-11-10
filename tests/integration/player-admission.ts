import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import type { Prisma } from "@prisma/client";
import type { getPrisma } from "../../src/server/db/prisma";
import { registerPlayerForActor } from "../../src/features/players/server/service";
import { PlayerRegistrationError } from "../../src/features/players/server/access";
import { AuthorizationError } from "../../src/server/auth/authorization";

type Payload = { seasonTeamId: string; identity: {
  curp: string; birthDate: string; firstName: string; paternalSurname: string; maternalSurname: string;
} };

/** Se llama únicamente desde el runner que exige PostgreSQL desechable. */
export async function runPlayerAdmissionTests(t: TestContext, db: ReturnType<typeof getPrisma>,
  actors: Record<string, string>, team: { id: string },
  input: (teamId: string, dob: string, root?: string) => Payload,
  setClock: (timestamp: string) => Promise<void>) {
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  const [context] = await db.$queryRaw<{ id: string }[]>`SELECT g.season_category_id AS id
    FROM sports_management.season_teams st JOIN sports_management.groups g ON g.id=st.group_id
    WHERE st.id=${team.id}::uuid`;
  const original = await db.season_categories.findUniqueOrThrow({ where: { id: context.id } });
  const policy = original.player_policy as Prisma.JsonObject;
  const configure = (changes: Prisma.JsonObject, pending = false) => db.season_categories.update({
    where: { id: context.id }, data: { eligibility_pending: pending,
      player_policy: { ...policy, ...changes } as Prisma.InputJsonObject },
  });
  const isCode = (code: string) => (error: unknown) => error instanceof PlayerRegistrationError && error.code === code;
  const counts = async () => ({ people: await db.people.count(), registrations: await db.player_registrations.count(),
    history: await db.player_status_history.count(), audits: await db.audit_logs.count() });
  try {
    await t.test("PDGLD-103: edad fuera de rango o excepcional no crea identidad, historial ni auditoría", async () => {
      await configure({ referenceYear: 2026, minimumAge: 14, maximumAge: 16, exceptionMinimumAge: 13 });
      for (const [dob, code] of [["2009-08-21", "AGE_OUTSIDE_RANGE"], ["2013-08-21", "AGE_EXCEPTION_REQUIRED"],
        ["2014-08-21", "AGE_OUTSIDE_RANGE"]]) {
        const before = await counts();
        await assert.rejects(registerPlayerForActor(actors.delegate, input(team.id, dob, "SIAA")), isCode(code));
        assert.deepEqual(await counts(), before);
      }
      for (const dob of ["2010-12-31", "2012-12-31"])
        assert.equal((await registerPlayerForActor(actors.delegate, input(team.id, dob, "SIAI"))).replayed, false);
      await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null });
    });
    await t.test("PDGLD-103: la política pendiente bloquea y un actor ajeno no obtiene su motivo", async () => {
      await configure({}, true);
      const before = await counts();
      const payload = input(team.id, "1992-08-22", "SIAB");
      await assert.rejects(registerPlayerForActor(actors.other, payload), error => error instanceof AuthorizationError);
      await assert.rejects(registerPlayerForActor(actors.delegate, payload), isCode("PLAYER_POLICY_PENDING"));
      assert.deepEqual(await counts(), before);
      await configure({});
    });
    await t.test("PDGLD-103: miércoles antes del cierre admite; jueves a medianoche revierte", async () => {
      await setClock("2026-10-29T05:59:59Z");
      const admitted = await registerPlayerForActor(actors.delegate, input(team.id, "1992-08-23", "SIAC"));
      assert.equal(admitted.replayed, false);
      await setClock("2026-10-29T06:00:00Z");
      const before = await counts();
      await assert.rejects(registerPlayerForActor(actors.delegate, input(team.id, "1992-08-24", "SIAD")), isCode("REGISTRATION_WINDOW_CLOSED"));
      assert.deepEqual(await counts(), before);
    });
    await t.test("PDGLD-103: servicio y trigger respetan días y zona configurados", async () => {
      await configure({ registrationDays: [4], timezone: "UTC" });
      await setClock("2026-10-29T01:00:00Z"); // Jueves UTC; miércoles en Morelia.
      assert.equal((await registerPlayerForActor(actors.delegate, input(team.id, "1992-08-25", "SIAE"))).replayed, false);
      await configure({ registrationDays: [4], timezone: "America/Mexico_City" });
      await assert.rejects(registerPlayerForActor(actors.delegate, input(team.id, "1992-08-26", "SIAF")), isCode("REGISTRATION_WINDOW_CLOSED"));
      await configure({ registrationDays: [1, 2, 3], timezone: "America/Mexico_City" });
    });
    await t.test("PDGLD-103: reintento recupera la inscripción fuera de ventana sin nuevas escrituras", async () => {
      await setClock("2026-10-26T18:00:00Z");
      const payload = input(team.id, "1992-08-27", "SIAG");
      const first = await registerPlayerForActor(actors.delegate, payload);
      await setClock("2026-10-31T18:00:00Z");
      const before = await counts();
      const replay = await registerPlayerForActor(actors.delegate, payload);
      assert.equal(replay.registrationId, first.registrationId);
      assert.equal(replay.replayed, true);
      assert.deepEqual(await counts(), before);
    });
    await t.test("PDGLD-103: el payload no sustituye política, reloj ni aprobación", async () => {
      const payload = input(team.id, "1992-08-28", "SIAH");
      for (const forged of [{ now: "2026-10-26" }, { policy }, { approved: true }])
        await assert.rejects(registerPlayerForActor(actors.delegate, { ...payload, ...forged }), isCode("VALIDATION_ERROR"));
    });
    await t.test("PDGLD-103: el trigger rechaza una escritura directa fuera de ventana y conserva rollback", async () => {
      await setClock("2026-10-31T18:00:00Z");
      const before = await counts();
      const payload = input(team.id, "1992-08-29", "SIAJ");
      await assert.rejects(db.$transaction(async tx => {
        const person = await tx.people.create({ data: { curp: payload.identity.curp,
          birth_date: new Date(payload.identity.birthDate), first_name: "Caso", paternal_surname: "Sintetico" } });
        await tx.player_registrations.create({ data: { person_id: person.id,
          season_team_id: team.id, season_id: original.season_id,
          reference_number: `PDGLD103-${person.id}`, status: "INELIGIBLE" } });
      }), error => JSON.stringify(error).includes("PLAYER_ADMISSION_WINDOW_CLOSED") ||
        String(error).includes("PLAYER_ADMISSION_WINDOW_CLOSED"));
      assert.deepEqual(await counts(), before);
    });
    await t.test("PDGLD-105: fases incluyen apertura, excluyen cierre y bloquean huecos sin residuos", async () => {
      await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null,
        timezone: "America/Mexico_City", registrationDays: [1, 2, 3], registrationWindows: [
          { phase: "Primera", opensAt: "2026-10-26T12:00:00", closesAt: "2026-10-26T13:00:00" },
          { phase: "Segunda", opensAt: "2026-10-27T12:00:00", closesAt: "2026-10-27T13:00:00" },
        ] });
      const cases = [
        ["2026-10-26T17:59:59Z", false], ["2026-10-26T18:00:00Z", true],
        ["2026-10-26T18:59:59Z", true], ["2026-10-26T19:00:00Z", false],
        ["2026-10-27T17:59:59Z", false], ["2026-10-27T18:00:00Z", true],
        ["2026-10-27T19:00:00Z", false],
      ] as const;
      for (const [index, [timestamp, allowed]] of cases.entries()) {
        await setClock(timestamp);
        const payload = input(team.id, `1991-01-${String(index + 1).padStart(2, "0")}`, "SIKA");
        const before = await counts();
        if (allowed) {
          const result = await registerPlayerForActor(actors.delegate, payload);
          assert.equal(result.replayed, false, timestamp);
          assert.equal(result.status, "INELIGIBLE");
        } else {
          await assert.rejects(registerPlayerForActor(actors.delegate, payload), isCode("REGISTRATION_WINDOW_CLOSED"));
          assert.deepEqual(await counts(), before, timestamp);
        }
      }
    });
    await t.test("PDGLD-105: una fase abierta conserva el día permitido y usa la zona configurada", async () => {
      const windows = [{ phase: "Lunes local", opensAt: "2026-10-26T23:00:00", closesAt: "2026-10-27T00:00:00" }];
      await setClock("2026-10-27T05:30:00Z"); // Lunes 23:30 en Morelia; martes UTC.
      await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null,
        timezone: "America/Mexico_City", registrationDays: [1], registrationWindows: windows });
      assert.equal((await registerPlayerForActor(actors.delegate, input(team.id, "1991-02-01", "SIKB"))).replayed, false);
      for (const changes of [{ registrationDays: [2] }, { timezone: "UTC", registrationDays: [1, 2] }]) {
        await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null,
          timezone: "America/Mexico_City", registrationWindows: windows, ...changes });
        const before = await counts();
        await assert.rejects(registerPlayerForActor(actors.delegate, input(team.id, "1991-02-02", "SIKB")), isCode("REGISTRATION_WINDOW_CLOSED"));
        assert.deepEqual(await counts(), before);
      }
    });
    await t.test("PDGLD-105: SQL directo respeta cierre de fase y rechaza política manipulada con rollback", async () => {
      await setClock("2026-10-26T19:00:00Z"); // Lunes permitido, justo en el cierre local.
      const window = { phase: "SQL", opensAt: "2026-10-26T12:00:00", closesAt: "2026-10-26T13:00:00" };
      const directInsert = () => db.$transaction(async tx => {
        const payload = input(team.id, "1991-03-01", "SIKC");
        const person = await tx.people.create({ data: { curp: payload.identity.curp,
          birth_date: new Date(payload.identity.birthDate), first_name: "Caso", paternal_surname: "Sintetico" } });
        await tx.player_registrations.create({ data: { person_id: person.id,
          season_team_id: team.id, season_id: original.season_id,
          reference_number: `PDGLD105-${person.id}`, status: "INELIGIBLE" } });
      });
      for (const [windows, code] of [
        [[window], "PLAYER_ADMISSION_WINDOW_CLOSED"],
        ["manipulada", "PLAYER_ADMISSION_POLICY_PENDING"],
        [[{ ...window, closesAt: window.opensAt }], "PLAYER_ADMISSION_POLICY_PENDING"],
        [[{ ...window, opensAt: `${window.opensAt}Z` }], "PLAYER_ADMISSION_POLICY_PENDING"],
      ] as const) {
        await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null,
          timezone: "America/Mexico_City", registrationDays: [1, 2, 3],
          registrationWindows: JSON.parse(JSON.stringify(windows)) as Prisma.JsonValue });
        const before = await counts();
        await assert.rejects(directInsert(), error => JSON.stringify(error).includes(code) || String(error).includes(code));
        assert.deepEqual(await counts(), before);
      }
    });
    await t.test("PDGLD-105: reenvío tras el cierre recupera el acuse; sin fases conserva la ventana semanal", async () => {
      await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null,
        timezone: "America/Mexico_City", registrationDays: [1, 2, 3], registrationWindows: [
          { phase: "Acuse", opensAt: "2026-10-26T12:00:00", closesAt: "2026-10-26T13:00:00" },
        ] });
      await setClock("2026-10-26T18:00:00Z");
      const payload = input(team.id, "1991-04-01", "SIKD");
      const first = await registerPlayerForActor(actors.delegate, payload);
      await setClock("2026-10-26T19:00:00Z");
      const before = await counts();
      const replay = await registerPlayerForActor(actors.delegate, payload);
      assert.equal(replay.registrationId, first.registrationId);
      assert.equal(replay.replayed, true);
      assert.deepEqual(await counts(), before);
      await configure({ minimumAge: 0, maximumAge: null, exceptionMinimumAge: null,
        timezone: "America/Mexico_City", registrationDays: [1, 2, 3], registrationWindows: [] });
      assert.equal((await registerPlayerForActor(actors.delegate, input(team.id, "1991-04-02", "SIKD"))).replayed, false);
      await setClock("2026-10-31T18:00:00Z");
      const closed = await counts();
      await assert.rejects(registerPlayerForActor(actors.delegate, input(team.id, "1991-04-03", "SIKD")), isCode("REGISTRATION_WINDOW_CLOSED"));
      assert.deepEqual(await counts(), closed);
    });
  } finally {
    await db.season_categories.update({ where: { id: context.id }, data: {
      eligibility_pending: original.eligibility_pending, player_policy: policy as Prisma.InputJsonObject,
    } });
    await setClock("2026-10-26T12:00:00-06:00");
  }
}
