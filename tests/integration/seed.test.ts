import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import test, { type TestContext } from 'node:test';
import pg from 'pg';
import { SEED_ACTOR, SEED_AUDIT_REASON, SEED_CONTEXT, SEED_ROLES } from '../../prisma/seed-data';

const require = createRequire(import.meta.url);
const OFFICIAL_ROLES = [
  'SUPERADMIN', 'EXECUTIVE_PRESIDENT', 'SECRETARY', 'TREASURER',
  'DISCIPLINARY_BOARD', 'REFEREE_MANAGER', 'SCHEDULER', 'CLUB_DELEGATE',
  'REFEREE', 'DATA_ENTRY', 'PLAYER', 'GUEST',
].sort();
type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;
type CommandResult = { status: number | null; output: string };

function targetUrl() {
  assert.equal(process.env.SEED_TEST_DATABASE, 'gestor_ligas_ci', 'Ejecutar mediante npm run test:seed.');
  let target;
  try { target = new URL(process.env.DIRECT_URL ?? ''); } catch { assert.fail('Falta una URL válida de base temporal.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'Las pruebas requieren PostgreSQL.');
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'Las pruebas solo usan loopback.');
  assert.equal(target.pathname, '/gestor_ligas_ci', 'Las pruebas solo usan gestor_ligas_ci.');
  assert.match(target.port, /^\d+$/, 'Las pruebas requieren un puerto local explícito.');
  assert.equal(target.hash, '', 'Las URL de pruebas no permiten fragmentos.');
  for (const [key, value] of target.searchParams) {
    assert.ok(key === 'schema' && value === 'public', 'Las URL de pruebas solo permiten schema=public.');
  }
  return target.href;
}

function command(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('No se pudo iniciar el comando local del seed.'));
    });
    child.once('close', status => { clearTimeout(timer); resolve({ status, output }); });
  });
}

async function seedCli(expectedStatus = 0) {
  // Regresión del entorno local del equipo: admite ambos esquemas por coma.
  const env = { ...process.env };
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const target = new URL(env[key] ?? '');
    target.searchParams.set('schema', 'public,sports_management');
    env[key] = target.href;
  }
  const result = await command([require.resolve('prisma/build/index.js'), 'db', 'seed'], env);
  let safeOutput = result.output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[URL omitida]');
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const credential = decodeURIComponent(new URL(process.env[key] ?? '').password);
    if (credential) safeOutput = safeOutput.replaceAll(credential, '[secreto omitido]');
  }
  assert.equal(result.status, expectedStatus, `El comando explícito prisma db seed debe tener el resultado esperado.\n${safeOutput}`);
  return result;
}

async function snapshot(client: pg.Client): Promise<Snapshot> {
  const { rows: tables } = await client.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'sports_management' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  assert.equal(tables.length, 96, 'La prueba debe partir del baseline de 96 tablas.');
  const result: Snapshot = {};
  for (const { table_name: tableName } of tables) {
    assert.match(tableName, /^[a-z_]+$/, 'Los identificadores SQL deben pertenecer al baseline.');
    const { rows } = await client.query<{ records: Row[] }>(`
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id), '[]'::jsonb) AS records
      FROM sports_management."${tableName}" AS t
    `);
    result[tableName] = rows[0].records;
  }
  return result;
}

function one(rows: Row[], predicate: (row: Row) => boolean, message: string) {
  const found = rows.filter(predicate);
  assert.equal(found.length, 1, message);
  return found[0];
}

function context(state: Snapshot) {
  const sport = one(state.sports, row => row.code === 'SOCCER', 'Debe reutilizarse exactamente un deporte SOCCER.');
  const league = one(state.leagues, row => row.name === SEED_CONTEXT.leagueName, 'Debe existir exactamente la liga sintética.');
  const season = one(state.seasons, row => row.league_id === league.id && row.sport_id === sport.id
    && row.name === SEED_CONTEXT.seasonName, 'La temporada debe pertenecer a su liga y deporte.');
  const category = one(state.categories, row => row.league_id === league.id && row.sport_id === sport.id
    && row.name === SEED_CONTEXT.categoryName, 'La categoría debe pertenecer a su liga y deporte.');
  const rule = one(state.competition_rules, row => row.season_id === season.id && row.version_number === SEED_CONTEXT.ruleVersion,
    'El reglamento debe pertenecer a su temporada y versión.');
  const seasonCategory = one(state.season_categories, row => row.season_id === season.id && row.category_id === category.id,
    'La categoría por temporada debe usar su clave completa.');
  const group = one(state.groups, row => row.season_category_id === seasonCategory.id && row.name === SEED_CONTEXT.groupName,
    'El grupo debe usar su categoría por temporada.');
  assert.equal(seasonCategory.competition_rule_id, rule.id, 'La categoría por temporada debe usar el reglamento correcto.');
  assert.equal(group.season_id, season.id, 'El grupo debe pertenecer a la misma temporada.');
  assert.equal(season.start_date, SEED_CONTEXT.startDate);
  assert.equal(season.end_date, SEED_CONTEXT.endDate);
  assert.equal(season.status, 'PLANNED');
  assert.equal(rule.status, 'DRAFT');
  assert.equal(rule.approved_by, null);
  assert.equal(rule.approved_at, null);
  assert.equal(seasonCategory.age_cutoff_date, SEED_CONTEXT.ageCutoffDate);
  assert.equal(seasonCategory.hierarchy_order, SEED_CONTEXT.hierarchyOrder);
  assert.equal(seasonCategory.type, SEED_CONTEXT.categoryType);
  assert.equal(seasonCategory.minimum_age, null);
  assert.equal(seasonCategory.maximum_age, null);
  return { sport, league, season, category, rule, seasonCategory, group };
}

