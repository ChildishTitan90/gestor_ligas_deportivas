// Permisos SQL del backend privado. No son concesiones RF22 a personas.
// Fuente: auth/*, accounts/server/service, clubs/server, players/server, permissions/server
// y competitions/server (incluidos triggers y relaciones consultadas por _count).
export const PREVIEW_PROJECT = 'loaztwwpwsaqzdtdtvvj';
export const PREVIEW_ROLE = 'gestor_ligas_preview';
export const PREVIEW_MARKER = `PDGLD_PRUEBAS_ONLY=${PREVIEW_PROJECT}`;

const read = ['player_category_levels','player_category_participations','sanctions','audit_logs', 'authentication_events', 'categories', 'charges', 'club_affiliations',
  'club_affiliation_categories', 'club_officers', 'clubs', 'correction_authorizations', 'disciplinary_cases',
  'document_requirements','document_types','player_documents','files', 'groups', 'leagues', 'match_events', 'match_reports', 'matches', 'payment_voids', 'payments',
  'people', 'permissions', 'player_registrations', 'player_status_history', 'player_curp_checks', 'referee_assignments', 'referees', 'role_permissions',
  'roles', 'schedule_proposals', 'season_categories', 'season_teams', 'seasons', 'sessions', 'sports',
  'teams', 'team_enrollment_operations', 'user_roles', 'users'];
// Lecturas de reglas, cierre y dependencias: una tabla vacía también exige SELECT
// y una política RLS para que _count no oculte referencias que impiden retirar filas.
read.push('billing_plans', 'club_team_changes', 'competition_rules', 'competition_rule_parameters',
  'competition_stages', 'imports', 'matchdays', 'match_results',
  'match_statuses', 'official_documents', 'publications', 'season_awards', 'season_breaks',
  'standing_versions', 'venue_loans');
