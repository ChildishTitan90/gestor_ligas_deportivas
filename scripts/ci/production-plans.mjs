import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertProductionSql } from './migration-helpers.mjs';

export const AFFILIATION_PLAN = Object.freeze({
  migration: '20261021170000_pdgld57_affiliation_submission',
  checksum: 'c3bd54db78d46d8439bd1c212a91e310a2fa21faab180b7c5961301275ee2be3',
  securityMigration: '20261022090000_pdgld57_supabase_security',
  securityChecksum: 'a2db128a30df17ac20c785b13969b7c21359fbf14da2d8bc3c5d16ed651a2018',
});

export const ENROLLMENT_PLAN = Object.freeze({
  migration: '20261026010000_pdgld64_enrollment_operations',
  checksum: 'cf81c3eeb7de3b3292aa560fd10820c4ba8db7db2217ede110eae0e37c0f6b33',
});

export function sqlChecksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Excepción exacta revisada en PR: ni nombres sueltos ni SQL suministrado por env. */
export function assertProductionPlan(migrations, applied, readSql) {
  const plan = AFFILIATION_PLAN;
  const pendingCreation = migrations.has(plan.migration) && !applied.has(plan.migration);
  const pendingSecurity = migrations.has(plan.securityMigration) && !applied.has(plan.securityMigration);
  const pendingEnrollmentCreation = migrations.has(ENROLLMENT_PLAN.migration) && !applied.has(ENROLLMENT_PLAN.migration);
  // Revisar también el original al reintentar una base ya actualizada.
  if (migrations.has(ENROLLMENT_PLAN.migration) && sqlChecksum(readSql(ENROLLMENT_PLAN.migration)) !== ENROLLMENT_PLAN.checksum) {
    throw new Error('El plan PDGLD-64 exige la migración original y su checksum revisado.');
  }
  if (pendingCreation || pendingSecurity) {
    if (!migrations.has(plan.migration) || !migrations.has(plan.securityMigration) ||
        sqlChecksum(readSql(plan.migration)) !== plan.checksum ||
        sqlChecksum(readSql(plan.securityMigration)) !== plan.securityChecksum ||
        [...migrations.keys()].indexOf(plan.migration) >= [...migrations.keys()].indexOf(plan.securityMigration)) {
      throw new Error('El plan PDGLD-57 exige las dos migraciones originales, en orden y con sus checksums revisados.');
    }
  }
  for (const name of migrations.keys()) {
    if (applied.has(name)) continue;
    if (name === plan.migration && pendingCreation) continue;
    if (name === ENROLLMENT_PLAN.migration && pendingEnrollmentCreation) continue;
    assertProductionSql(readSql(name), name);
  }
  return { pendingCreation, pendingEnrollmentCreation };
}

export function readProductionPlan(directory, migrations, applied) {
  return assertProductionPlan(migrations, applied, name => readFileSync(join(directory, name, 'migration.sql'), 'utf8'));
}

/** Antes de crear la tabla: sus ACL iniciales no deben abrir un intervalo público. */
export async function assertProductionCreationAccess(client) {
  const { rows: [markers] } = await client.query(`SELECT
    (SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth','storage')) +
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS count`);
  if (Number(markers.count) !== 5) throw new Error('El plan de producción requiere los esquemas y roles administrados de Supabase.');
  const { rows } = await client.query(`WITH defaults AS (
    SELECT coalesce((SELECT defaclacl FROM pg_default_acl
      WHERE defaclrole=current_user::regrole AND defaclobjtype='r' AND defaclnamespace=0),
      acldefault('r',current_user::regrole)) AS permissions
    UNION ALL SELECT d.defaclacl FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
      WHERE d.defaclrole=current_user::regrole AND d.defaclobjtype='r' AND n.nspname='sports_management'
    ) SELECT 1 FROM defaults
    CROSS JOIN LATERAL aclexplode(defaults.permissions) acl
    CROSS JOIN pg_roles api
    WHERE api.rolname IN ('anon','authenticated','service_role')
      AND (api.rolsuper OR CASE WHEN acl.grantee=0 THEN true ELSE pg_has_role(api.oid,acl.grantee,'USAGE') END)
    LIMIT 1`);
  if (rows.length) throw new Error('DEFAULT PRIVILEGES expone tablas nuevas a roles de API; revisar antes de crear tablas PDGLD-57/64.');
}

/** Sin modificar permisos: cualquier desviación deja el despliegue en error. */
export async function assertAffiliationProductionSecurity(client) {
  return assertReviewedTableSecurity(client, 'club_affiliation_categories');
}

export async function assertEnrollmentProductionSecurity(client) {
  return assertReviewedTableSecurity(client, 'team_enrollment_operations');
}

async function assertReviewedTableSecurity(client, name) {
  const { rows: [table] } = await client.query(`SELECT c.oid,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='sports_management' AND c.relname=$1 AND c.relkind='r'`, [name]);
  if (!table?.relrowsecurity) throw new Error(`La tabla ${name} necesita RLS en producción.`);
  const { rows } = await client.query(`SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role') AND (
      has_table_privilege(oid,$1::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_any_column_privilege(oid,$1::oid,'SELECT,INSERT,UPDATE,REFERENCES') OR
      EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl
        WHERE c.oid=$1::oid AND CASE WHEN acl.grantee=0 THEN true ELSE pg_has_role(pg_roles.oid,acl.grantee,'USAGE') END))`, [table.oid]);
  // aclexplode incluye MAINTAIN (PG17) sin enviar ese nombre a PostgreSQL 15.
  const { rows: roles } = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')");
  if (roles.length !== 3 || rows.length) throw new Error(`La tabla ${name} está expuesta a roles de API o faltan sus roles administrados.`);
}

export async function assertAppliedProductionSecurity(client, applied) {
  if (applied.has(AFFILIATION_PLAN.migration)) await assertAffiliationProductionSecurity(client);
  if (applied.has(ENROLLMENT_PLAN.migration)) await assertEnrollmentProductionSecurity(client);
}
