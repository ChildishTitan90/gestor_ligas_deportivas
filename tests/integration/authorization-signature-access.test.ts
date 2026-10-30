import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPrisma } from "../../src/server/db/prisma";
import {
  AuthorizationError,
  lockAuthorization,
} from "../../src/server/auth/authorization";
import {
  assertSignatureUploadAccess,
  SignatureAccessError,
} from "../../src/features/clubs/server/signature-access";
import { assertSignatureDownloadAccess } from "../../src/features/clubs/server/signature-download-service";

test("PDGLD-59: firmas limitadas al club y liga autorizados", async () => {
  // No permitir que esta prueba use una base habitual o remota.
  assert.equal(process.env.AUTH_TEST_RUN, "1");

  const target = new URL(process.env.DATABASE_URL ?? "");

  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  );
  assert.ok(["5432", "5433"].includes(target.port || "5432"));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");

  const db = getPrisma();
  const suffix = randomUUID();
  const rollback = new Error("ROLLBACK_PDGLD59_SIGNATURE_FIXTURES");

  try {
    try {
      await db.$transaction(async (tx) => {
        await lockAuthorization(tx, "exclusive");

        const person = await tx.people.create({
          data: {
            first_name: "Delegado sintético",
            paternal_surname: "Prueba",
          },
        });

        const actor = await tx.users.create({
          data: {
            person_id: person.id,
            username: `pd59-${suffix}`,
            email: `pd59-${suffix}@example.test`,
            password_hash: "fixture-without-login",
            must_change_password: false,
          },
        });

        await tx.$queryRaw`
          SELECT
            set_config('app.user_id', ${actor.id}, true),
            set_config('app.reason', 'PDGLD-59: prueba de firmas', true)
        `;

        const leagueA = await tx.leagues.create({
          data: { name: `Liga A firmas ${suffix}` },
        });

        const leagueB = await tx.leagues.create({
          data: { name: `Liga B firmas ${suffix}` },
        });

        const sport = await tx.sports.findFirstOrThrow();

        const createSeason = (leagueId: string) =>
          tx.seasons.create({
            data: {
              league_id: leagueId,
              sport_id: sport.id,
              name: `Temporada firmas ${suffix}`,
              start_date: new Date("2026-01-01T00:00:00Z"),
              end_date: new Date("2026-12-31T00:00:00Z"),
              status: "PLANNED",
            },
          });

        const seasonA = await createSeason(leagueA.id);
        const seasonB = await createSeason(leagueB.id);

        const createClub = (label: string) =>
          tx.clubs.create({
            data: {
              league_id: leagueA.id,
              name: `Club ${label} ${suffix}`,
              reference_number: `pd59-${label}-${suffix}`,
              status: "ACTIVE",
            },
          });

        const ownClub = await createClub("propio");
        const otherClub = await createClub("ajeno");

        const role = await tx.roles.findUniqueOrThrow({
          where: { code: "CLUB_DELEGATE" },
        });

        const permission = await tx.permissions.upsert({
          where: {
            module_action: { module: "clubs", action: "CREATE" },
          },
          update: {},
          create: { module: "clubs", action: "CREATE" },
        });

        const grant = await tx.role_permissions.upsert({
          where: {
            role_id_permission_id: {
              role_id: role.id,
              permission_id: permission.id,
            },
          },
          update: { context_only: true },
          create: {
            role_id: role.id,
            permission_id: permission.id,
            context_only: true,
          },
        });

        await tx.user_roles.create({
          data: {
            user_id: actor.id,
            role_id: role.id,
            league_id: leagueA.id,
            club_id: ownClub.id,
            delegate_position: "PRIMARY",
            starts_at: new Date(Date.now() - 60_000),
          },
        });

        // Control positivo: el delegado sí puede usar su propio club.
        const allowed = await assertSignatureUploadAccess(
          tx,
          actor.id,
          { clubId: ownClub.id, seasonId: seasonA.id },
        );

        assert.equal(allowed.clubId, ownClub.id);
        assert.equal(allowed.leagueId, leagueA.id);

        // Cambiar únicamente el club no concede acceso.
        await assert.rejects(
          assertSignatureUploadAccess(tx, actor.id, {
            clubId: otherClub.id,
            seasonId: seasonA.id,
          }),
          (error: unknown) =>
            error instanceof AuthorizationError &&
            error.status === 403,
        );

        // Un club propio no habilita temporadas de otra liga.
        await assert.rejects(
          assertSignatureUploadAccess(tx, actor.id, {
            clubId: ownClub.id,
            seasonId: seasonB.id,
          }),
          (error: unknown) =>
            error instanceof SignatureAccessError &&
            error.code === "INVALID_CONTEXT",
        );

        // Conservar el rol no basta después de retirar CREATE.
        await tx.role_permissions.delete({
          where: {
            role_id_permission_id: {
              role_id: grant.role_id,
              permission_id: grant.permission_id,
            },
          },
        });

        await assert.rejects(
          assertSignatureUploadAccess(tx, actor.id, {
            clubId: ownClub.id,
            seasonId: seasonA.id,
          }),
          (error: unknown) =>
            error instanceof AuthorizationError &&
            error.status === 403,
        );

        // UPDATE permite reemplazar una firma únicamente para corregir la
        // solicitud propia. No habilita cargas de una afiliación nueva.
        const update = await tx.permissions.upsert({ where: { module_action: { module: "clubs", action: "UPDATE" } },
          update: {}, create: { module: "clubs", action: "UPDATE" } });
        await tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role.id, permission_id: update.id } },
          update: { context_only: true }, create: { role_id: role.id, permission_id: update.id, context_only: true } });
        await assert.rejects(assertSignatureUploadAccess(tx, actor.id, { clubId: ownClub.id, seasonId: seasonA.id }), AuthorizationError);
        const correction = await tx.club_affiliations.create({ data: { club_id: ownClub.id, season_id: seasonA.id,
          league_id: leagueA.id, requested_by: actor.id, reference_number: `pd60-${suffix}`,
          status: "PENDING", uniform_colors: "Blanco sintético", review_reason: "Reemplazar la firma sintética." } });
        assert.equal((await assertSignatureUploadAccess(tx, actor.id, { clubId: ownClub.id, seasonId: seasonA.id })).clubId, ownClub.id);
        const otherPerson = await tx.people.create({ data: { first_name: "Otro solicitante sintético", paternal_surname: "Prueba" } });
        const otherActor = await tx.users.create({ data: { person_id: otherPerson.id, username: `pd60-${suffix}`,
          email: `pd60-${suffix}@example.test`, password_hash: "fixture-without-login", must_change_password: false } });
        await tx.club_affiliations.update({ where: { id: correction.id }, data: { requested_by: otherActor.id } });
        await assert.rejects(assertSignatureUploadAccess(tx, actor.id, { clubId: ownClub.id, seasonId: seasonA.id }), AuthorizationError);
        await tx.club_affiliations.update({ where: { id: correction.id }, data: { requested_by: actor.id } });
        await tx.club_affiliations.update({ where: { id: correction.id }, data: { review_reason: null } });
        await assert.rejects(assertSignatureUploadAccess(tx, actor.id, { clubId: ownClub.id, seasonId: seasonA.id }), AuthorizationError);
        await tx.club_affiliations.update({ where: { id: correction.id }, data: { review_reason: "Firma pendiente." } });
        await tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: role.id, permission_id: update.id } } });
        await assert.rejects(assertSignatureUploadAccess(tx, actor.id, { clubId: ownClub.id, seasonId: seasonA.id }), AuthorizationError);

        const fileId = randomUUID();
        const storageKey = `affiliation-signatures/v1/${ownClub.id}/${seasonA.id}/${actor.id}/PRESIDENT/${fileId}`;
        await tx.files.create({ data: { id: fileId, storage_key: storageKey, uploaded_by: actor.id,
          original_name: "firma-sintetica.png", mime_type: "image/png", size_bytes: 100, sha256: "a".repeat(64) } });
        const read = await tx.permissions.upsert({ where: { module_action: { module: "clubs", action: "READ" } },
          update: {}, create: { module: "clubs", action: "READ" } });
        await tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role.id, permission_id: read.id } },
          update: { context_only: true }, create: { role_id: role.id, permission_id: read.id, context_only: true } });
        assert.equal((await assertSignatureDownloadAccess(tx, actor.id, fileId)).storageKey, storageKey);
        await assert.rejects(assertSignatureDownloadAccess(tx, otherActor.id, fileId), AuthorizationError);
        await tx.role_permissions.delete({ where: { role_id_permission_id: { role_id: role.id, permission_id: read.id } } });
        await assert.rejects(assertSignatureDownloadAccess(tx, actor.id, fileId), AuthorizationError);

        // Revertir todos los datos y ajustes creados por esta prueba.
        throw rollback;
      }, { timeout: 30_000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  } finally {
    await db.$disconnect();
  }
});