// En dependencias solo se consultan identidad/contexto para COUNT y joins.
// No se necesitan importaciones, contenido de documentos ni resultados completos.
const readColumns = {
  sanctions:['id','registration_id','season_team_id','blocks_participation','starts_at','ends_at'],
  billing_plans: ['id', 'season_id'], club_team_changes: ['id', 'season_id'],
  // update() de aprobación devuelve todos los escalares, incluido file_id.
  competition_rules: ['id', 'season_id', 'version_number', 'status', 'created_at', 'file_id', 'approved_by', 'approved_at'],
  // create() sin select devuelve también validated_by.
  competition_rule_parameters: ['id', 'competition_rule_id', 'parameter_key', 'parameter_value', 'requires_validation', 'validated_by'],
  competition_stages: ['id', 'season_category_id', 'season_id'],
  imports: ['id', 'season_id'],
  matchdays: ['id', 'season_id'], match_results: ['id', 'match_id'], match_statuses: ['id', 'code'],
  official_documents: ['id', 'season_id'], publications: ['id', 'season_id'],
  season_awards: ['id', 'season_category_id', 'season_id'], season_breaks: ['id', 'season_id'],
  standing_versions: ['id', 'group_id'], venue_loans: ['id', 'season_id'],
};
const insert = {
  player_category_levels:['season_category_id','season_id','pathway_code','level','configured_by'],
  player_category_participations:['origin_registration_id','season_id','club_id','target_season_team_id','target_season_category_id','requested_by','request_key','request_hash','status','created_at','version'],
  // Prisma también materializa defaults escalares (now(), 0, 1, true) en INSERT.
  audit_logs: ['id','user_id', 'action', 'table_name', 'entity_id', 'previous_data', 'new_data', 'reason', 'occurred_at'],
  player_documents:['registration_id','document_type_id','file_id','status'],
  player_status_history:['registration_id','previous_status','new_status','user_id','reason','created_at'],
  authentication_events: ['user_id', 'action', 'occurred_at'],
  categories: ['league_id', 'sport_id', 'name'],
  competition_rules: ['season_id', 'version_number', 'status', 'created_at'],
  competition_rule_parameters: ['competition_rule_id', 'parameter_key', 'parameter_value', 'requires_validation'],
  club_affiliations: ['season_id', 'club_id', 'league_id', 'reference_number', 'status', 'requested_by',
    'club_name', 'uniform_colors', 'submission_key', 'submission_hash', 'review_version'],
  club_affiliation_categories: ['affiliation_id', 'season_id', 'category_id'],
  club_officers: ['affiliation_id', 'person_id', 'office', 'starts_at', 'signature_file_id'],
  clubs: ['name', 'league_id', 'reference_number', 'status', 'version', 'created_at'],
  files: ['id', 'storage_key', 'original_name', 'mime_type', 'size_bytes', 'sha256', 'uploaded_by', 'created_at'],
  groups: ['season_id', 'season_category_id', 'name'],
  leagues: ['name', 'timezone', 'is_active'],
  people: ['first_name', 'paternal_surname', 'maternal_surname', 'created_at', 'identity_version'],
  player_curp_checks: ['operation_key', 'actor_id', 'person_id', 'registration_id', 'identity_version', 'fingerprint', 'status', 'mismatched_fields'],
  role_permissions: ['role_id', 'permission_id', 'context_only'],
  sessions: ['user_id', 'token_hash', 'created_at', 'last_activity_at', 'expires_at'],
  seasons: ['league_id', 'sport_id', 'name', 'start_date', 'end_date', 'status', 'version'],
  season_categories: ['season_id', 'category_id', 'competition_rule_id', 'hierarchy_order', 'type', 'eligibility_pending', 'competition_format'],
  teams: ['club_id', 'name', 'reference_number', 'status', 'version', 'created_at'],
  season_teams: ['team_id', 'club_id', 'season_id', 'season_category_id', 'group_id', 'status', 'enrolled_by', 'enrolled_at', 'enrollment_key', 'enrollment_hash'],
  team_enrollment_operations: ['actor_id', 'enrollment_key', 'club_id', 'fingerprint', 'outcome', 'enrollment_id', 'finalized_at'],
  // PDGLD-107: finite initial assignments need INSERT ends_at, never UPDATE.
  user_roles: ['user_id', 'role_id', 'league_id', 'club_id', 'starts_at', 'delegate_position', 'ends_at'],
  users: ['person_id', 'username', 'email', 'password_hash', 'is_active', 'must_change_password', 'failed_login_attempts', 'version', 'created_at'],
};
const update = {
  player_category_participations:['status','version','eligibility_fingerprint','review_event_id'],
  player_documents:['status','reviewed_by'],
  player_registrations:['status','identity_review_status'],
  player_curp_checks: ['status', 'mismatched_fields', 'finished_at'],
  clubs: ['name', 'status', 'version'],
  teams: ['name', 'status', 'version'],
  competition_rules: ['status', 'approved_by', 'approved_at'],
  competition_rule_parameters: ['requires_validation', 'validated_by'],
  club_affiliations: ['club_name', 'uniform_colors', 'status', 'reviewed_by', 'reviewed_at', 'review_reason', 'review_version','submission_key','submission_hash'],
  club_affiliation_categories: ['authorized_by', 'authorized_at'],
  club_officers: ['person_id', 'signature_file_id'],
  groups: ['name'],
  role_permissions: ['context_only'],
  sessions: ['revoked_at', 'last_activity_at', 'expires_at'],
  seasons: ['name', 'start_date', 'end_date', 'version', 'status', 'team_registration_closed_at', 'competition_starts_at', 'closed_at'],
  season_categories: ['competition_rule_id', 'hierarchy_order', 'type', 'competition_format',
    'player_policy', 'minimum_age', 'maximum_age', 'age_cutoff_date', 'eligibility_pending'],
  season_teams: ['group_id'],
  users: ['password_hash', 'must_change_password', 'failed_login_attempts', 'locked_until', 'version'],
};
const remove = ['role_permissions', 'club_affiliation_categories', 'groups', 'season_categories', 'seasons', 'clubs', 'teams'];
const lock = ['document_requirements','document_types','categories', 'charges', 'clubs', 'disciplinary_cases', 'files', 'groups', 'leagues',
  'match_events', 'match_reports', 'matches', 'payments', 'people', 'permissions',
  'referee_assignments', 'referees', 'roles', 'schedule_proposals', 'season_categories', 'season_teams',
  'seasons', 'teams', 'user_roles'];

