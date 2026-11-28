import { randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PREVIEW_MARKER, provisionPreviewRuntime } from "./preview/runtime-plan.mjs";

const nonce = randomBytes(8).toString("hex");
const name = `pdgld135-preview-${nonce}`;
const database = `pdgld48_test_${nonce}`;
const password = randomBytes(24).toString("hex");
const docker = args => execFileSync("docker", args, { encoding: "utf8", windowsHide: true }).trim();
let created = false;
let client;
try {
  docker(["run", "-d", "--name", name, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", `POSTGRES_DB=${database}`,
    "-p", "127.0.0.1::5432", "postgres:15"]);
  created = true;
  const port = docker(["port", name, "5432/tcp"]).split(":").at(-1);
  const adminUrl = `postgresql://postgres:synthetic@127.0.0.1:${port}/${database}`;
  const runtimeUrl = `postgresql://gestor_ligas_preview:${password}@127.0.0.1:${port}/${database}`;
  for (let i = 0; ; i++) {
    try { docker(["exec", name, "pg_isready", "-U", "postgres"]); break; }
    catch { if (i >= 60) throw new Error("DATABASE_NOT_READY"); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  const env = { ...process.env, DATABASE_URL: adminUrl, DIRECT_URL: adminUrl };
  const migrated = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env, encoding: "utf8", windowsHide: true });
  if (migrated.status !== 0) throw new Error("MIGRATION_FAILED");
  client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  await client.query(await readFile("tests/integration/scheduling-fixtures.sql", "utf8"));
  await client.query(`
    SELECT set_config('app.user_id',actor::text,false), set_config('app.reason','Fixture Preview sintetico',false) FROM public.scheduling_fixture;
    INSERT INTO sports_management.permissions(module,action) VALUES ('competitions','READ') ON CONFLICT DO NOTHING;
    INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT ur.role_id,p.id,true FROM public.scheduling_fixture f JOIN sports_management.user_roles ur ON ur.user_id=f.actor
      JOIN sports_management.permissions p ON p.module='competitions' AND p.action='READ' ON CONFLICT DO NOTHING;
    INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only)
      SELECT r.id,p.id,true FROM sports_management.roles r CROSS JOIN sports_management.permissions p
      WHERE r.code='SCHEDULER' AND p.module='scheduling' AND p.action IN ('READ','UPDATE') ON CONFLICT DO NOTHING;
    INSERT INTO sports_management.user_roles(user_id,role_id,league_id)
      SELECT f.actor,r.id,s.league_id FROM public.scheduling_fixture f JOIN sports_management.seasons s ON s.id=f.season
      CROSS JOIN sports_management.roles r WHERE r.code='SCHEDULER';
    UPDATE sports_management.venues SET is_league_sports_complex=false,
      owner_club_id=(SELECT id FROM sports_management.clubs ORDER BY id LIMIT 1);
    INSERT INTO sports_management.files(storage_key,original_name,mime_type,size_bytes,uploaded_by)
      SELECT 'fixture-preview-letter','Carta sintetica','application/pdf',0,actor FROM public.scheduling_fixture;
    INSERT INTO sports_management.venue_loans(season_id,venue_id,club_id,letter_file_id,status,approved_by,approved_at,requested_by,request_hash,requested_windows,owner_decision_required,owner_decision,owner_reviewed_by,owner_reviewed_at,owner_review_reason)
      SELECT f.season,v.id,c.id,fi.id,'APPROVED',f.actor,now(),f.outsider,repeat('a',64),
        (SELECT jsonb_agg(jsonb_build_object('startsAt',to_char(a.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'endsAt',to_char(a.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY a.starts_at)
          FROM sports_management.venue_availability a WHERE a.venue_id=v.id), true, 'APPROVED', f.actor, now(), 'Autorizacion sintetica del dueño'
      FROM public.scheduling_fixture f CROSS JOIN sports_management.venues v CROSS JOIN sports_management.clubs c
      CROSS JOIN sports_management.files fi WHERE fi.storage_key='fixture-preview-letter';
  `);
  const fixture = (await client.query("SELECT * FROM public.scheduling_fixture")).rows[0];
  await client.query(`COMMENT ON DATABASE "${database}" IS '${PREVIEW_MARKER}'`);
  await client.query(`DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sports_management'
    LOOP EXECUTE format('ALTER TABLE sports_management.%I ENABLE ROW LEVEL SECURITY',t.tablename); END LOOP; END $$`);
  await provisionPreviewRuntime(client);
  await client.query(`ALTER ROLE gestor_ligas_preview LOGIN PASSWORD '${password}'`);
  const browser = process.argv.includes("--browser");
  const args = browser ? ["tests/e2e/scheduling-navigation.mjs"]
    : ["--conditions=react-server", "--import", "tsx", "--test", "tests/integration/scheduling-preview.test.ts"];
  const child = spawnSync(process.execPath, args, {
    env: browser ? { ...env, SCHEDULING_PREVIEW_RUNTIME_URL: runtimeUrl }
      : { ...env, DATABASE_URL: runtimeUrl, SCHEDULING_PREVIEW_FIXTURE: JSON.stringify(fixture) },
    encoding: "utf8", windowsHide: true,
  });
  process.stdout.write((child.stdout + child.stderr).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[conexión omitida]"));
  if (child.status !== 0) process.exitCode = 1;
} finally {
  if (client) await client.end();
  if (created) { docker(["rm", "-f", name]); console.log("Contenedor y base temporales eliminados."); }
}
