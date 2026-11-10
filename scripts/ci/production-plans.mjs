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

// Plan específico: tabla privada de intentos, RLS solo en Supabase y ninguna política para roles API.
export const CURP_PLAN = Object.freeze({
  migration: '20261031020000_pdgld97_curp_checks',
  checksum: '53783b4250f3936ef2767825cb74d9755963d0842abc776d766fd5a1dad01525',
});

// PDGLD-38 usa una única tabla TEMP ON COMMIT DROP para restaurar el estado de
// dos triggers tras proyectar categorías. No crea tablas persistentes ni ACL.
// La excepción cubre solo este archivo exacto; modificarlo exige otra revisión.
export const DISTRIBUTION_PLAN = Object.freeze({
  migration: '20261029130000_pdgld38_pending_distribution',
  checksum: '8cd0c79f5a5044ced2575e1648c38a0ec2bff72d6ba620af8684dca1893c76b9',
});

// Cada migración se revisó con RLS en Supabase y sin acceso de roles de API.
// El checksum impide que un cambio posterior herede esta autorización.
export const PRIVATE_TABLE_PLANS = Object.freeze([
  ['20261104020000_pdgld13_category_participations', 'd705a50e6e0e9b8c7864a8bc7eaaf04baf59990e62fb9a6c70c94bb2550b655b', ['player_category_levels', 'player_category_participations']],
  ['20261105020000_pdgld118_pending_email', '95416e2811d865d283ca44eace7ab0f4ab15556af6ac3a2961a98d3e9dbef1dd', ['account_email_changes']],
  ['20261108010000_pdgld117_identity_corrections', '5c8244040be0e00bbd7a2c2c781f7a34afdf7d901461eabb14b842c356a4365f', ['player_identity_corrections', 'player_identity_correction_evidence']],
  ['20261108020000_pdgld117_season_identity_snapshots', 'd14923ab7bff900a6dcc982ff1b0447a2954c1cfe08a51ba75f4b39c410a4309', ['season_person_identity_snapshots']],
  ['20261108030000_pdgld117_identity_closure_receipts', '1fb5ea49cffff85a278ed6b4424bb334de1dda4e9d6c9b17c3fe3ca75ed27aa6', ['season_identity_closures']],
  ['20261109010000_pdgld117_selective_history', '9df24df62d11b9d0383e8a252757daefcb058c15c0ea269bfc7b005eb71bc148', ['season_registration_history']],
]);

export function sqlChecksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Excepción exacta revisada en PR: ni nombres sueltos ni SQL suministrado por env. */
export function assertProductionPlan(migrations, applied, readSql) {
  if (migrations.has(DISTRIBUTION_PLAN.migration) && sqlChecksum(readSql(DISTRIBUTION_PLAN.migration)) !== DISTRIBUTION_PLAN.checksum) {
    throw new Error('El plan PDGLD-38 exige la migración original de distribución y su checksum revisado.');
  }
  const plan = AFFILIATION_PLAN;
  const pendingCreation = migrations.has(plan.migration) && !applied.has(plan.migration);
  const pendingSecurity = migrations.has(plan.securityMigration) && !applied.has(plan.securityMigration);
  const pendingEnrollmentCreation = migrations.has(ENROLLMENT_PLAN.migration) && !applied.has(ENROLLMENT_PLAN.migration);
  const pendingCurpCreation = migrations.has(CURP_PLAN.migration) && !applied.has(CURP_PLAN.migration);
  const pendingPrivateCreations = PRIVATE_TABLE_PLANS.filter(([name]) => migrations.has(name) && !applied.has(name));
  for (const [name, checksum] of PRIVATE_TABLE_PLANS) {
    if (migrations.has(name) && sqlChecksum(readSql(name)) !== checksum)
      throw new Error(`El plan de seguridad de ${name} exige el SQL original y su checksum revisado.`);
  }
  if (migrations.has(CURP_PLAN.migration) && sqlChecksum(readSql(CURP_PLAN.migration)) !== CURP_PLAN.checksum)
    throw new Error('El plan PDGLD-97 exige la migración original y su checksum revisado.');
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
    if (name === CURP_PLAN.migration && pendingCurpCreation) continue;
    if (name === DISTRIBUTION_PLAN.migration) continue;
    if (PRIVATE_TABLE_PLANS.some(([planned]) => planned === name)) continue;
    assertProductionSql(readSql(name), name);
  }
  return { pendingCreation, pendingEnrollmentCreation, pendingCurpCreation,
    ...(pendingPrivateCreations.length ? { pendingPrivateCreations: pendingPrivateCreations.map(([name]) => name) } : {}) };
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

export async function assertCurpProductionSecurity(client) {
  return assertReviewedTableSecurity(client, 'player_curp_checks');
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
  if (applied.has(CURP_PLAN.migration)) await assertCurpProductionSecurity(client);
  for (const [migration, , tables] of PRIVATE_TABLE_PLANS) {
    if (applied.has(migration)) for (const table of tables) await assertReviewedTableSecurity(client, table);
  }
}