export const runtimePrivileges = Object.freeze({ read, readColumns, insert, update, remove, lock });
const literal = value => `'${value.replaceAll("'", "''")}'`;
const array = values => `ARRAY[${values.map(literal).join(',')}]::text[]`;

/** Mismo plan en provisión y mantenimiento; una desviación desconocida aborta. */
export function previewRuntimeSql() {
  const tables = read.map(table => `(${literal(table)},${array(readColumns[table] ?? [])},${array(insert[table] ?? [])},${array(update[table] ?? [])},${remove.includes(table)},${lock.includes(table)})`).join(',\n');
  return `
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(54,2026);
DO $preview$
DECLARE spec record; p record; column_spec record; runtime_oid oid; table_oid oid; cmd text; policy_name text;
  expected_using text; expected_check text; cols text; db_note text;
BEGIN
  SELECT coalesce(shobj_description(oid,'pg_database'),'') INTO db_note FROM pg_database WHERE datname=current_database();
  IF position(${literal(PREVIEW_MARKER)} IN db_note)=0 AND NOT EXISTS (
    SELECT 1 FROM sports_management.audit_logs WHERE id='d3222026-1022-4000-8000-000000000099'
      AND table_name='demo_supabase_20261022' AND action='INSTALL'
  ) THEN RAISE EXCEPTION 'No se reconoce la instalación de pruebas'; END IF;
  IF current_user NOT IN ('postgres','supabase_admin') OR NOT (
    current_database()='postgres' OR (current_database() ~ '^pdgld48_test_[a-f0-9]{16}$'
      AND position(${literal(PREVIEW_MARKER)} IN db_note)>0
      AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=session_user::regrole))
  ) THEN RAISE EXCEPTION 'Destino de provisión de Preview no autorizado'; END IF;
  -- En fixtures, el harness verifica el destino loopback del cliente antes de
  -- escribir. inet_server_addr() es la interfaz del servidor (interna en Docker),
  -- no el host al que se conectó el cliente. El comando remoto sigue fijado al
  -- proyecto de pruebas, TLS, propietario y base postgres.
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='sports_management' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity)
  THEN RAISE EXCEPTION 'La provisión exige RLS activo en todas las tablas'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='sports_management.club_affiliations'::regclass
    AND tgname='guard_submission_identity' AND tgenabled='O'
    AND tgfoid=to_regprocedure('sports_management.guard_affiliation_submission_identity()'))
  THEN RAISE EXCEPTION 'Falta la protección de claves de afiliación; aplique primero la migración aditiva'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${literal(PREVIEW_ROLE)}) THEN
    CREATE ROLE gestor_ligas_preview NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname=${literal(PREVIEW_ROLE)}
    AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication;
  IF runtime_oid IS NULL OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=runtime_oid OR roleid=runtime_oid)
  THEN RAISE EXCEPTION 'El rol de Preview debe ser limitado y sin membresías'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE relowner=runtime_oid AND relnamespace='sports_management'::regnamespace)
    OR has_schema_privilege(runtime_oid,'sports_management','CREATE') OR has_schema_privilege(runtime_oid,'public','CREATE')
  THEN RAISE EXCEPTION 'Preview no debe ser propietario ni tener CREATE'; END IF;
  GRANT USAGE ON SCHEMA sports_management TO gestor_ligas_preview;
  -- No se cambia LOGIN, contraseña, atributos ni valores de conexión existentes.
  FOR spec IN SELECT * FROM (VALUES ${tables}) AS t(name,sel,ins,upd,del,locking) LOOP
    table_oid := format('sports_management.%I',spec.name)::regclass;
    -- Una operación autorizada al backend nunca autoriza la misma ACL a PUBLIC.
    IF EXISTS(SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
      WHERE c.oid=table_oid AND acl.grantee=0)
    THEN RAISE EXCEPTION 'PUBLIC tiene permisos de tabla en %',spec.name; END IF;
    IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=table_oid
      AND (0=ANY(polroles) OR runtime_oid=ANY(polroles))
      AND polname NOT IN ('preview_backend_read','preview_backend_insert','preview_backend_update','preview_backend_delete','preview_backend_lock'))
    THEN RAISE EXCEPTION 'Política desconocida en %: revisar sin sobrescribir',spec.name; END IF;
    -- Validar políticas conocidas antes de normalizar sus ACL. Nunca sobrescribir
    -- una política desconocida ni ensancharla para hacer pasar las pruebas.
    FOREACH cmd IN ARRAY ARRAY['read','insert','update','delete','lock'] LOOP
      policy_name := 'preview_backend_' || cmd;
      expected_using := CASE WHEN cmd='insert' THEN NULL ELSE 'true' END;
      expected_check := CASE WHEN cmd='lock' THEN 'false' WHEN cmd IN ('insert','update') THEN 'true' ELSE NULL END;
      SELECT polcmd,polroles,polpermissive,pg_get_expr(polqual,polrelid) u,pg_get_expr(polwithcheck,polrelid) w
        INTO p FROM pg_policy WHERE polrelid=table_oid AND polname=policy_name;
      IF FOUND AND (NOT p.polpermissive OR p.polroles<>ARRAY[runtime_oid]::oid[]
        OR p.polcmd<>CASE cmd WHEN 'read' THEN 'r' WHEN 'insert' THEN 'a' WHEN 'delete' THEN 'd' ELSE 'w' END
        OR p.u IS DISTINCT FROM expected_using OR p.w IS DISTINCT FROM expected_check)
      THEN RAISE EXCEPTION 'Política distinta en %.%: revisar sin sobrescribir',spec.name,policy_name; END IF;
      IF FOUND THEN EXECUTE format('DROP POLICY %I ON sports_management.%I',policy_name,spec.name); END IF;
    END LOOP;
    -- Reemplazar solo ACL directas de las tablas expresamente revisadas.
    -- REVOKE de tabla no quita ACL por columna: retirarlas explícitamente.
    EXECUTE format('REVOKE SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON sports_management.%I FROM gestor_ligas_preview',spec.name);
    SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute WHERE attrelid=table_oid AND attnum>0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%s),INSERT (%s),UPDATE (%s),REFERENCES (%s) ON sports_management.%I FROM gestor_ligas_preview',cols,cols,cols,cols,spec.name);
    IF cardinality(spec.sel)>0 THEN
      SELECT string_agg(quote_ident(v),',') INTO cols FROM unnest(spec.sel) v;
      EXECUTE format('GRANT SELECT (%s) ON sports_management.%I TO gestor_ligas_preview',cols,spec.name);
    ELSE
      EXECUTE format('GRANT SELECT ON sports_management.%I TO gestor_ligas_preview',spec.name);
    END IF;
    EXECUTE format('CREATE POLICY preview_backend_read ON sports_management.%I FOR SELECT TO gestor_ligas_preview USING (true)',spec.name);
    IF cardinality(spec.ins)>0 THEN
      SELECT string_agg(quote_ident(v),',') INTO cols FROM unnest(spec.ins) v;
      EXECUTE format('GRANT INSERT (%s) ON sports_management.%I TO gestor_ligas_preview',cols,spec.name);
      EXECUTE format('CREATE POLICY preview_backend_insert ON sports_management.%I FOR INSERT TO gestor_ligas_preview WITH CHECK (true)',spec.name);
    END IF;
    IF cardinality(spec.upd)>0 THEN
      SELECT string_agg(quote_ident(v),',') INTO cols FROM unnest(spec.upd) v;
      EXECUTE format('GRANT UPDATE (%s) ON sports_management.%I TO gestor_ligas_preview',cols,spec.name);
      EXECUTE format('CREATE POLICY preview_backend_update ON sports_management.%I FOR UPDATE TO gestor_ligas_preview USING (true) WITH CHECK (true)',spec.name);
    ELSIF spec.locking THEN
      EXECUTE format('GRANT UPDATE (id) ON sports_management.%I TO gestor_ligas_preview',spec.name);
      EXECUTE format('CREATE POLICY preview_backend_lock ON sports_management.%I FOR UPDATE TO gestor_ligas_preview USING (true) WITH CHECK (false)',spec.name);
    END IF;
    IF spec.del THEN
      EXECUTE format('GRANT DELETE ON sports_management.%I TO gestor_ligas_preview',spec.name);
      EXECUTE format('CREATE POLICY preview_backend_delete ON sports_management.%I FOR DELETE TO gestor_ligas_preview USING (true)',spec.name);
    END IF;
    -- Fallar si PUBLIC u otra concesión deja columnas adicionales de lectura/escritura.
    FOR column_spec IN SELECT attname FROM pg_attribute WHERE attrelid=table_oid AND attnum>0 AND NOT attisdropped LOOP
      IF has_column_privilege(runtime_oid,table_oid,column_spec.attname,'SELECT') <> (cardinality(spec.sel)=0 OR column_spec.attname=ANY(spec.sel))
        OR has_column_privilege(runtime_oid,table_oid,column_spec.attname,'INSERT') <> (column_spec.attname=ANY(spec.ins))
        OR has_column_privilege(runtime_oid,table_oid,column_spec.attname,'UPDATE') <> (column_spec.attname=ANY(spec.upd) OR (spec.locking AND cardinality(spec.upd)=0 AND column_spec.attname='id'))
      THEN RAISE EXCEPTION 'Privilegios efectivos inesperados en %',spec.name; END IF;
    END LOOP;
    IF has_table_privilege(runtime_oid,table_oid,'DELETE') <> spec.del
      OR has_table_privilege(runtime_oid,table_oid,'TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(runtime_oid,table_oid,'REFERENCES')
      OR EXISTS(SELECT 1 FROM pg_class rel CROSS JOIN LATERAL aclexplode(rel.relacl) acl
        WHERE rel.oid=table_oid AND acl.privilege_type='MAINTAIN'
          AND CASE WHEN acl.grantee=0 THEN true ELSE pg_has_role(runtime_oid,acl.grantee,'USAGE') END)
    THEN RAISE EXCEPTION 'Privilegios de tabla inesperados en %',spec.name; END IF;
    IF spec.locking AND cardinality(spec.upd)=0 AND EXISTS(SELECT 1 FROM pg_policy
      WHERE polrelid=table_oid AND polcmd IN ('w','*') AND polname<>'preview_backend_lock'
        AND (0=ANY(polroles) OR runtime_oid=ANY(polroles)))
    THEN RAISE EXCEPTION 'Otra política permite modificar una tabla de solo bloqueo: %',spec.name; END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION sports_management.get_entity_season(text,uuid),sports_management.get_role_code(uuid),sports_management.player_participation_now() TO gestor_ligas_preview;
  GRANT EXECUTE ON FUNCTION sports_management.maintenance_has_references(text,uuid) TO gestor_ligas_preview;
  IF has_table_privilege(runtime_oid,'public._prisma_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_any_column_privilege(runtime_oid,'public._prisma_migrations','SELECT,INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION 'Preview tiene acceso al ledger de Prisma'; END IF;
END $preview$;`;
}

export async function provisionPreviewRuntime(client) {
  await client.query('BEGIN');
  try {
    await client.query(previewRuntimeSql());
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
