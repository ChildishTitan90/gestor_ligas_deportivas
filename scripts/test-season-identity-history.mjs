import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { childEnvironment } from './ci/delegate-isolated-runtime.mjs';

// No .env, puertos, volúmenes, bases existentes ni conexiones del proyecto.
const runId = randomUUID();
console.log(`PDGLD-117 historial: run-id ${runId}; PG15 → limpieza → PG17 → limpieza.`);
const snapshotMigration = '20261108020000_pdgld117_season_identity_snapshots';
const migration = '20261108030000_pdgld117_identity_closure_receipts';
const selectiveMigration = '20261109010000_pdgld117_selective_history';
const env = childEnvironment(process.env);
const actor = `SELECT set_config('app.user_id','11700000-0000-4000-8000-000000000002',false),set_config('app.reason','Prueba sintetica aislada',false);`;
function command(args, input = '', { interactive = false } = {}) {
  const child = spawn('docker', ['--host', 'unix:///var/run/docker.sock', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  let signalReady;
  const ready = new Promise(resolve => { signalReady = resolve; });
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('HISTORY_READY')) signalReady(); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); signalReady(); resolve({ code, stdout, stderr }); });
  });
  if (interactive) child.stdin.write(input); else child.stdin.end(input);
  return { child, done, ready };
}
async function docker(args, input) {
  const result = await command(args, input).done;
  assert.equal(result.code, 0, `Docker ${args[0]} falló; se omite salida interna.`);
  return result.stdout.trim();
}
for (const major of [15, 17]) {
  let container;
  try {
    container = await docker(['run', '-d', '--pull=missing', '--name', `pdgld117-history-${runId}-pg${major}`,
      '--label', `pdgld117.history=${runId}`, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev',
      '--memory', '805306368', '--cpus', '2', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', `postgres:${major}-bookworm`]);
    assert.match(container, /^[a-f0-9]{64}$/);
    let available = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const probe = await command(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).done;
      if (probe.code === 0) { available = true; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(available, 'PostgreSQL desechable no inició.');
    const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
    const query = async (sql, expected = 0) => {
      const result = await command(psqlArgs, sql).done;
      assert.equal(result.code, expected, `SQL de prueba PG${major} falló: ${result.stderr.match(/(?:ERROR|FATAL):[^\n]*/)?.[0] ?? 'sin detalle'}`);
      return result;
    };
    const scalar = async sql => (await query(sql)).stdout.trim();
    const fixture = await readFile('tests/integration/season-identity-history-fixtures.sql', 'utf8');
    for (const name of (await readdir('prisma/migrations')).sort()) {
      if (name === snapshotMigration) break;
      if (name === 'migration_lock.toml') continue;
      await query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    }
    await query(fixture);
    for (const name of [snapshotMigration,migration]) await query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    assert.equal(await scalar('SELECT count(*) FROM sports_management.season_person_identity_snapshots'), '0');
    const create = name => query(actor + `SELECT history_test.fixture('${name}');`);
    const season = name => `(SELECT season_id FROM history_test.cases WHERE name='${name}')`;
    const person = name => `(SELECT person_id FROM history_test.cases WHERE name='${name}')`;
    const close = name => `UPDATE sports_management.seasons SET status='CLOSED',closed_at=now(),version=version+1 WHERE id=${season(name)};`;
    await create('atomic');
    await query(actor + `BEGIN; ${close('atomic')} ROLLBACK;`);
    assert.equal(await scalar(`SELECT status FROM sports_management.seasons WHERE id=${season('atomic')}`), 'ACTIVE');
    assert.equal(await scalar(`SELECT count(*) FROM sports_management.season_person_identity_snapshots WHERE season_id=${season('atomic')}`), '0');
    assert.equal(await scalar('SELECT count(*) FROM sports_management.season_identity_closures'), '0');
    // Un error en la captura revierte también status, versión y auditoría del cierre.
    await query(`CREATE FUNCTION history_test.fail_capture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_CAPTURE_FAILURE'; END $$;
      CREATE TRIGGER synthetic_capture_failure AFTER INSERT ON sports_management.season_person_identity_snapshots FOR EACH ROW EXECUTE FUNCTION history_test.fail_capture();`);
    await query(actor + close('atomic'), 3);
    assert.equal(await scalar(`SELECT status FROM sports_management.seasons WHERE id=${season('atomic')}`), 'ACTIVE');
    assert.equal(await scalar('SELECT count(*) FROM sports_management.season_person_identity_snapshots'), '0');
    await query('DROP TRIGGER synthetic_capture_failure ON sports_management.season_person_identity_snapshots');
    await query(`CREATE FUNCTION history_test.fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_RECEIPT_FAILURE'; END $$;
      CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON sports_management.season_identity_closures FOR EACH ROW EXECUTE FUNCTION history_test.fail_receipt();`);
    await query(actor + close('atomic'),3);
    assert.equal(await scalar(`SELECT status FROM sports_management.seasons WHERE id=${season('atomic')}`),'ACTIVE');
    assert.equal(await scalar('SELECT count(*) FROM sports_management.season_person_identity_snapshots'),'0');
    assert.equal(await scalar('SELECT count(*) FROM sports_management.season_identity_closures'),'0');
    await query('DROP TRIGGER synthetic_receipt_failure ON sports_management.season_identity_closures');
    await query(actor + close('atomic'));
    assert.equal(await scalar(`SELECT count(*) FROM sports_management.season_person_identity_snapshots WHERE season_id=${season('atomic')}`), '3');
    assert.equal(await scalar(`SELECT string_agg(DISTINCT identity_version::text,',') FROM sports_management.season_person_identity_snapshots WHERE season_id=${season('atomic')}`), '1');
    assert.equal(await scalar(`SELECT status FROM sports_management.player_registrations WHERE id=(SELECT registration_id FROM history_test.cases WHERE name='atomic')`), 'ACTIVE');
    for (const sql of [
      `UPDATE sports_management.season_person_identity_snapshots SET first_name='No permitido'`,
      `DELETE FROM sports_management.season_person_identity_snapshots`,
      `TRUNCATE sports_management.season_person_identity_snapshots`,
      `INSERT INTO sports_management.season_person_identity_snapshots(season_id,person_id,first_name,paternal_surname,identity_version,season_version) VALUES(${season('legacy')},${person('legacy')},'Falso','Historico',1,1)`,
    ]) await query(sql, 3);

    assert.equal(await scalar(`SELECT person_count||':'||season_version FROM sports_management.season_identity_closures WHERE season_id=${season('atomic')}`), '3:2');
    assert.equal(await scalar(`SELECT count(*) FROM sports_management.season_identity_closures WHERE season_id=${season('legacy')}`), '0');
    await query('UPDATE sports_management.season_identity_closures SET person_count=0',3);
    await query('DELETE FROM sports_management.season_identity_closures',3);
    await query('TRUNCATE sports_management.season_identity_closures',3);
    // Incluso sin personas queda constancia explícita de un cierre nuevo vacío.
    await query(actor + `INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
      SELECT league_id,sport_id,'Cierre vacío sintético',start_date,end_date FROM sports_management.seasons WHERE id=${season('atomic')};
      UPDATE sports_management.seasons SET status='ACTIVE' WHERE name='Cierre vacío sintético';
      UPDATE sports_management.seasons SET status='CLOSED',closed_at=clock_timestamp() WHERE name='Cierre vacío sintético';`);
    assert.equal(await scalar("SELECT person_count FROM sports_management.season_identity_closures h JOIN sports_management.seasons s ON s.id=h.season_id WHERE s.name='Cierre vacío sintético'"), '0');
    // Coordinación por señales de psql y pg_blocking_pids: no depende de sleeps
    // para que las dos transacciones realmente se solapen.
    async function race(name, firstSQL, secondSQL, expectedSecond) {
      const first = command(psqlArgs, actor + `BEGIN; ${firstSQL}\n\\echo HISTORY_READY\n`, { interactive: true });
      await first.ready;
      const second = command(psqlArgs, `SET application_name='history_second'; ${actor}${secondSQL}`);
      try {
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if (await scalar("SELECT count(*) FROM pg_stat_activity WHERE application_name='history_second' AND cardinality(pg_blocking_pids(pid))>0") === '1') { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.ok(blocked, `No se observó solapamiento real: ${name}`);
      } finally { first.child.stdin.end('COMMIT;\n'); }
      assert.equal((await first.done).code, 0);
      const result = await second.done;
      assert.equal(result.code, expectedSecond, `Resultado concurrente inesperado: ${name}`);
      if (expectedSecond) assert.match(result.stderr, /HISTORICAL_IDENTITY_UNAVAILABLE/);
    }
    await create('correction_first');
    await race('correction_first', `UPDATE sports_management.people SET first_name='Nombre corregido' WHERE id=${person('correction_first')};`, close('correction_first'), 0);
    assert.equal(await scalar(`SELECT first_name||':'||identity_version FROM sports_management.season_person_identity_snapshots WHERE season_id=${season('correction_first')} AND person_id=${person('correction_first')}`), 'Nombre corregido:2');
    await create('closure_first');
    await race('closure_first', close('closure_first'), `UPDATE sports_management.people SET first_name='No debe aplicar' WHERE id=${person('closure_first')};`, 3);
    assert.equal(await scalar(`SELECT first_name||':'||identity_version FROM sports_management.season_person_identity_snapshots WHERE season_id=${season('closure_first')} AND person_id=${person('closure_first')}`), 'Nombre anterior:1');
    assert.equal(await scalar(`SELECT first_name FROM sports_management.people WHERE id=${person('closure_first')}`), 'Nombre anterior');
    assert.equal(await scalar(`SELECT count(*) FROM sports_management.season_person_identity_snapshots WHERE season_id=${season('legacy')}`), '0');
    assert.equal(await scalar(`SELECT count(*) FROM information_schema.columns WHERE table_schema='sports_management' AND table_name='season_person_identity_snapshots' AND column_name IN ('curp','birth_date','bytes')`), '0');
    assert.equal(await scalar(`SELECT count(*) FROM sports_management.audit_logs WHERE (new_data::text LIKE '%Nombre corregido%' OR previous_data::text LIKE '%Nombre anterior%')`), '0');
    // Actualizar después de verificar las migraciones históricas originales.
    // Debe dejar TODOS los cierres anteriores sin hechos nuevos (sin backfill).
    await query(await readFile(`prisma/migrations/${selectiveMigration}/migration.sql`, 'utf8'));
    assert.equal(await scalar('SELECT count(*) FROM sports_management.season_registration_history'),'0');
    await create('private_refs');
    const registration = `(SELECT registration_id FROM history_test.cases WHERE name='private_refs')`;
    await query(actor + `INSERT INTO sports_management.player_documents(registration_id,document_type_id,file_id)
      SELECT ${registration},dt.id,g.document_file_id FROM sports_management.guardian_consents g
      CROSS JOIN sports_management.document_types dt WHERE g.registration_id=${registration} AND dt.code='GUARDIAN_CONSENT';`);
    const fileCount=await scalar('SELECT count(*) FROM sports_management.files');
    await query(actor+close('private_refs'));
    assert.equal(await scalar(`SELECT birth_date::text||':'||identity_version FROM sports_management.season_registration_history WHERE registration_id=${registration}`),'1990-01-01:1');
    assert.equal(await scalar(`SELECT jsonb_array_length(document_refs) FROM sports_management.season_registration_history WHERE registration_id=${registration}`),'1');
    assert.equal(await scalar(`SELECT (document_refs->0->>'fileId')::uuid=g.document_file_id FROM sports_management.season_registration_history h JOIN sports_management.guardian_consents g USING(registration_id) WHERE h.registration_id=${registration}`),'t');
    assert.equal(await scalar('SELECT count(*) FROM sports_management.files'),fileCount);
    assert.equal(await scalar(`SELECT document_refs::text LIKE '%bytes%' OR document_refs::text LIKE '%storage_key%' FROM sports_management.season_registration_history WHERE registration_id=${registration}`),'f');
    await query('UPDATE sports_management.season_registration_history SET birth_date=now()::date',3);
    await query('DELETE FROM sports_management.season_registration_history',3);
    await query('TRUNCATE sports_management.season_registration_history',3);
    console.log(`PG${major}: captura futura por referencias, sin backfill/duplicación y con inmutabilidad aprobada.`);
    // Un trámite/GUC coincidente sin APPLIED + auditoría no autoriza un COMMIT.
    await query(actor + `WITH p AS (INSERT INTO sports_management.people(first_name,paternal_surname)
      VALUES('Solicitante','Sintético') RETURNING id),u AS (
      INSERT INTO sports_management.users(person_id,username,email,password_hash)
      SELECT id,'history-requester','history-requester@example.test','synthetic-not-valid' FROM p RETURNING id)
      INSERT INTO sports_management.player_identity_corrections(registration_id,person_id,requester_id,operation_key,request_hash,expected_identity_version,proposed_identity,reason,identity_doubt)
      SELECT ${registration},p.id,u.id,gen_random_uuid(),'synthetic',p.identity_version,
        jsonb_build_object('curp',p.curp,'firstName','Propuesta sin finalizar','paternalSurname',p.paternal_surname,'maternalSurname',p.maternal_surname,'birthDate',p.birth_date),
        'Prueba sintética de commit incompleto',false FROM u CROSS JOIN sports_management.people p WHERE p.id=${person('private_refs')};`);
    const unfinished=await query(actor + `BEGIN;
      SELECT set_config('app.identity_correction_id',(SELECT id::text FROM sports_management.player_identity_corrections WHERE registration_id=${registration}),true);
      UPDATE sports_management.people SET first_name='Propuesta sin finalizar' WHERE id=${person('private_refs')};
      COMMIT;`,3);
    assert.match(unfinished.stderr,/HISTORICAL_CORRECTION_NOT_COMMITTED/);
    assert.equal(await scalar(`SELECT first_name FROM sports_management.people WHERE id=${person('private_refs')}`),'Nombre anterior');
    // RLS de Supabase se verifica aparte sobre otra base del mismo contenedor.
    await query('CREATE DATABASE history_rls');
    const rlsArgs = [...psqlArgs.slice(0, -1), 'history_rls'];
    const rls = async sql => { const r = await command(rlsArgs, sql).done; assert.equal(r.code, 0, 'Falló fixture RLS sintético'); return r.stdout.trim(); };
    for (const name of (await readdir('prisma/migrations')).sort()) {
      if (name === snapshotMigration) break;
      if (name === 'migration_lock.toml') continue;
      if (name === '20261108010000_pdgld117_identity_corrections') {
        await rls('CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
      }
      await rls(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    }
    for (const name of [snapshotMigration,migration,selectiveMigration]) await rls(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    assert.equal(await rls("SELECT relrowsecurity FROM pg_class WHERE oid='sports_management.season_person_identity_snapshots'::regclass"), 't');
    assert.equal(await rls("SELECT has_table_privilege('anon','sports_management.season_person_identity_snapshots','SELECT') OR has_table_privilege('authenticated','sports_management.season_person_identity_snapshots','INSERT') OR has_table_privilege('service_role','sports_management.season_person_identity_snapshots','SELECT')"), 'f');
    for (const table of ['player_identity_corrections','player_identity_correction_evidence','season_identity_closures','season_registration_history']) {
      assert.equal(await rls(`SELECT relrowsecurity FROM pg_class WHERE oid='sports_management.${table}'::regclass`), 't');
      for (const role of ['anon','authenticated','service_role']) {
        assert.equal(await rls(`SELECT has_table_privilege('${role}','sports_management.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`), 'f');
      }
    }
    console.log(`PG${major}: cierre/captura atómicos, rollback por fallo, inmutabilidad, ausencia de backfill, ambas carreras reales y RLS/ACL sintéticos: OK`);
  } finally {
    if (container) {
      const labels = JSON.parse(await docker(['inspect', '--format', '{{json .Config.Labels}}', container]));
      assert.equal(labels['pdgld117.history'], runId, 'Recurso ajeno: no limpiar.');
      await docker(['rm', '-f', container]);
      assert.equal(await docker(['ps', '-aq', '--filter', `label=pdgld117.history=${runId}`]), '');
      console.log(`PG${major}: limpieza verificada; sin contenedores propios ni puertos publicados.`);
    }
  }
}