function evidence(t: TestContext, phase: string, state: Snapshot) {
  const tables = ['roles', 'sports', 'leagues', 'seasons', 'categories', 'competition_rules',
    'season_categories', 'groups', 'people', 'users', 'user_roles', 'permissions', 'role_permissions', 'audit_logs'];
  t.diagnostic(JSON.stringify({ phase, counts: Object.fromEntries(tables.map(table => [table, state[table].length])) }));
  if (phase !== 'baseline') {
    const data = context(state);
    t.diagnostic(JSON.stringify({ phase, uuids: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.id])) }));
  }
}

async function installFailureTrigger(client: pg.Client) {
  await client.query('CREATE SEQUENCE public.seed_pdgld47_group_attempt');
  await client.query(`
    CREATE FUNCTION public.seed_pdgld47_reject_group() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM nextval('public.seed_pdgld47_group_attempt');
      RAISE EXCEPTION 'Fallo sintético del test PDGLD-47 al insertar un grupo';
    END $$
  `);
  await client.query(`
    CREATE TRIGGER seed_pdgld47_reject_group BEFORE INSERT ON sports_management.groups
    FOR EACH ROW EXECUTE FUNCTION public.seed_pdgld47_reject_group()
  `);
}

async function removeFailureTrigger(client: pg.Client) {
  await client.query('DROP TRIGGER IF EXISTS seed_pdgld47_reject_group ON sports_management.groups');
  await client.query('DROP FUNCTION IF EXISTS public.seed_pdgld47_reject_group()');
  await client.query('DROP SEQUENCE IF EXISTS public.seed_pdgld47_group_attempt');
}

