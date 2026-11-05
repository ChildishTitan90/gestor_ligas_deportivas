import assert from "node:assert/strict";
import { getPrisma } from "../../src/server/db/prisma";
import { applyClubOrTeamMaintenance } from "../../src/features/clubs/server/maintenance";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  const [actor, club, team, affiliation] = process.argv.slice(2);
  assert.ok(actor && club && team && affiliation);
  const db = getPrisma();
  try {
    const snapshot = async () => ({
      affiliation: await db.club_affiliations.findUniqueOrThrow({ where: { id: affiliation } }),
      categories: await db.club_affiliation_categories.findMany({ where: { affiliation_id: affiliation }, orderBy: { category_id: "asc" } }),
      officers: await db.club_officers.findMany({ where: { affiliation_id: affiliation }, orderBy: { id: "asc" } }),
      enrollments: await db.season_teams.findMany({ where: { club_id: club }, orderBy: { id: "asc" } }),
    });
    const before = await snapshot();
    assert.equal(before.affiliation.status, "APPROVED");
    assert.equal(before.officers.length, 3);
    assert.ok(before.officers.every(row => row.signature_file_id));
    assert.ok(before.categories.some(row => row.authorized_by));
    assert.ok(before.enrollments.some(row => row.team_id === team));
    const act = (kind: "club" | "team", id: string, version: number, operation: string) =>
      applyClubOrTeamMaintenance(actor, { kind, id, version, operation, reason: "Validación sintética del historial", confirmed: true });
    for (const [kind, id] of [["club", club], ["team", team]] as const) {
      const row = kind === "club" ? await db.clubs.findUniqueOrThrow({ where: { id } }) : await db.teams.findUniqueOrThrow({ where: { id } });
      await assert.rejects(applyClubOrTeamMaintenance(actor, { kind, id, version: row.version, operation: "edit", name: "Nombre histórico cambiado", reason: "Validación sintética del historial", confirmed: true }), /FORMAL_CHANGE_REQUIRED/);
      await assert.rejects(act(kind, id, row.version, "delete"), /HAS_REFERENCES/);
      await act(kind, id, row.version, "deactivate");
      assert.deepEqual(await snapshot(), before);
      await act(kind, id, row.version + 1, "reactivate");
      assert.deepEqual(await snapshot(), before);
    }
  } finally { await db.$disconnect(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
