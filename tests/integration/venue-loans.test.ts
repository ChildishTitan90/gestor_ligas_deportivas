import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { getPrisma } from "../../src/server/db/prisma";
import { AuthorizationError } from "../../src/server/auth/authorization";
import type { PrivateDocumentTransport } from "../../src/server/files/private-document-storage";
import { decideVenueLoanForActor, previewVenueLoanLetterForActor, submitVenueLoanForActor } from "../../src/features/venues/server/loans";
import { loadHomeVenueOptions } from "../../src/features/venues/server/scheduling-options";
import { sendVenueLoan, type VenueLoanCapture, type VenueLoanRecoveryStore } from "../../src/features/venues/venue-loan-recovery.client";

assert.ok(process.env.DATABASE_URL, "Configura una base PostgreSQL temporal para PDGLD-23");
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.protocol, "postgresql:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(`${target.port}${target.pathname}`, process.env.GITHUB_ACTIONS === "true" ? "5432/gestor_ligas_ci" : "55423/pdgld23");
assert.equal(target.search + target.hash, "");

test("préstamos privados, decisión concurrente y opciones de localía en PostgreSQL", async () => {
  const db = getPrisma();
  try {
    const tag = randomUUID();
    const date = (value: string) => new Date(value);
    const first = date("2026-11-14");
    const last = date("2026-11-21");
    const at = (time: string) => date(`2026-11-14T${time}:00Z`);
    const { season, day, home, away, president, scheduler, privateVenue, complex, rival } = await db.$transaction(async tx => {
      const league = await tx.leagues.create({ data: { name: tag, timezone: "UTC" } });
      const sport = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
      const season = await tx.seasons.create({ data: {
        league_id: league.id, sport_id: sport.id, name: tag, start_date: first, end_date: last,
      } });
      const fixturePerson = await tx.people.create({ data: { first_name: "Fixture", paternal_surname: tag } });
      const fixtureUser = await tx.users.create({ data: {
        person_id: fixturePerson.id, username: tag, email: `${tag}@example.test`, password_hash: "fixture-only",
      } });
      await tx.$queryRaw`SELECT set_config('app.user_id', ${fixtureUser.id}, true), set_config('app.reason', 'PDGLD-23 fixture', true)`;
      const rule = await tx.competition_rules.create({ data: { season_id: season.id, version_number: 1 } });
      const catalog = await tx.categories.create({ data: { league_id: league.id, sport_id: sport.id, name: tag } });
      const category = await tx.season_categories.create({ data: {
        season_id: season.id, category_id: catalog.id, competition_rule_id: rule.id,
        hierarchy_order: 1, type: "OPEN", eligibility_pending: true, competition_format: "GENERAL_TABLE",
      } });
      const group = await tx.groups.create({ data: { season_id: season.id, season_category_id: category.id, name: "General" } });
      const day = await tx.matchdays.create({ data: { season_id: season.id, number: 1, start_date: first, end_date: first } });
      await tx.matchdays.create({ data: { season_id: season.id, number: 2, start_date: last, end_date: last } });

      async function createActor(code: string, clubId?: string) {
        const name = randomUUID();
        const role = await tx.roles.findUniqueOrThrow({ where: { code } });
        const person = await tx.people.create({ data: { first_name: "Fixture", paternal_surname: name } });
        const user = await tx.users.create({ data: {
          person_id: person.id, username: name, email: `${name}@example.test`, password_hash: "fixture-only",
          must_change_password: false,
        } });
        await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true), set_config('app.reason', 'PDGLD-23 fixture', true)`;
        await tx.user_roles.create({ data: {
          user_id: user.id, role_id: role.id, league_id: league.id, club_id: clubId,
          delegate_position: clubId ? "PRIMARY" : null,
        } });
        return user.id;
      }

      async function createClubTeam() {
        const name = randomUUID();
        const club = await tx.clubs.create({ data: { league_id: league.id, name, reference_number: name } });
        const delegate = await createActor("CLUB_DELEGATE", club.id);
        await tx.club_affiliations.create({ data: {
          season_id: season.id, club_id: club.id, league_id: league.id,
          reference_number: name, uniform_colors: "Azul", requested_by: delegate,
        } });
        const team = await tx.teams.create({ data: { club_id: club.id, name, reference_number: name } });
        const enrollment = await tx.season_teams.create({ data: {
          season_id: season.id, club_id: club.id, team_id: team.id, group_id: group.id, status: "ACTIVE",
        } });
        return { club, delegate, enrollment };
      }

      const home = await createClubTeam();
      const away = await createClubTeam();
      const president = await createActor("EXECUTIVE_PRESIDENT");
      const scheduler = await createActor("SCHEDULER");
      async function createVenue(code: string, isComplex: boolean) {
        const venue = await tx.venues.create({ data: {
          league_id: league.id, code, name: code, address: "Domicilio sintético",
          is_league_sports_complex: isComplex, match_duration_minutes: 60, buffer_minutes: 15,
        } });
        await tx.venue_availability.create({ data: {
          venue_id: venue.id, type: "AVAILABLE", starts_at: at("10:00"), ends_at: at("15:00"),
        } });
        return venue.id;
      }
      const privateVenue = await createVenue("PARTICULAR", false);
      const complex = await createVenue("UNIDAD", true);
      const rival = await createVenue("RIVAL", false);
      return { season, day, home, away, president, scheduler, privateVenue, complex, rival };
    });
    const options = (time = "11:00", finalRounds = 1, priorHomeVenueId?: string) =>
      db.$transaction(tx => loadHomeVenueOptions(tx, scheduler, {
        seasonId: season.id, matchdayId: day.id, homeSeasonTeamId: home.enrollment.id,
        awaySeasonTeamId: away.enrollment.id, startsAt: at(time),
        complexOnlyFinalRounds: finalRounds, priorHomeVenueId,
      })).then(rows => rows.map(row => row.venueId));

    const files = new Map<string, Uint8Array>();
    let signed = 0;
    const storage: PrivateDocumentTransport = {
      async put(key, { bytes }) {
        const replayed = files.has(key);
        if (replayed) assert.deepEqual(files.get(key), bytes);
        files.set(key, bytes);
        return { replayed };
      },
      async read(key) {
        const bytes = files.get(key);
        assert.ok(bytes);
        return bytes;
      },
      async createDownloadUrl() {
        signed++;
        return { downloadUrl: "https://example.test/carta", expiresInSeconds: 60 };
      },
    };
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText("Carta sintetica de prueba PDGLD-23");
    const file = { bytes: await pdf.save(), mimeType: "application/pdf" };
    const request = {
      requestId: randomUUID(), seasonId: season.id, clubId: home.club.id, venueId: privateVenue,
      windows: [{ startsAt: at("11:00").toISOString(), endsAt: at("13:00").toISOString() }],
    };
    await assert.rejects(submitVenueLoanForActor(away.delegate, request, file, storage), AuthorizationError);
    const capture: VenueLoanCapture = {
      requestId: request.requestId, contextId: randomUUID(), venueId: privateVenue,
      windows: [{ id: randomUUID(), start: "2026-11-14T11:00", end: "2026-11-14T13:00" }],
      letter: new File([new Uint8Array(file.bytes)], "carta.pdf", { type: file.mimeType }),
    };
    let saved: VenueLoanCapture | undefined;
    const recovery: VenueLoanRecoveryStore = {
      async read() { return saved && structuredClone(saved); },
      async add(value) {
        assert.equal(saved, undefined);
        saved = structuredClone(value);
      },
      async remove(id) {
        assert.equal(id, saved?.requestId);
        saved = undefined;
      },
    };
    async function saveOnServer(body: FormData) {
      assert.deepEqual(JSON.parse(String(body.get("payload"))), {
        requestId: request.requestId, contextId: capture.contextId, venueId: privateVenue,
        windows: [{ start: "2026-11-14T11:00", end: "2026-11-14T13:00" }],
      });
      const letter = body.get("letter");
      assert.ok(letter instanceof File);
      assert.equal(letter.name, capture.letter.name);
      const bytes = new Uint8Array(await letter.arrayBuffer());
      assert.deepEqual(bytes, file.bytes);
      return submitVenueLoanForActor(home.delegate, request, { bytes, mimeType: letter.type }, storage);
    }
    assert.equal(await sendVenueLoan(recovery, capture, false, async body => {
      assert.equal((await saveOnServer(body)).status, "PENDING");
      throw new Error("Respuesta perdida después de guardar en PostgreSQL");
    }), "uncertain");
    assert.equal(await db.venue_loans.count({ where: { id: request.requestId } }), 1);
    const recovered = await recovery.read();
    assert.ok(recovered);
    assert.equal(await sendVenueLoan(recovery, recovered, true, async body => Response.json(await saveOnServer(body))), "confirmed");
    assert.equal(await recovery.read(), undefined);
    assert.equal(await db.venue_loans.count({ where: { requested_by: home.delegate, venue_id: privateVenue } }), 1);
    assert.equal(files.size, 1);
    assert.deepEqual(await options(), [complex]);
    await assert.rejects(previewVenueLoanLetterForActor(away.delegate, request.requestId, storage), AuthorizationError);
    assert.equal(signed, 0);
    assert.deepEqual(await previewVenueLoanLetterForActor(president, request.requestId, storage), {
      downloadUrl: "https://example.test/carta", expiresInSeconds: 60, mimeType: "application/pdf",
    });

    const reason = "Decisión sintética de aceptación";
    const decide = (id: string, status: "APPROVED" | "REJECTED") =>
      decideVenueLoanForActor(president, { requestId: id, status, reason });
    await assert.rejects(decideVenueLoanForActor(home.delegate, {
      requestId: request.requestId, status: "APPROVED", reason,
    }), AuthorizationError);
    const outcomes = await Promise.allSettled([decide(request.requestId, "APPROVED"), decide(request.requestId, "REJECTED")]);
    const [winner] = outcomes.filter(result => result.status === "fulfilled");
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    assert.match(outcomes.find(result => result.status === "rejected")?.reason.message, /REQUEST_NOT_PENDING/);
    assert.equal(await db.audit_logs.count({ where: { entity_id: request.requestId, action: "UPDATE", reason } }), 1);
    assert.equal((await decide(request.requestId, winner.value.status as "APPROVED" | "REJECTED")).status, winner.value.status);
    assert.equal(await db.audit_logs.count({ where: { entity_id: request.requestId, action: "UPDATE", reason } }), 1);

    const second = { ...request, requestId: randomUUID() };
    await submitVenueLoanForActor(home.delegate, second, file, storage);
    if (winner.value.status === "APPROVED") {
      await decide(second.requestId, "REJECTED");
    } else {
      assert.deepEqual(await options(), [complex]);
      await decide(second.requestId, "APPROVED");
    }
    assert.deepEqual(await options(), [privateVenue, complex]);
    assert.deepEqual(await options("12:00"), [complex]);
    assert.deepEqual(await options("11:00", 2), [complex]);
    assert.deepEqual(await options("11:00", 0), [privateVenue, complex]);

    const rivalLoan = { ...request, requestId: randomUUID(), clubId: away.club.id, venueId: rival };
    await submitVenueLoanForActor(away.delegate, rivalLoan, file, storage);
    await decide(rivalLoan.requestId, "APPROVED");
    assert.deepEqual(await options(), [privateVenue, complex]);
    assert.deepEqual(await options("11:00", 1, rival), [privateVenue, complex, rival]);
  } finally {
    await db.$disconnect();
  }
});