async function createHomonymousContexts(client: pg.Client, state: Snapshot) {
  const seeded = context(state);
  const actor = one(state.users, row => row.person_id === SEED_ACTOR.personId, 'Debe existir el actor sintético.');
  const ids = Array.from({ length: 12 }, () => randomUUID());
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.reason', $2, true)",
      [actor.id, 'PDGLD-47: fixture sintético de contextos homónimos']);
    await client.query('INSERT INTO sports_management.leagues(id, name) VALUES ($1, $2)',
      [ids[0], 'Liga sintética de contraste PDGLD-47']);
    await client.query(`
      INSERT INTO sports_management.seasons(id, league_id, sport_id, name, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5::date, $6::date), ($7, $8, $3, $9, $5::date, $6::date)
    `, [ids[1], ids[0], seeded.sport.id, SEED_CONTEXT.seasonName, SEED_CONTEXT.startDate,
      SEED_CONTEXT.endDate, ids[5], seeded.league.id, 'Temporada sintética de contraste PDGLD-47']);
    await client.query(`
      INSERT INTO sports_management.categories(id, league_id, sport_id, name)
      VALUES ($1, $2, $3, $4), ($5, $6, $3, $7)
    `, [ids[2], ids[0], seeded.sport.id, SEED_CONTEXT.categoryName,
      ids[8], seeded.league.id, 'Categoría sintética de contraste PDGLD-47']);
    await client.query(`
      INSERT INTO sports_management.competition_rules(id, season_id, version_number)
      VALUES ($1, $2, $3), ($4, $5, $3)
    `, [ids[3], ids[1], SEED_CONTEXT.ruleVersion, ids[6], ids[5]]);
    await client.query(`
      INSERT INTO sports_management.season_categories
        (id, season_id, category_id, competition_rule_id, hierarchy_order, type, age_cutoff_date)
      VALUES ($1, $2, $3, $4, 1, 'OPEN', $5::date),
        ($6, $7, $8, $9, 1, 'OPEN', $5::date), ($10, $11, $12, $13, 2, 'OPEN', $5::date)
    `, [ids[4], ids[1], ids[2], ids[3], SEED_CONTEXT.ageCutoffDate,
      ids[7], ids[5], seeded.category.id, ids[6], ids[9], seeded.season.id, ids[8], seeded.rule.id]);
    await client.query(`
      INSERT INTO sports_management.groups(id, season_id, season_category_id, name)
      VALUES ($1, $2, $3, $4), ($5, $6, $7, $4), ($8, $9, $10, $4)
    `, [ids[10], ids[1], ids[4], SEED_CONTEXT.groupName,
      ids[11], ids[5], ids[7], randomUUID(), seeded.season.id, ids[9]]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

test('seed en PostgreSQL temporal: atomicidad, identidad, dos ejecuciones, integridad y alcance', async t => {
  const client = new pg.Client({ connectionString: targetUrl(), connectionTimeoutMillis: 10_000, query_timeout: 20_000 });
  try {
    await client.connect();
    const baseline = await snapshot(client);
    assert.deepEqual(baseline.roles.map(row => row.code).sort(), OFFICIAL_ROLES);
    assert.deepEqual(SEED_ROLES.map(row => row.code).sort(), OFFICIAL_ROLES, 'El seed debe conservar los 12 códigos oficiales.');
    assert.equal(baseline.seasons.length, 0, 'Las pruebas requieren una base temporal sin seed previo.');
    assert.equal(baseline.people.length, 0);
    assert.equal(baseline.users.length, 0);
    assert.equal(baseline.audit_logs.length, 0);
    evidence(t, 'baseline', baseline);

    await t.test('un fallo en el último INSERT revierte datos y auditoría de las 96 tablas', async () => {
      try {
        await installFailureTrigger(client);
        await seedCli(1);
        const { rows } = await client.query('SELECT is_called FROM public.seed_pdgld47_group_attempt');
        assert.equal(rows[0].is_called, true, 'La ejecución debe haber llegado al INSERT del grupo después de las demás escrituras.');
        assert.deepEqual(await snapshot(client), baseline, 'El fallo debe revertir todo el seed, incluyendo su actor y auditoría.');
      } finally {
        await removeFailureTrigger(client);
      }
    });

    await seedCli();
    const first = await snapshot(client);
    const seeded = context(first);
    const addedTables = new Set(['leagues', 'seasons', 'categories', 'competition_rules', 'season_categories',
      'groups', 'people', 'users', 'audit_logs']);
    for (const [table, previous] of Object.entries(baseline)) {
      assert.equal(first[table].length, previous.length + (addedTables.has(table) ? 1 : 0), `Cantidad inesperada en ${table}.`);
      const oldIds = new Set(previous.map(row => row.id));
      assert.deepEqual(first[table].filter(row => oldIds.has(row.id)), previous, `El seed no debe modificar los datos previos de ${table}.`);
    }
    const person = one(first.people, row => row.id === SEED_ACTOR.personId, 'El actor debe usar la persona sintética reservada.');
    assert.equal(person.first_name, SEED_ACTOR.firstName);
    assert.equal(person.paternal_surname, SEED_ACTOR.surname);
    assert.equal(person.curp, null);
    const actor = one(first.users, row => row.person_id === person.id, 'El actor de auditoría debe tener una identidad válida.');
    assert.equal(actor.username, SEED_ACTOR.username);
    assert.equal(actor.email, SEED_ACTOR.email);
    assert.equal(actor.is_active, false, 'El actor sintético no debe poder iniciar sesión.');
    assert.equal(actor.password_hash, SEED_ACTOR.passwordHash, 'El actor usa un marcador inválido para autenticación, sin contraseña administrativa.');
    assert.equal(actor.must_change_password, true);
    assert.equal(first.user_roles.length, 0, 'No deben asignarse roles al actor sintético.');
    assert.equal(first.role_permissions.length, 0, 'No debe inventarse la matriz de permisos.');
    assert.equal(first.permissions.length, 0);
    const audit = one(first.audit_logs, row => row.entity_id === seeded.rule.id, 'El INSERT de reglamento debe tener exactamente un evento del trigger.');
    assert.equal(audit.user_id, actor.id);
    assert.equal(audit.action, 'INSERT');
    assert.equal(audit.table_name, 'competition_rules');
    assert.equal(audit.reason, SEED_AUDIT_REASON);
    assert.equal(audit.previous_data, null);
    assert.equal((audit.new_data as Row).id, seeded.rule.id);
    evidence(t, 'primera ejecución CLI', first);

    await seedCli();
    const second = await snapshot(client);
    assert.deepEqual(second, first, 'La segunda ejecución debe preservar cantidades, UUID, relaciones y eventos de las 96 tablas.');
    evidence(t, 'segunda ejecución CLI', second);

    await t.test('nombres iguales en otras ligas, temporadas y categorías conservan su contexto', async () => {
      await createHomonymousContexts(client, second);
      const contrasted = await snapshot(client);
      await seedCli();
      assert.deepEqual(await snapshot(client), contrasted, 'El seed debe conservar completos todos los contextos homónimos.');
      assert.deepEqual(context(contrasted), seeded, 'El grupo inicial debe seguir enlazado con sus UUID originales.');
    });

    await t.test('dos ejecuciones concurrentes conservan todos los UUID y no duplican auditoría', async () => {
      const before = await snapshot(client);
      await Promise.all([seedCli(), seedCli()]);
      assert.deepEqual(await snapshot(client), before);
    });
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    throw new Error('Falló una operación de integración del seed; se omitieron detalles de conexión.');
  } finally {
    await client.end();
  }
});

test('la CLI rechaza entorno inválido o remoto y omite secretos al fallar la conexión', async t => {
  const token = `synthetic-password-${randomUUID()}`;
  const localUrl = `postgresql://postgres:${token}@127.0.0.1:5432/gestor_ligas_ci`;
  const cases = [
    { label: 'variables vacías', url: '' },
    { label: 'URL inválida', url: `invalid-${token}` },
    { label: 'protocolo diferente de PostgreSQL', url: `https://postgres:${token}@127.0.0.1:5432/gestor_ligas_ci` },
    { label: 'destino Supabase', url: `postgresql://postgres:${token}@db.synthetic.supabase.co:5432/postgres` },
    { label: 'parámetro que sustituye el host', url: `postgresql://postgres:${token}@127.0.0.1:5432/gestor_ligas_ci?host=db.synthetic.supabase.co` },
    { label: 'esquema ajeno al proyecto', url: `${localUrl}?schema=public,private` },
    { label: 'lista de esquemas con entrada vacía', url: `${localUrl}?schema=public,,sports_management` },
    { label: 'DIRECT_URL inválida', url: localUrl, direct: `invalid-direct-${token}` },
    { label: 'DIRECT_URL remota', url: localUrl, direct: `postgresql://postgres:${token}@db.synthetic.supabase.co:5432/postgres` },
    { label: 'DIRECT_URL sustituye el host por parámetro', url: localUrl, direct: `${localUrl}?host=db.synthetic.supabase.co` },
    { label: 'DATABASE_URL y DIRECT_URL apuntan a bases diferentes', url: localUrl, direct: localUrl.replace('/gestor_ligas_ci', '/otra_base_ci') },
    { label: 'DATABASE_URL y DIRECT_URL usan puertos diferentes', url: localUrl, direct: localUrl.replace(':5432/', ':5433/') },
  ];
  for (const { label, url, direct } of cases) {
    await t.test(label, async () => {
      const result = await command([require.resolve('tsx/cli'), 'prisma/seed.ts'],
        { ...process.env, DATABASE_URL: url, DIRECT_URL: direct ?? url });
      assert.notEqual(result.status, 0, 'La CLI debe rechazar la configuración antes de escribir.');
      assert.ok(!result.output.includes(token), 'Un error no debe imprimir credenciales.');
      if (url) assert.ok(!result.output.includes(url), 'Un error no debe imprimir la URL recibida.');
      if (direct) assert.ok(!result.output.includes(direct), 'Un error no debe imprimir DIRECT_URL.');
      assert.ok(!/\n\s+at\s/.test(result.output), 'La CLI debe emitir un error controlado, sin stack del driver.');
    });
  }
  await t.test('prisma db seed también redacta errores al cargar prisma.config.ts', async () => {
    for (const direct of [`invalid-direct-${token}`, `https://postgres:${token}@127.0.0.1:5432/gestor_ligas_ci`]) {
      const result = await command([require.resolve('prisma/build/index.js'), 'db', 'seed'],
        { ...process.env, DATABASE_URL: localUrl, DIRECT_URL: direct });
      assert.notEqual(result.status, 0, 'La configuración de Prisma debe rechazar DIRECT_URL inválida.');
      assert.ok(!result.output.includes(token), 'La carga de prisma.config.ts debe omitir credenciales.');
      assert.ok(!result.output.includes(direct), 'La carga de prisma.config.ts debe omitir DIRECT_URL.');
    }
  });
  await t.test('conexión local fallida redactada', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const url = `postgresql://postgres:${token}@127.0.0.1:${port}/gestor_ligas_ci`;
    const result = await command([require.resolve('tsx/cli'), 'prisma/seed.ts'],
      { ...process.env, DATABASE_URL: url, DIRECT_URL: url });
    assert.notEqual(result.status, 0);
    assert.ok(!result.output.includes(token));
    assert.ok(!result.output.includes(url));
    assert.ok(!/\n\s+at\s/.test(result.output));
  });
});
