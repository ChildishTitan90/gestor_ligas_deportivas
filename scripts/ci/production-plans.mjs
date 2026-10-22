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

export function sqlChecksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Excepción exacta revisada en PR: ni nombres sueltos ni SQL suministrado por env. */
export function assertProductionPlan(migrations, applied, readSql) {
  const plan = AFFILIATION_PLAN;
  const pendingCreation = migrations.has(plan.migration) && !applied.has(plan.migration);
  const pendingSecurity = migrations.has(plan.securityMigration) && !applied.has(plan.securityMigration);
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
    assertProductionSql(readSql(name), name);
  }
  return { pendingCreation };
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
  const { rows } = await client.query(`SELECT 1 FROM pg_default_acl d
    LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
    CROSS JOIN pg_roles api
    WHERE d.defaclrole=current_user::regrole AND d.defaclobjtype='r'
      AND (d.defaclnamespace=0 OR n.nspname='sports_management')
      AND api.rolname IN ('anon','authenticated','service_role')
      AND CASE WHEN acl.grantee=0 THEN true ELSE pg_has_role(api.oid,acl.grantee,'USAGE') END
    LIMIT 1`);
  if (rows.length) throw new Error('DEFAULT PRIVILEGES expone tablas nuevas a roles de API; revisar antes de aplicar PDGLD-57.');
}

/** Sin modificar permisos: cualquier desviación deja el despliegue en error. */
export async function assertAffiliationProductionSecurity(client) {
  const { rows: [table] } = await client.query(`SELECT c.oid,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='sports_management' AND c.relname='club_affiliation_categories' AND c.relkind='r'`);
  if (!table?.relrowsecurity) throw new Error('La tabla de categorías de afiliación necesita RLS en producción.');
  const { rows } = await client.query(`SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon','authenticated','service_role') AND (
      has_table_privilege(oid,$1::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      has_any_column_privilege(oid,$1::oid,'SELECT,INSERT,UPDATE,REFERENCES'))`, [table.oid]);
  if (rows.length) throw new Error('La tabla de categorías de afiliación está expuesta a roles de API.');
}
