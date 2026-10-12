import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function checksumVariants(sql) {
  const lf = sql.replace(/\r\n/g, '\n');
  return new Set([sql, lf, lf.replace(/\n/g, '\r\n')].map(value => createHash('sha256').update(value).digest('hex')));
}

export function readMigrations(directory) {
  const migrations = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!entry.isDirectory()) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(entry.name)) throw new Error('Nombre de migración no válido.');
    const sql = readFileSync(join(directory, entry.name, 'migration.sql'), 'utf8');
    if (!sql.trim()) throw new Error(`Migración vacía: ${entry.name}`);
    migrations.set(entry.name, checksumVariants(sql));
  }
  if (!migrations.has('0_init')) throw new Error('Falta la migración inicial 0_init.');
  return migrations;
}

export function assertAppliedHistory(history, migrations) {
  if (!history.length) throw new Error('Producción necesita su baseline previamente verificado y registrado.');
  const applied = new Set();
  for (const row of history) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at) throw new Error(`Existe una migración fallida o incompleta: ${row.migration_name}`);
    const checksums = migrations.get(row.migration_name);
    if (!checksums) throw new Error(`Falta un archivo de migración ya aplicado: ${row.migration_name}`);
    if (!checksums.has(row.checksum)) throw new Error(`Cambió una migración ya aplicada: ${row.migration_name}`);
    applied.add(row.migration_name);
  }
  if (!applied.has('0_init')) throw new Error('El baseline 0_init no está aplicado.');
  const expected = [...migrations.keys()].slice(0, applied.size);
  if ([...applied].some((name, index) => name !== expected[index])) {
    throw new Error('El orden de migraciones no coincide con producción. Corrige la migración aún no compartida antes de desplegar.');
  }
  return applied;
}

export function productionConnection(rawUrl, projectRef, certificatePath) {
  if (!rawUrl || !projectRef || !certificatePath) throw new Error('Faltan los secretos, el proyecto o el certificado de producción.');
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('SUPABASE_PROJECT_REF no es válido.');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('La URL de migraciones no es válida.'); }
  const direct = url.hostname === `db.${projectRef}.supabase.co` && url.username === 'postgres';
  const session = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.username === `postgres.${projectRef}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !session) || url.port !== '5432' || url.pathname !== '/postgres' || !url.password) {
    throw new Error('La conexión debe ser directa o de sesión (5432) del proyecto Supabase de producción esperado.');
  }
  // Evita que parámetros de la URL sustituyan el destino o la configuración TLS.
  url.search = '';
  url.searchParams.set('schema', 'public');
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('sslcert', certificatePath);
  return url;
}

export function assertProductionSql(sql, name) {
  // Filtro conservador: esos cambios necesitan plan de seguridad específico en nube.
  // No sustituye la revisión del SQL ni pretende interpretar SQL dinámico.
  if (/\bCREATE\s+(?:(?:UNLOGGED|TEMP|TEMPORARY)\s+)?TABLE\b/i.test(sql) || /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(sql)) {
    throw new Error(`La migración ${name} crea tablas o desactiva RLS. Requiere un plan de seguridad de producción antes de usar este despliegue.`);
  }
}

export function redact(message, urls = []) {
  let output = String(message ?? '').replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[URL omitida]');
  for (const url of urls) for (const password of [url.password, (() => { try { return decodeURIComponent(url.password); } catch { return ''; } })()]) {
    if (password) output = output.replaceAll(password, '[secreto omitido]');
  }
  return output;
}
