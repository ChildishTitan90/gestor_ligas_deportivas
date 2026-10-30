import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tsImport } from 'tsx/esm/api';
import { authorizationAt } from './authorization-clock.mjs';

/** Called only inside the already inspected, disposable PDGLD-106 model database.
 * SQL fixture handover is not an implementation or test of the proposed replacement API.
 */
export async function verifyRepresentativeAgreedRules(db, databaseUrl) {
  const target = new URL(databaseUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.ok(['5432', '5433', '55415', '55417'].includes(target.port || '5432'));
  if (['55415', '55417'].includes(target.port)) assert.equal(target.hostname, '127.0.0.1');
  assert.match(target.pathname, /^\/pdgld106_model_[a-f0-9]{16}$/);
  assert.equal(target.search + target.hash, '');
  const current = (await db.query('SELECT current_database() AS name')).rows[0].name;
  assert.equal(`/${current}`, target.pathname);

  const { loadPermissionCatalog } = await tsImport('../../prisma/permissions-catalog.ts', import.meta.url);
  const { assertPermission } = await tsImport('../../src/server/auth/authorization.ts', import.meta.url);
  const { assertSignatureUploadAccess } = await tsImport('../../src/features/clubs/server/signature-access.ts', import.meta.url);
  const { assertSignatureDownloadAccess } = await tsImport('../../src/features/clubs/server/signature-download-service.ts', import.meta.url);
  const { matchesSignatureBinding } = await tsImport('../../src/features/clubs/server/signature-binding.ts', import.meta.url);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.href, connectionTimeoutMillis: 5000, max: 2 }), log: [] });
  const checks = [];
  const id = async (sql, values = []) => (await db.query(sql, values)).rows[0].id;
  const forbidden = error => error?.code === 'FORBIDDEN' && error.status === 403;
  try {
    // Install only the existing catalog's CLUB_DELEGATE/club grants, without overrides.
    const grants = (await loadPermissionCatalog()).filter(grant => grant.roleCode === 'CLUB_DELEGATE' && grant.module === 'clubs');
    assert.deepEqual(grants.map(grant => grant.action).sort(), ['CREATE', 'READ', 'UPDATE']);
    for (const grant of grants) {
      await db.query('INSERT INTO sports_management.permissions(module,action) VALUES ($1,$2) ON CONFLICT DO NOTHING', [grant.module, grant.action]);
      await db.query(`INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
        SELECT r.id,p.id,$3 FROM sports_management.roles r,sports_management.permissions p
        WHERE r.code='CLUB_DELEGATE' AND p.module=$1 AND p.action=$2 ON CONFLICT DO NOTHING`, [grant.module, grant.action, grant.contextOnly]);
    }
    const permissionSnapshot = async () => (await db.query('SELECT * FROM sports_management.role_permissions ORDER BY id')).rows;
    const policy = await permissionSnapshot();
    const role = await id("SELECT id FROM sports_management.roles WHERE code='CLUB_DELEGATE'");
    const league = await id("INSERT INTO sports_management.leagues(name) VALUES ($1) RETURNING id", [`PDGLD-108 ${randomUUID()}`]);
    const person = async () => {
      const personId = await id("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Persona','Sintética') RETURNING id");
      const suffix = randomUUID();
      const userId = await id(`INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password)
        VALUES ($1,$2,$3,'synthetic-without-login',false) RETURNING id`, [personId, suffix, `${suffix}@example.test`]);
      return { userId, personId };
    };
    const club = async () => id("INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES ($1,'Club sintético',$2) RETURNING id", [league, randomUUID()]);
    const actor = await person();
    await db.query("SELECT set_config('app.user_id',$1,false),set_config('app.reason','PDGLD-108: reglas acordadas, fixture SQL exclusivo',false)", [actor.userId]);
    const designate = (user, clubId, position, start, end = null) => id(`INSERT INTO sports_management.user_roles
      (user_id,role_id,league_id,club_id,delegate_position,starts_at,ends_at)
      VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz) RETURNING id`, [user.userId, role, league, clubId, position, start, end]);

    const deputyClub = await club(); const first = await person(); const second = await person();
    assert.notEqual(first.userId, second.userId); assert.notEqual(first.personId, second.personId);
    await designate(first, deputyClub, 'DEPUTY', '2035-01-01T00:00:00Z');
    const counts = async () => (await db.query(`SELECT
      (SELECT count(*) FROM sports_management.user_roles) assignments,
      (SELECT count(*) FROM sports_management.audit_logs) audit`)).rows[0];
    const before = await counts();
    await assert.rejects(designate(second, deputyClub, 'DEPUTY', '2035-01-02T00:00:00Z'),
      error => error.code === '23P01' && error.constraint === 'user_roles_delegate_position_overlap');
    assert.deepEqual(await counts(), before);
    assert.equal((await db.query('SELECT count(*)::int n FROM sports_management.user_roles WHERE club_id=$1 AND user_id=$2', [deputyClub, second.userId])).rows[0].n, 0);
    checks.push({ case: 'distinct-deputies-capacity', passed: true });

    // Exact microsecond equality is tested against the real SQL authorization predicate.
    for (const position of ['PRIMARY', 'DEPUTY']) {
      const user = await person(); const clubId = await club();
      const assignment = await designate(user, clubId, position, '2035-01-01T00:00:00.123456Z', '2035-01-02T00:00:00.123456Z');
      for (const [instant, allowed] of [
        ['2035-01-01T00:00:00.123455Z', false], ['2035-01-01T00:00:00.123456Z', true],
        ['2035-01-02T00:00:00.123455Z', true], ['2035-01-02T00:00:00.123456Z', false],
      ]) {
        await prisma.$transaction(async transaction => {
          const clock = authorizationAt(transaction, instant);
          const read = () => assertPermission(clock.tx, user.userId, { module: 'clubs', action: 'READ', context: { clubId } });
          if (allowed) assert.ok((await read()).some(grant => grant.assignmentId === assignment));
          else await assert.rejects(read(), forbidden);
          assert.ok(clock.clockStatements() > 0);
        });
      }
    }
    checks.push({ case: 'authorization-inclusive-start-exclusive-end', positions: ['PRIMARY', 'DEPUTY'], passed: true, clock: 'test-sql-adapter' });

    for (const position of ['PRIMARY', 'DEPUTY']) {
      const previous = await person(); const successor = await person(); const clubId = await club();
      const assignment = await designate(previous, clubId, position, new Date(Date.now() - 86_400_000).toISOString());
      const season = await id(`INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date,status)
        SELECT $1,id,$2,'2026-01-01','2026-12-31','ACTIVE' FROM sports_management.sports WHERE code='SOCCER' RETURNING id`, [league, randomUUID()]);
      const fileId = randomUUID();
      const key = `affiliation-signatures/v1/${clubId}/${season}/${previous.userId}/PRESIDENT/${fileId}`;
      await db.query(`INSERT INTO sports_management.files(id,storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by)
        VALUES ($1,$2,'firma-sintetica.png','image/png',100,$3,$4)`, [fileId, key, 'a'.repeat(64), previous.userId]);
      const affiliation = await id(`INSERT INTO sports_management.club_affiliations(club_id,season_id,league_id,reference_number,
        uniform_colors,status,requested_by,review_reason,signed_affiliation_file_id)
        VALUES ($1,$2,$3,$4,'Azul','PENDING',$5,'Corregir captura sintética',$6) RETURNING id`, [clubId, season, league, randomUUID(), previous.userId, fileId]);
      await db.query(`INSERT INTO sports_management.club_officers(affiliation_id,person_id,office,starts_at,signature_file_id)
        VALUES ($1,$2,'PRESIDENT','2026-01-01',$3)`, [affiliation, previous.personId, fileId]);
      const snapshot = async () => ({
        affiliation: (await db.query('SELECT * FROM sports_management.club_affiliations WHERE id=$1', [affiliation])).rows,
        file: (await db.query('SELECT * FROM sports_management.files WHERE id=$1', [fileId])).rows,
        officers: (await db.query('SELECT * FROM sports_management.club_officers WHERE affiliation_id=$1 ORDER BY id', [affiliation])).rows,
        accounts: (await db.query('SELECT id,person_id,is_active,must_change_password,version FROM sports_management.users WHERE id=ANY($1::uuid[]) ORDER BY id', [[previous.userId, successor.userId]])).rows,
      });
      const original = await snapshot();
      await prisma.$transaction(async tx => {
        assert.equal((await assertSignatureUploadAccess(tx, previous.userId, { clubId, seasonId: season })).clubId, clubId);
        assert.equal((await assertSignatureDownloadAccess(tx, previous.userId, fileId)).storageKey, key);
      });
      // Fixture-only handover, not a production replacement service or new permission.
      await db.query('BEGIN');
      try {
        const cut = (await db.query('SELECT clock_timestamp()::text AS cut')).rows[0].cut;
        await db.query('UPDATE sports_management.user_roles SET ends_at=$2::timestamptz WHERE id=$1', [assignment, cut]);
        await designate(successor, clubId, position, cut);
        await db.query('COMMIT');
      } catch (error) { await db.query('ROLLBACK'); throw error; }
      assert.deepEqual(await snapshot(), original);
      await prisma.$transaction(async tx => {
        // Positive control: the incoming account really has UPDATE in this club.
        assert.ok((await assertPermission(tx, successor.userId, { module: 'clubs', action: 'UPDATE', context: { clubId } })).length);
        await assert.rejects(assertSignatureUploadAccess(tx, successor.userId, { clubId, seasonId: season }), forbidden);
        await assert.rejects(assertSignatureUploadAccess(tx, previous.userId, { clubId, seasonId: season }), forbidden);
        // READ remains scoped by club; download does not transfer uploader ownership.
        assert.equal((await assertSignatureDownloadAccess(tx, successor.userId, fileId)).storageKey, key);
        const file = original.file[0];
        assert.equal(matchesSignatureBinding(file, { actorId: previous.userId, clubId, seasonId: season, office: 'PRESIDENT' }), true);
        assert.equal(matchesSignatureBinding(file, { actorId: successor.userId, clubId, seasonId: season, office: 'PRESIDENT' }), false);
      });
      assert.deepEqual(await snapshot(), original);
    }
    assert.deepEqual(await permissionSnapshot(), policy);
    checks.push({ case: 'representation-change-preserves-authorship', positions: ['PRIMARY', 'DEPUTY'], passed: true, handover: 'sql-fixture-not-service' });
    return checks;
  } finally { await prisma.$disconnect(); }
}
