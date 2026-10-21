import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPrisma } from "../../src/server/db/prisma";
import { assertPermission, AuthorizationError, lockAuthorization } from "../../src/server/auth/authorization";
import { assertOwnPlayerRegistration } from "../../src/server/auth/authorization-domain";

test("PDGLD-54: lectura de inscripciones reales exige permiso y propiedad", async (t) => {
  // Antes de conectar o escribir: exclusivamente la base creada por el runner.
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.ok(["5432", "5433"].includes(target.port || "5432"));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  const db = getPrisma();
  const rollback = new Error("ROLLBACK_PDGLD54_PLAYER_FIXTURES");
  const suffix = randomUUID();

  try {
    try {
      await db.$transaction(async (tx) => {
        await lockAuthorization(tx, "exclusive");
        const ownPerson = await tx.people.create({ data: { first_name: "Jugador sintético", paternal_surname: "Propio",
          birth_date: new Date("2000-01-01"), curp: "SIAA000101HMNLRRA1" } });
        const otherPerson = await tx.people.create({ data: { first_name: "Jugador sintético", paternal_surname: "Ajeno",
          birth_date: new Date("2000-01-02"), curp: "SIAA000102HMNLRRA2" } });
        const actor = await tx.users.create({ data: { person_id: ownPerson.id, username: `player-${suffix}`,
          email: `player-${suffix}@example.test`, password_hash: "fixture-without-login", must_change_password: false } });
        await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
          set_config('app.reason', 'PDGLD-54: validación sintética de propiedad de inscripciones', true)`;
        const league = await tx.leagues.create({ data: { name: `Liga jugador ${suffix}` } });
        const soccer = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
        const season = await tx.seasons.create({ data: { league_id: league.id, sport_id: soccer.id,
          name: "Temporada sintética", start_date: new Date("2026-01-01"), end_date: new Date("2026-12-31") } });
        const rule = await tx.competition_rules.create({ data: { season_id: season.id, version_number: 1 } });
        const category = await tx.categories.create({ data: { league_id: league.id, sport_id: soccer.id, name: "Abierta sintética" } });
        const seasonCategory = await tx.season_categories.create({ data: { season_id: season.id, category_id: category.id,
          competition_rule_id: rule.id, hierarchy_order: 1, type: "OPEN", age_cutoff_date: new Date("2026-01-01") } });
        const group = await tx.groups.create({ data: { season_id: season.id, season_category_id: seasonCategory.id, name: "Grupo sintético" } });
        const club = await tx.clubs.create({ data: { league_id: league.id, name: "Club sintético", reference_number: `player-club-${suffix}` } });
        await tx.club_affiliations.create({ data: { club_id: club.id, league_id: league.id, season_id: season.id,
          reference_number: `player-affiliation-${suffix}`, uniform_colors: "Azul", requested_by: actor.id } });
        const team = await tx.teams.create({ data: { club_id: club.id, name: "Equipo sintético", reference_number: `player-team-${suffix}` } });
        const seasonTeam = await tx.season_teams.create({ data: { season_id: season.id, team_id: team.id,
          club_id: club.id, group_id: group.id } });
        const role = await tx.roles.findUniqueOrThrow({ where: { code: "PLAYER" } });
        const permission = await tx.permissions.upsert({ where: { module_action: { module: "players", action: "READ" } },
          update: {}, create: { module: "players", action: "READ" } });
        // Oráculo RF22: PLAYER tiene R*, nunca acceso a otro jugador del club.
        await tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
          update: { context_only: true }, create: { role_id: role.id, permission_id: permission.id, context_only: true } });
        await tx.user_roles.create({ data: { user_id: actor.id, role_id: role.id, league_id: league.id, club_id: club.id,
          starts_at: new Date(Date.now() - 60_000) } });

        // Solo el reloj de preparación. El baseline fija search_path en cada
        // función: cambiar únicamente el de la sesión no controla el trigger.
        const [triggerConfig] = await tx.$queryRaw<{ settings: string[] }[]>`
          SELECT proconfig AS settings FROM pg_catalog.pg_proc
          WHERE oid = 'sports_management.validate_player_registration()'::regprocedure
        `;
        assert.ok(triggerConfig.settings.includes("search_path=sports_management, pg_temp"),
          "Revisar la preparación si cambia la configuración del trigger compartido.");
        await tx.$executeRaw`CREATE SCHEMA pdgld54_test_clock`;
        await tx.$executeRaw`CREATE FUNCTION pdgld54_test_clock.now() RETURNS timestamptz LANGUAGE sql STABLE
          AS 'SELECT current_setting(''pdgld54_test.now'')::timestamptz'`;
        await tx.$queryRaw`SELECT set_config('pdgld54_test.now', '2026-10-22T12:00:00-06:00', true)`;
        // DDL exclusivamente en esta transacción desechable; conserva el cuerpo
        // y los triggers activos. Restaurar antes de ejecutar la autorización.
        await tx.$executeRaw`ALTER FUNCTION sports_management.validate_player_registration()
          SET search_path TO pdgld54_test_clock, pg_catalog, sports_management, pg_temp`;
        const createRegistration = (personId: string, reference: string) => tx.player_registrations.create({
          data: { person_id: personId, season_id: season.id, season_team_id: seasonTeam.id, reference_number: reference },
        });

        await t.test("fixtures: el trigger activo rechaza jueves; admite miércoles con CURP y relaciones válidas", async () => {
          const [clock] = await tx.$queryRaw<{ day: number }[]>`SELECT extract(isodow FROM pdgld54_test_clock.now() AT TIME ZONE 'America/Mexico_City')::int AS day`;
          assert.equal(clock.day, 4);
          await tx.$executeRaw`SAVEPOINT closed_registration_window`;
          let rejectedByWindow = false;
          try {
            await createRegistration(ownPerson.id, `closed-${suffix}`);
          } catch (error) {
            // Prisma 7 puede envolver P0001 en el error del adaptador; no
            // imprimir el error completo, que incluye argumentos de la consulta.
            const adapter = error as { cause?: { originalMessage?: string };
              meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } };
            const message = adapter.meta?.driverAdapterError?.cause?.originalMessage ?? adapter.cause?.originalMessage ?? String(error);
            rejectedByWindow = message.includes("Las altas solo se permiten lunes a miercoles");
          }
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT closed_registration_window`;
          await tx.$executeRaw`RELEASE SAVEPOINT closed_registration_window`;
          assert.ok(rejectedByWindow, "El trigger real debe rechazar el alta fuera de ventana.");
          assert.equal(await tx.player_registrations.count({ where: { season_id: season.id } }), 0);
        });

        await tx.$queryRaw`SELECT set_config('pdgld54_test.now', '2026-10-21T12:00:00-06:00', true)`;
        const own = await createRegistration(ownPerson.id, `own-${suffix}`);
        const other = await createRegistration(otherPerson.id, `other-${suffix}`);
        await tx.$executeRaw`ALTER FUNCTION sports_management.validate_player_registration()
          SET search_path TO sports_management, pg_temp`;
        const [restoredConfig] = await tx.$queryRaw<{ settings: string[] }[]>`
          SELECT proconfig AS settings FROM pg_catalog.pg_proc
          WHERE oid = 'sports_management.validate_player_registration()'::regprocedure
        `;
        assert.deepEqual(restoredConfig.settings, triggerConfig.settings);
        const [clockRestored] = await tx.$queryRaw<{ restored: boolean }[]>`SELECT now() = pg_catalog.now() AS restored`;
        assert.equal(clockRestored.restored, true);

        // Composición del contrato compartido en la misma transacción, con el
        // contexto derivado de la inscripción; el DTO solo se lee tras autorizar.
        // No añade un servicio ni endpoint de jugadores que aún no existen.
        const readRegistration = async (registrationId: string) => {
          const registration = await tx.player_registrations.findUniqueOrThrow({ where: { id: registrationId },
            select: { season_id: true, season_teams: { select: { team_id: true, club_id: true } } } });
          await assertPermission(tx, actor.id, { module: "players", action: "READ", context: {
            seasonId: registration.season_id, teamId: registration.season_teams.team_id, clubId: registration.season_teams.club_id,
          } });
          await assertOwnPlayerRegistration(tx, actor.id, registrationId);
          return tx.player_registrations.findUniqueOrThrow({ where: { id: registrationId }, select: { id: true, status: true } });
        };
        const forbidden = (error: unknown) => error instanceof AuthorizationError && error.code === "FORBIDDEN" && error.status === 403;

        await t.test("permiso vigente y registro propio permiten devolver el DTO mínimo", async () => {
          assert.deepEqual(await readRegistration(own.id), { id: own.id, status: "ACTIVE" });
        });
        await t.test("permiso en el mismo equipo/club no permite leer el registro ajeno existente", async () => {
          // El permiso pasa: el rechazo debe proceder de propiedad, no de un UUID ausente.
          await assertPermission(tx, actor.id, { module: "players", action: "READ", context: { teamId: team.id, seasonId: season.id } });
          await assert.rejects(readRegistration(other.id), forbidden);
          assert.equal(await tx.player_registrations.count({ where: { season_id: season.id } }), 2);
        });
        await t.test("propiedad sin permiso no concede lectura; retirar/restaurar permiso es efectivo", async () => {
          await tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } } });
          await assertOwnPlayerRegistration(tx, actor.id, own.id);
          await assert.rejects(readRegistration(own.id), forbidden);
          await tx.role_permissions.create({ data: { role_id: role.id, permission_id: permission.id, context_only: true } });
          assert.deepEqual(await readRegistration(own.id), { id: own.id, status: "ACTIVE" });
        });
        // Revierte fixtures, concesiones, esquema de reloj y auditoría sintética.
        throw rollback;
      }, { timeout: 30_000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  } finally {
    await db.$disconnect();
  }
});
