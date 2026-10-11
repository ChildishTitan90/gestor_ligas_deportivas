-- Gestor de Ligas Deportivas: esquema inicial derivado del ERS de octubre 2026.
-- Ejecutar UNA VEZ en una base vacia seleccionada en pgAdmin o psql.
-- No crea ni elimina bases de datos. Requiere PostgreSQL y extension btree_gist.
-- psql -v ON_ERROR_STOP=1 -d sports_leagues -f ligas_deportivas.sql
-- Las reglas [PV] deben validarse antes de activar una temporada.
-- Los motores de programacion, elegibilidad, sanctions, tablas, permissions y
-- publicacion se implementan en backend; este archivo entrega su persistencia.
-- Revision: table/column identifiers in English; every table has a UUID primary key.
-- Supabase: ejecutar TODO el archivo, sin seleccionar fragmentos.
-- Tablas y vistas usan nombres de esquema explicitos.
-- Existing populated databases need a separate data migration; this is fresh-install DDL.
BEGIN;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE SCHEMA sports_management;
SET LOCAL search_path TO sports_management, public, extensions;

-- 1. Identidades, files privados, autenticacion y autorizacion (RF18, RF22).
CREATE TABLE sports_management.people (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 first_name text NOT NULL, paternal_surname text NOT NULL, maternal_surname text,
 birth_date date, curp varchar(18) UNIQUE,
 email text, phone text, address text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (curp IS NULL OR curp ~ '^[A-Z][AEIOUX][A-Z]{2}[0-9]{6}[HM][A-Z]{5}[A-Z0-9][0-9]$'),
 CHECK (curp IS NULL OR (birth_date IS NOT NULL AND substring(curp,5,6)=to_char(birth_date,'YYMMDD')))
);
CREATE TABLE sports_management.users (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 person_id uuid NOT NULL UNIQUE REFERENCES sports_management.people,
 username text NOT NULL, email text NOT NULL,
 password_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true,
 must_change_password boolean NOT NULL DEFAULT true,
 failed_login_attempts integer NOT NULL DEFAULT 0 CHECK(failed_login_attempts>=0),
 locked_until timestamptz, encrypted_mfa_secret text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_unique ON sports_management.users(lower(username));
CREATE UNIQUE INDEX users_email_unique ON sports_management.users(lower(email));
CREATE TABLE sports_management.files (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 storage_key text NOT NULL UNIQUE, original_name text NOT NULL,
 mime_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0),
 sha256 varchar(64) CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 uploaded_by uuid NOT NULL REFERENCES sports_management.users,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE sports_management.files IS 'Solo claves de almacenamiento privado; generar URLs firmadas en servidor. No guardar URLs publicas ni tokens.';
CREATE TABLE sports_management.sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES sports_management.users,
 token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 last_activity_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, CHECK(expires_at>created_at)
);
CREATE TABLE sports_management.password_resets (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL REFERENCES sports_management.users,
 token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, used_at timestamptz, CHECK(expires_at>created_at)
);
CREATE TABLE sports_management.roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE, name text NOT NULL
);
CREATE FUNCTION sports_management.get_role_code(catalog_id uuid) RETURNS text LANGUAGE sql STABLE
 SET search_path = sports_management, pg_temp AS $$ SELECT code FROM sports_management.roles WHERE id=catalog_id $$;

INSERT INTO sports_management.roles(code,name) VALUES
 ('SUPERADMIN','Administrador general'),('EXECUTIVE_PRESIDENT','Presidente ejecutivo'),
 ('SECRETARY','Secretario'),('TREASURER','Tesorero'),('DISCIPLINARY_BOARD','Comision disciplinaria'),
 ('REFEREE_MANAGER','Comision de arbitraje'),('SCHEDULER','Programador'),
 ('CLUB_DELEGATE','Delegado de club'),('REFEREE','Arbitro'),('DATA_ENTRY','Capturista'),
 ('PLAYER','Jugador'),('GUEST','Publico');
CREATE TABLE sports_management.permissions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, module text NOT NULL,
 action text NOT NULL CHECK(action IN ('CREATE','READ','UPDATE','APPROVE','PUBLISH','IMPORT')),
 UNIQUE(module,action)
);
CREATE TABLE sports_management.role_permissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 role_id uuid NOT NULL REFERENCES sports_management.roles, permission_id uuid NOT NULL REFERENCES sports_management.permissions,
 context_only boolean NOT NULL DEFAULT true, UNIQUE(role_id,permission_id)
);

-- 2. Liga, deporte, seasons y reglas versionadas (RF08, RNF12).
CREATE TABLE sports_management.sports (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL
);
INSERT INTO sports_management.sports(code,name) VALUES ('SOCCER','Futbol');
CREATE TABLE sports_management.leagues (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, name text NOT NULL UNIQUE,
 timezone text NOT NULL DEFAULT 'America/Mexico_City', is_active boolean NOT NULL DEFAULT true
);
INSERT INTO sports_management.leagues(name) VALUES ('Liga Municipal de Futbol de Morelia');
CREATE TABLE sports_management.seasons (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 sport_id uuid NOT NULL REFERENCES sports_management.sports, name text NOT NULL,
 start_date date NOT NULL, end_date date NOT NULL,
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','CLOSED')),
 competition_starts_at timestamptz, closed_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(league_id,sport_id,name), UNIQUE(id,league_id), CHECK(end_date>=start_date)
);
CREATE TABLE sports_management.competition_rules (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 version_number integer NOT NULL CHECK(version_number>0), file_id uuid REFERENCES sports_management.files,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),
 approved_by uuid REFERENCES sports_management.users, approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(season_id,version_number), UNIQUE(id,season_id),
 CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE sports_management.competition_rule_parameters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 competition_rule_id uuid NOT NULL REFERENCES sports_management.competition_rules, parameter_key text NOT NULL, parameter_value jsonb NOT NULL,
 requires_validation boolean NOT NULL DEFAULT false, validated_by uuid REFERENCES sports_management.users,
 UNIQUE(competition_rule_id,parameter_key)
);
COMMENT ON TABLE sports_management.competition_rule_parameters IS 'Puntos, desempates ordenados, defaults para baja, edades, ascensos, duracion, holgura, ultimas N fechas, plazos de recurso, morosidad. Validar esquema JSON en backend.';
CREATE TABLE sports_management.categories (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 sport_id uuid NOT NULL REFERENCES sports_management.sports, name text NOT NULL,
 UNIQUE(league_id,sport_id,name)
);
CREATE TABLE sports_management.season_categories (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 category_id uuid NOT NULL REFERENCES sports_management.categories, competition_rule_id uuid NOT NULL,
 hierarchy_order integer NOT NULL CHECK(hierarchy_order>0),
 type text NOT NULL CHECK(type IN ('OPEN','YOUTH','VETERANS')),
 minimum_age integer CHECK(minimum_age>=0), maximum_age integer CHECK(maximum_age>=0),
 age_cutoff_date date NOT NULL,
 UNIQUE(season_id,category_id), UNIQUE(id,season_id),
 FOREIGN KEY(competition_rule_id,season_id) REFERENCES sports_management.competition_rules(id,season_id),
 CHECK(maximum_age IS NULL OR minimum_age IS NULL OR maximum_age>=minimum_age)
);
CREATE TABLE sports_management.document_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE, name text NOT NULL
);
INSERT INTO sports_management.document_types(code,name) VALUES ('IDENTIFICATION','Identificacion'),('INE','INE'),('CURP','CURP'),
 ('STUDENT_CERTIFICATE','Constancia de estudios'),('PROOF_OF_ADDRESS','Comprobante de address'),
 ('PHOTO','Fotografia'),('GUARDIAN_CONSENT','Consentimiento del tutor'),('SUPPORTING_DOCUMENT','Soporte de tramite');
CREATE TABLE sports_management.document_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 season_category_id uuid NOT NULL REFERENCES sports_management.season_categories,
 document_type_id uuid NOT NULL REFERENCES sports_management.document_types, quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0),
 is_required boolean NOT NULL DEFAULT true, UNIQUE(season_category_id,document_type_id)
);
CREATE TABLE sports_management.groups (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 season_category_id uuid NOT NULL, name text NOT NULL,
 FOREIGN KEY(season_category_id,season_id) REFERENCES sports_management.season_categories(id,season_id),
 UNIQUE(season_category_id,name), UNIQUE(id,season_id)
);
CREATE TABLE sports_management.matchdays (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 number integer NOT NULL CHECK(number>0), start_date date NOT NULL, end_date date NOT NULL,
 UNIQUE(season_id,number), UNIQUE(id,season_id), CHECK(end_date>=start_date)
);
CREATE TABLE sports_management.season_breaks (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 starts_at date NOT NULL, ends_at date NOT NULL, reason text NOT NULL, CHECK(ends_at>=starts_at)
);

-- 3. Club, afiliacion anual, directivos, teams y jugadores (RF01, RF02, RF21).
CREATE TABLE sports_management.clubs (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 reference_number text UNIQUE NOT NULL, name text NOT NULL, founded_on date,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','WITHDRAWN')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,league_id)
);
CREATE TABLE sports_management.club_affiliations (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 club_id uuid NOT NULL, league_id uuid NOT NULL, reference_number text NOT NULL UNIQUE,
 uniform_colors text NOT NULL, status text NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 requested_by uuid NOT NULL REFERENCES sports_management.users, reviewed_by uuid REFERENCES sports_management.users,
 reviewed_at timestamptz, review_reason text, signed_affiliation_file_id uuid REFERENCES sports_management.files,
 FOREIGN KEY(season_id,league_id) REFERENCES sports_management.seasons(id,league_id),
 FOREIGN KEY(club_id,league_id) REFERENCES sports_management.clubs(id,league_id), UNIQUE(club_id,season_id), UNIQUE(id,season_id)
);
CREATE TABLE sports_management.club_officers (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, affiliation_id uuid NOT NULL REFERENCES sports_management.club_affiliations,
 person_id uuid NOT NULL REFERENCES sports_management.people, office text NOT NULL CHECK(office IN ('PRESIDENT','SECRETARY','TREASURER')),
 starts_at date NOT NULL, ends_at date, signature_file_id uuid REFERENCES sports_management.files,
 support_file_id uuid REFERENCES sports_management.files, CHECK(ends_at IS NULL OR ends_at>=starts_at),
 EXCLUDE USING gist(affiliation_id WITH =,office WITH =,daterange(starts_at,ends_at,'[]') WITH &&)
);
CREATE TABLE sports_management.teams (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, club_id uuid NOT NULL REFERENCES sports_management.clubs,
 reference_number text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,club_id)
);
CREATE TABLE sports_management.season_teams (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 team_id uuid NOT NULL, club_id uuid NOT NULL, group_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'REGISTERED' CHECK(status IN ('REGISTERED','ACTIVE','WITHDRAWN')),
 FOREIGN KEY(team_id,club_id) REFERENCES sports_management.teams(id,club_id),
 FOREIGN KEY(club_id,season_id) REFERENCES sports_management.club_affiliations(club_id,season_id),
 FOREIGN KEY(group_id,season_id) REFERENCES sports_management.groups(id,season_id),
 UNIQUE(team_id,season_id), UNIQUE(id,season_id), UNIQUE(id,group_id,season_id)
);
CREATE TABLE sports_management.user_roles (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL REFERENCES sports_management.users,
 role_id uuid NOT NULL REFERENCES sports_management.roles, league_id uuid REFERENCES sports_management.leagues, club_id uuid REFERENCES sports_management.clubs,
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, CHECK(ends_at IS NULL OR ends_at>starts_at),
 CHECK(sports_management.get_role_code(role_id)<>'CLUB_DELEGATE' OR (club_id IS NOT NULL AND league_id IS NOT NULL)),
 FOREIGN KEY(club_id,league_id) REFERENCES sports_management.clubs(id,league_id)
);
CREATE TABLE sports_management.governing_bodies (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 name text NOT NULL, UNIQUE(league_id,name)
);
CREATE TABLE sports_management.positions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, governing_body_id uuid NOT NULL REFERENCES sports_management.governing_bodies,
 name text NOT NULL, role_id uuid REFERENCES sports_management.roles, UNIQUE(governing_body_id,name)
);
CREATE TABLE sports_management.appointments (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, position_id uuid NOT NULL REFERENCES sports_management.positions,
 person_id uuid NOT NULL REFERENCES sports_management.people, starts_at date NOT NULL, ends_at date,
 document_file_id uuid REFERENCES sports_management.files, CHECK(ends_at IS NULL OR ends_at>=starts_at)
);
CREATE TABLE sports_management.player_registrations (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, person_id uuid NOT NULL REFERENCES sports_management.people,
 season_id uuid NOT NULL, season_team_id uuid NOT NULL,
 reference_number text NOT NULL UNIQUE, registered_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','WITHDRAWN','INELIGIBLE')),
 authorized_by uuid REFERENCES sports_management.users, age_exception_reason text,
 age_exception_file_id uuid REFERENCES sports_management.files,
 FOREIGN KEY(season_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 UNIQUE(person_id,season_team_id), UNIQUE(id,season_id),
 CHECK((status='WITHDRAWN')=(withdrawn_at IS NOT NULL)),
 CHECK(age_exception_reason IS NULL OR (authorized_by IS NOT NULL AND age_exception_file_id IS NOT NULL))
);
-- Una suspension NO libera la pertenencia del jugador a su club/equipo.
CREATE UNIQUE INDEX unique_player_per_season ON sports_management.player_registrations(person_id,season_id) WHERE withdrawn_at IS NULL;
CREATE TABLE sports_management.player_documents (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, registration_id uuid NOT NULL REFERENCES sports_management.player_registrations,
 document_type_id uuid NOT NULL REFERENCES sports_management.document_types, file_id uuid NOT NULL REFERENCES sports_management.files,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VALIDATED','REJECTED')),
 reviewed_by uuid REFERENCES sports_management.users, reason text, UNIQUE(registration_id,file_id)
);
CREATE TABLE sports_management.guardian_consents (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, registration_id uuid NOT NULL REFERENCES sports_management.player_registrations,
 guardian_person_id uuid NOT NULL REFERENCES sports_management.people, relationship text NOT NULL,
 privacy_notice_version text NOT NULL, signed_at timestamptz NOT NULL,
 document_file_id uuid NOT NULL REFERENCES sports_management.files
);
CREATE TABLE sports_management.player_status_history (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, registration_id uuid NOT NULL REFERENCES sports_management.player_registrations,
 previous_status text, new_status text NOT NULL, user_id uuid NOT NULL REFERENCES sports_management.users,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.club_team_changes (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 club_id uuid REFERENCES sports_management.clubs, team_id uuid REFERENCES sports_management.teams,
 type text NOT NULL CHECK(type IN ('NAME','OFFICERS','SALE')),
 previous_values jsonb NOT NULL, new_values jsonb NOT NULL,
 new_team_id uuid REFERENCES sports_management.teams, document_file_id uuid NOT NULL REFERENCES sports_management.files,
 approved_by uuid NOT NULL REFERENCES sports_management.users, approved_at timestamptz NOT NULL,
 reason text NOT NULL, CHECK(num_nonnulls(club_id,team_id)=1),
 CHECK(type<>'SALE' OR (team_id IS NOT NULL AND new_team_id IS NOT NULL AND team_id<>new_team_id))
);

-- 4. Canchas, disponibilidad, prestamos y horarios de localia (RF04).
CREATE TABLE sports_management.venues (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 code text NOT NULL, name text NOT NULL, address text NOT NULL,
 is_league_sports_complex boolean NOT NULL DEFAULT false, owner_club_id uuid,
 features jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
 UNIQUE(league_id,code), UNIQUE(id,league_id),
 FOREIGN KEY(owner_club_id,league_id) REFERENCES sports_management.clubs(id,league_id)
);
CREATE TABLE sports_management.venue_availability (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, venue_id uuid NOT NULL REFERENCES sports_management.venues,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 type text NOT NULL CHECK(type IN ('AVAILABLE','BLOCK','MAINTENANCE')),
 reason text, CHECK(ends_at>starts_at)
);
CREATE TABLE sports_management.venue_loans (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 venue_id uuid NOT NULL REFERENCES sports_management.venues, club_id uuid NOT NULL REFERENCES sports_management.clubs,
 letter_file_id uuid NOT NULL REFERENCES sports_management.files, status text NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','APPROVED','REJECTED')),
 approved_by uuid REFERENCES sports_management.users, approved_at timestamptz,
 CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TABLE sports_management.home_venue_assignments (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_team_id uuid NOT NULL REFERENCES sports_management.season_teams,
 venue_id uuid NOT NULL REFERENCES sports_management.venues, venue_loan_id uuid REFERENCES sports_management.venue_loans,
 weekday integer NOT NULL CHECK(weekday BETWEEN 1 AND 7), start_time time NOT NULL,
 starts_at date NOT NULL, ends_at date NOT NULL, CHECK(ends_at>=starts_at)
);

-- 5. Programacion, matches y reserva de appeals (RF05, RF09, RNF04).
-- Se normalizan ENCURSO / ENREVISION / NOPRESENTADO / NOPROGRAMADO del ERS.
CREATE TABLE sports_management.match_statuses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE, name text NOT NULL, reserves_resources boolean NOT NULL
);
CREATE FUNCTION sports_management.get_match_status_id(status_code text) RETURNS uuid LANGUAGE sql STABLE
 SET search_path = sports_management, pg_temp AS $$ SELECT id FROM sports_management.match_statuses WHERE code=status_code $$;

CREATE FUNCTION sports_management.get_match_status_code(catalog_id uuid) RETURNS text LANGUAGE sql STABLE
 SET search_path = sports_management, pg_temp AS $$ SELECT code FROM sports_management.match_statuses WHERE id=catalog_id $$;

INSERT INTO sports_management.match_statuses(code,name,reserves_resources) VALUES
 ('DRAFT','Borrador',false),('SCHEDULED','Programado',true),('CONFIRMED','Confirmado',true),
 ('IN_PROGRESS','En curso',true),('FINISHED','Finalizado',true),('UNDER_REVIEW','En revision',true),
 ('NO_SHOW','No presentado (default)',true),('SUSPENDED','Suspendido',false),
 ('CANCELED','Cancelado',false),('RESCHEDULED','Reprogramado',true),
 ('UNSCHEDULED','No programado',false),('ADMINISTRATIVELY_RESOLVED','Resuelto administrativamente',false);
CREATE TABLE sports_management.match_status_transitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 from_status_id uuid NOT NULL REFERENCES sports_management.match_statuses, to_status_id uuid NOT NULL REFERENCES sports_management.match_statuses,
 role_id uuid NOT NULL REFERENCES sports_management.roles, UNIQUE(from_status_id,to_status_id,role_id), CHECK(from_status_id<>to_status_id)
);
COMMENT ON TABLE sports_management.match_status_transitions IS 'Cargar la matriz de transiciones autorizada por la Liga; validarla en el servicio de dominio.';
CREATE TABLE sports_management.schedule_proposals (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 matchday_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES sports_management.users,
 competition_rule_id uuid NOT NULL, parameters jsonb NOT NULL DEFAULT '{}', conflicts jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(matchday_id,season_id) REFERENCES sports_management.matchdays(id,season_id),
 FOREIGN KEY(competition_rule_id,season_id) REFERENCES sports_management.competition_rules(id,season_id)
);
CREATE TABLE sports_management.matches (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 group_id uuid NOT NULL, matchday_id uuid NOT NULL, number text NOT NULL,
 home_team_id uuid NOT NULL, away_team_id uuid NOT NULL,
 venue_id uuid REFERENCES sports_management.venues, starts_at timestamptz, ends_at timestamptz,
 -- Incluye holgura: reserved_until >= ends_at. No programar usando solo el instante inicial.
 reserved_until timestamptz,
 status_id uuid NOT NULL DEFAULT sports_management.get_match_status_id('DRAFT') REFERENCES sports_management.match_statuses,
 schedule_proposal_id uuid REFERENCES sports_management.schedule_proposals, notes text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), deleted_at timestamptz,
 FOREIGN KEY(group_id,season_id) REFERENCES sports_management.groups(id,season_id),
 FOREIGN KEY(matchday_id,season_id) REFERENCES sports_management.matchdays(id,season_id),
 FOREIGN KEY(home_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 FOREIGN KEY(away_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 UNIQUE(season_id,number), UNIQUE(id,season_id),
 CHECK(home_team_id<>away_team_id),
 CHECK((starts_at IS NULL AND ends_at IS NULL AND reserved_until IS NULL) OR (starts_at IS NOT NULL AND ends_at IS NOT NULL AND reserved_until IS NOT NULL AND ends_at>starts_at AND reserved_until>=ends_at)),
 CHECK(starts_at IS NULL OR venue_id IS NOT NULL),
 CHECK(sports_management.get_match_status_code(status_id) NOT IN ('SCHEDULED','CONFIRMED','IN_PROGRESS','RESCHEDULED') OR starts_at IS NOT NULL)
);
CREATE TABLE sports_management.venue_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 match_id uuid NOT NULL UNIQUE REFERENCES sports_management.matches, venue_id uuid NOT NULL REFERENCES sports_management.venues,
 time_range tstzrange NOT NULL, CHECK(NOT isempty(time_range)),
 EXCLUDE USING gist(venue_id WITH =,time_range WITH &&)
);
CREATE TABLE sports_management.team_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 match_id uuid NOT NULL REFERENCES sports_management.matches, season_team_id uuid NOT NULL REFERENCES sports_management.season_teams,
 time_range tstzrange NOT NULL, UNIQUE(match_id,season_team_id), CHECK(NOT isempty(time_range)),
 EXCLUDE USING gist(season_team_id WITH =,time_range WITH &&)
);
-- Reservas derivadas: no conceder INSERT/UPDATE/DELETE directo a la aplicacion.
CREATE FUNCTION sports_management.sync_match_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE is_reserved boolean;
BEGIN
 DELETE FROM sports_management.venue_reservations WHERE match_id=NEW.id;
 DELETE FROM sports_management.team_reservations WHERE match_id=NEW.id;
 SELECT reserves_resources INTO is_reserved FROM sports_management.match_statuses WHERE id=NEW.status_id;
 IF is_reserved AND NEW.starts_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
  INSERT INTO sports_management.venue_reservations(match_id,venue_id,time_range) VALUES(NEW.id,NEW.venue_id,tstzrange(NEW.starts_at,NEW.reserved_until,'[)'));
  INSERT INTO sports_management.team_reservations(match_id,season_team_id,time_range) VALUES(NEW.id,NEW.home_team_id,tstzrange(NEW.starts_at,NEW.ends_at,'[)')),
                                     (NEW.id,NEW.away_team_id,tstzrange(NEW.starts_at,NEW.ends_at,'[)'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER matches_reservations AFTER INSERT OR UPDATE ON sports_management.matches FOR EACH ROW EXECUTE FUNCTION sports_management.sync_match_reservations();
CREATE TABLE sports_management.match_status_history (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, match_id uuid NOT NULL REFERENCES sports_management.matches,
 previous_status_id uuid REFERENCES sports_management.match_statuses, new_status_id uuid NOT NULL REFERENCES sports_management.match_statuses,
 user_id uuid NOT NULL REFERENCES sports_management.users, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.team_byes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 season_id uuid NOT NULL, matchday_id uuid NOT NULL, season_team_id uuid NOT NULL,
 UNIQUE(matchday_id,season_team_id),
 FOREIGN KEY(matchday_id,season_id) REFERENCES sports_management.matchdays(id,season_id),
 FOREIGN KEY(season_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id)
);

-- 6. Arbitraje y match_reports, con idempotencia de sincronizacion (RF03, RF11).
CREATE TABLE sports_management.referees (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, person_id uuid NOT NULL UNIQUE REFERENCES sports_management.people,
 is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE sports_management.club_season_referees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 referee_id uuid NOT NULL REFERENCES sports_management.referees, season_id uuid NOT NULL, club_id uuid NOT NULL,
 UNIQUE(referee_id,season_id),
 FOREIGN KEY(club_id,season_id) REFERENCES sports_management.club_affiliations(club_id,season_id)
);
CREATE TABLE sports_management.referee_availability (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, referee_id uuid NOT NULL REFERENCES sports_management.referees,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, is_available boolean NOT NULL,
 CHECK(ends_at>starts_at)
);
CREATE TABLE sports_management.referee_assignments (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, match_id uuid NOT NULL REFERENCES sports_management.matches,
 referee_id uuid NOT NULL REFERENCES sports_management.referees, assignment_role text NOT NULL DEFAULT 'MAIN',
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','APPROVED','REVOKED')),
 created_by uuid NOT NULL REFERENCES sports_management.users, approved_by uuid REFERENCES sports_management.users, approved_at timestamptz,
 CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX active_referee_assignment ON sports_management.referee_assignments(match_id,referee_id) WHERE status<>'REVOKED';
CREATE TABLE sports_management.match_reports (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, match_id uuid NOT NULL UNIQUE REFERENCES sports_management.matches,
 client_id uuid NOT NULL UNIQUE, captured_by uuid NOT NULL REFERENCES sports_management.users,
 source text NOT NULL CHECK(source IN ('MOBILE','PAPER')),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED','UNDER_REVIEW')),
 snapshot_version integer, snapshot_downloaded_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 home_captain_signature_file_id uuid REFERENCES sports_management.files, away_captain_signature_file_id uuid REFERENCES sports_management.files,
 paper_copy_file_id uuid REFERENCES sports_management.files, remarks text,
 created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
 CHECK(status<>'CONFIRMED' OR confirmed_at IS NOT NULL)
);
CREATE TABLE sports_management.match_report_syncs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL UNIQUE, match_report_id uuid REFERENCES sports_management.match_reports,
 user_id uuid NOT NULL REFERENCES sports_management.users, base_version integer NOT NULL,
 status text NOT NULL CHECK(status IN ('RECEIVED','APPLIED','CONFLICT','REJECTED')),
 private_payload jsonb NOT NULL, reason text, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.lineups (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, match_report_id uuid NOT NULL REFERENCES sports_management.match_reports,
 registration_id uuid NOT NULL REFERENCES sports_management.player_registrations,
 season_team_id uuid NOT NULL REFERENCES sports_management.season_teams,
 jersey_number integer CHECK(jersey_number>=0), is_captain boolean NOT NULL DEFAULT false,
 validated_by uuid NOT NULL REFERENCES sports_management.users, exception_rule text,
 UNIQUE(match_report_id,registration_id)
);
CREATE TABLE sports_management.player_period_participations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 lineup_id uuid NOT NULL REFERENCES sports_management.lineups, period_number integer NOT NULL CHECK(period_number>0),
 entry_minute integer CHECK(entry_minute>=0), exit_minute integer CHECK(exit_minute>=0),
 UNIQUE(lineup_id,period_number),
 CHECK(exit_minute IS NULL OR entry_minute IS NULL OR exit_minute>=entry_minute)
);
CREATE TABLE sports_management.event_types (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, sport_id uuid NOT NULL REFERENCES sports_management.sports,
 code text NOT NULL, name text NOT NULL, requires_disciplinary_case boolean NOT NULL DEFAULT false,
 UNIQUE(sport_id,code)
);
INSERT INTO sports_management.event_types(sport_id,code,name,requires_disciplinary_case)
 SELECT id,v.code,v.name,v.disciplinary_case FROM sports_management.sports CROSS JOIN
 (VALUES ('GOAL','Gol',false),('CAUTION','Amonestacion',false),('SENDING_OFF','Expulsion',true),
 ('SERIOUS_INCIDENT','Incidente grave',true),('SUBSTITUTION','Cambio',false)) AS v(code,name,disciplinary_case) WHERE sports.code='SOCCER';
CREATE TABLE sports_management.match_events (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, match_report_id uuid NOT NULL REFERENCES sports_management.match_reports,
 event_type_id uuid NOT NULL REFERENCES sports_management.event_types,
 season_team_id uuid REFERENCES sports_management.season_teams,
 lineup_id uuid REFERENCES sports_management.lineups, outgoing_lineup_id uuid REFERENCES sports_management.lineups,
 period_number integer CHECK(period_number>0), minute integer CHECK(minute>=0), description text
);
CREATE TABLE sports_management.match_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 match_id uuid NOT NULL UNIQUE REFERENCES sports_management.matches, home_score integer NOT NULL CHECK(home_score>=0),
 away_score integer NOT NULL CHECK(away_score>=0),
 source text NOT NULL CHECK(source IN ('MATCH_REPORT','DEFAULT','ADMINISTRATIVE')),
 offending_team_id uuid REFERENCES sports_management.season_teams,
 counts_in_standings boolean NOT NULL DEFAULT true, validated_by uuid NOT NULL REFERENCES sports_management.users,
 validated_at timestamptz NOT NULL DEFAULT now(), reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK(source<>'DEFAULT' OR offending_team_id IS NOT NULL)
);
CREATE TABLE sports_management.match_report_corrections (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, match_report_id uuid NOT NULL REFERENCES sports_management.match_reports,
 previous_version integer NOT NULL, previous_values jsonb NOT NULL, new_values jsonb NOT NULL,
 authorized_by uuid NOT NULL REFERENCES sports_management.users, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Default documentado en RF07.8: marcador 1-0, ganador presente.
CREATE FUNCTION sports_management.validate_match_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE home_team uuid; away_team uuid;
BEGIN
 SELECT home_team_id,away_team_id INTO home_team,away_team FROM sports_management.matches WHERE id=NEW.match_id;
 IF NEW.offending_team_id IS NOT NULL AND NEW.offending_team_id NOT IN (home_team,away_team) THEN
  RAISE EXCEPTION 'El equipo infractor debe participar en el partido';
 END IF;
 IF NEW.source='DEFAULT' THEN
  IF NEW.offending_team_id=home_team THEN
   IF NEW.home_score<>0 OR NEW.away_score<>1 THEN RAISE EXCEPTION 'Default del local requiere 0-1'; END IF;
  ELSE
   IF NEW.home_score<>1 OR NEW.away_score<>0 THEN RAISE EXCEPTION 'Default del visitante requiere 1-0'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consistent_match_result BEFORE INSERT OR UPDATE ON sports_management.match_results FOR EACH ROW EXECUTE FUNCTION sports_management.validate_match_result();

-- 7. Reglamento, disciplinary_cases, disciplinary_rulings y appeals (RF06, RF10, RF14).
CREATE TABLE sports_management.sanction_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE,name text NOT NULL
);
CREATE FUNCTION sports_management.get_sanction_type_code(catalog_id uuid) RETURNS text LANGUAGE sql STABLE
 SET search_path = sports_management, pg_temp AS $$ SELECT code FROM sports_management.sanction_types WHERE id=catalog_id $$;

INSERT INTO sports_management.sanction_types(code,name) VALUES ('MATCHES','Suspension por matches'),('MATCHDAYS','Suspension por fechas'),
 ('TIME','Suspension por tiempo'),('FINE','Multa'),('MATCH_FORFEIT','Perdida de partido'),
 ('POINTS_DEDUCTION','Perdida de points'),('TEAM_WITHDRAWAL','Baja de equipo');
CREATE TABLE sports_management.regulation_articles (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, competition_rule_id uuid NOT NULL REFERENCES sports_management.competition_rules,
 number text NOT NULL, description text NOT NULL, sanction_type_id uuid NOT NULL REFERENCES sports_management.sanction_types,
 parameters jsonb NOT NULL DEFAULT '{}', UNIQUE(competition_rule_id,number)
);
CREATE TABLE sports_management.disciplinary_cases (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 reference_number text UNIQUE NOT NULL, event_id uuid REFERENCES sports_management.match_events,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','UNDER_ANALYSIS','RESOLVED','UNDER_APPEAL','CLOSED')),
 opened_by uuid NOT NULL REFERENCES sports_management.users, created_at timestamptz NOT NULL DEFAULT now(), description text NOT NULL
);
CREATE TABLE sports_management.case_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES sports_management.disciplinary_cases, file_id uuid NOT NULL REFERENCES sports_management.files,
 description text, UNIQUE(case_id,file_id)
);
CREATE TABLE sports_management.disciplinary_rulings (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, case_id uuid NOT NULL REFERENCES sports_management.disciplinary_cases,
 version_number integer NOT NULL CHECK(version_number>0), replaces_ruling_id uuid REFERENCES sports_management.disciplinary_rulings,
 decided_by uuid NOT NULL REFERENCES sports_management.users, issued_at timestamptz NOT NULL DEFAULT now(),
 decision text NOT NULL, reason text NOT NULL, document_file_id uuid REFERENCES sports_management.files,
 UNIQUE(case_id,version_number), UNIQUE(id,case_id)
);
CREATE TABLE sports_management.sanctions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, ruling_id uuid NOT NULL REFERENCES sports_management.disciplinary_rulings,
 article_id uuid NOT NULL REFERENCES sports_management.regulation_articles, sanction_type_id uuid NOT NULL REFERENCES sports_management.sanction_types,
 registration_id uuid REFERENCES sports_management.player_registrations, season_team_id uuid REFERENCES sports_management.season_teams,
 starts_at timestamptz NOT NULL, ends_at timestamptz,
 quantity integer CHECK(quantity>0), amount numeric(12,2) CHECK(amount>0),
 blocks_participation boolean NOT NULL DEFAULT false,
 CHECK(num_nonnulls(registration_id,season_team_id)=1),
 CHECK(ends_at IS NULL OR ends_at>starts_at),
 CHECK(sports_management.get_sanction_type_code(sanction_type_id) NOT IN ('MATCHES','MATCHDAYS','POINTS_DEDUCTION') OR quantity IS NOT NULL),
 CHECK(sports_management.get_sanction_type_code(sanction_type_id)<>'TIME' OR ends_at IS NOT NULL), CHECK(sports_management.get_sanction_type_code(sanction_type_id)<>'FINE' OR amount IS NOT NULL)
);
CREATE TABLE sports_management.sanction_fulfillments (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, sanction_id uuid NOT NULL REFERENCES sports_management.sanctions,
 match_id uuid REFERENCES sports_management.matches, matchday_id uuid REFERENCES sports_management.matchdays,
 recorded_by uuid NOT NULL REFERENCES sports_management.users, recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(match_id,matchday_id)=1)
);
CREATE UNIQUE INDEX sanction_fulfillment_per_match ON sports_management.sanction_fulfillments(sanction_id,match_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX sanction_fulfillment_per_matchday ON sports_management.sanction_fulfillments(sanction_id,matchday_id) WHERE matchday_id IS NOT NULL;
CREATE TABLE sports_management.appeals (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, ruling_id uuid NOT NULL REFERENCES sports_management.disciplinary_rulings,
 submitted_by uuid NOT NULL REFERENCES sports_management.users, reason text NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT now(), suspends_sanction boolean NOT NULL DEFAULT false
);
CREATE TABLE sports_management.appeal_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 appeal_id uuid NOT NULL REFERENCES sports_management.appeals, file_id uuid NOT NULL REFERENCES sports_management.files, UNIQUE(appeal_id,file_id)
);
CREATE TABLE sports_management.appeal_decisions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, appeal_id uuid NOT NULL REFERENCES sports_management.appeals,
 outcome text NOT NULL CHECK(outcome IN ('CONFIRM','MODIFY','REVOKE')),
 decided_by uuid NOT NULL REFERENCES sports_management.users, new_ruling_id uuid REFERENCES sports_management.disciplinary_rulings,
 reason text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.team_withdrawals (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_team_id uuid NOT NULL REFERENCES sports_management.season_teams,
 type text NOT NULL CHECK(type IN ('VOLUNTARY','DEFAULT','NONPAYMENT','DISCIPLINARY')),
 article_id uuid NOT NULL REFERENCES sports_management.regulation_articles, document_file_id uuid NOT NULL REFERENCES sports_management.files,
 ruling_id uuid REFERENCES sports_management.disciplinary_rulings, reason text NOT NULL,
 effect text NOT NULL CHECK(effect IN ('FUTURE_FORFEITS','FUTURE_VOID','RETROACTIVE')),
 requested_by uuid NOT NULL REFERENCES sports_management.users, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.withdrawal_decisions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, withdrawal_id uuid NOT NULL REFERENCES sports_management.team_withdrawals,
 is_approved boolean NOT NULL, user_id uuid NOT NULL REFERENCES sports_management.users,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.withdrawal_match_effects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 withdrawal_id uuid NOT NULL REFERENCES sports_management.team_withdrawals, match_id uuid NOT NULL REFERENCES sports_management.matches,
 action text NOT NULL CHECK(action IN ('VOID','DEFAULT','RESTORE')),
 previous_values jsonb NOT NULL, new_values jsonb NOT NULL, UNIQUE(withdrawal_id,match_id)
);

-- 8. Cobros recurrentes y payments parciales (RF12).
CREATE TABLE sports_management.charge_concepts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE, name text NOT NULL
);
INSERT INTO sports_management.charge_concepts(code,name) VALUES ('REGISTRATION','Inscripcion'),('REFEREE_FEE','Arbitraje'),('VENUE','Cancha'),('FINE','Multa');
CREATE TABLE sports_management.billing_plans (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 club_id uuid REFERENCES sports_management.clubs, season_team_id uuid REFERENCES sports_management.season_teams,
 charge_concept_id uuid NOT NULL REFERENCES sports_management.charge_concepts, amount numeric(12,2) NOT NULL CHECK(amount>0),
 frequency text NOT NULL CHECK(frequency IN ('ONCE','WEEKLY')), starts_at date NOT NULL, ends_at date,
 created_by uuid NOT NULL REFERENCES sports_management.users, CHECK(num_nonnulls(club_id,season_team_id)=1),
 CHECK(ends_at IS NULL OR ends_at>=starts_at)
);
CREATE TABLE sports_management.charges (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 club_id uuid REFERENCES sports_management.clubs, season_team_id uuid,
 charge_concept_id uuid NOT NULL REFERENCES sports_management.charge_concepts, amount numeric(12,2) NOT NULL CHECK(amount>0),
 currency char(3) NOT NULL DEFAULT 'MXN' CHECK(currency='MXN'),
 issued_on date NOT NULL, due_on date NOT NULL, period_start_date date NOT NULL, period_end_date date NOT NULL,
 billing_plan_id uuid REFERENCES sports_management.billing_plans, sanction_id uuid UNIQUE REFERENCES sports_management.sanctions,
 created_by uuid NOT NULL REFERENCES sports_management.users, voided_at timestamptz, void_reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 FOREIGN KEY(season_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 FOREIGN KEY(club_id,season_id) REFERENCES sports_management.club_affiliations(club_id,season_id),
 CHECK(num_nonnulls(club_id,season_team_id)=1), CHECK(due_on>=issued_on), CHECK(period_end_date>=period_start_date),
 CHECK(voided_at IS NULL OR void_reason IS NOT NULL), UNIQUE(billing_plan_id,period_start_date)
);
CREATE TABLE sports_management.payments (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, charge_id uuid NOT NULL REFERENCES sports_management.charges,
 reference_number text NOT NULL UNIQUE, amount numeric(12,2) NOT NULL CHECK(amount>0), paid_at timestamptz NOT NULL,
 method text NOT NULL CHECK(method IN ('CASH','TRANSFER','OTHER')),
 receipt_file_id uuid REFERENCES sports_management.files, recorded_by uuid NOT NULL REFERENCES sports_management.users,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.payment_voids (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payment_id uuid NOT NULL UNIQUE REFERENCES sports_management.payments, reason text NOT NULL,
 authorized_by uuid NOT NULL REFERENCES sports_management.users, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW sports_management.charge_balances AS
 SELECT c.id,c.season_id,c.club_id,c.season_team_id,c.amount,c.due_on,
 COALESCE(sum(p.amount) FILTER(WHERE a.payment_id IS NULL),0) AS paid_amount,
 c.amount-COALESCE(sum(p.amount) FILTER(WHERE a.payment_id IS NULL),0) AS balance
 FROM sports_management.charges c LEFT JOIN sports_management.payments p ON p.charge_id=c.id LEFT JOIN sports_management.payment_voids a ON a.payment_id=p.id
 WHERE c.voided_at IS NULL GROUP BY c.id;

-- 9. Tablas historicas, ascensos y fases eliminatorias (RF07, RF15).
CREATE TABLE sports_management.standing_versions (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 group_id uuid NOT NULL, matchday_id uuid NOT NULL, competition_rule_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0),
 status text NOT NULL DEFAULT 'CALCULATED' CHECK(status IN ('CALCULATED','VALIDATED')),
 validated_by uuid REFERENCES sports_management.users, calculated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,season_id) REFERENCES sports_management.groups(id,season_id),
 FOREIGN KEY(matchday_id,season_id) REFERENCES sports_management.matchdays(id,season_id),
 FOREIGN KEY(competition_rule_id,season_id) REFERENCES sports_management.competition_rules(id,season_id),
 UNIQUE(group_id,matchday_id,version_number), UNIQUE(id,group_id,season_id),
 CHECK(status<>'VALIDATED' OR validated_by IS NOT NULL)
);
CREATE TABLE sports_management.standing_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 standing_version_id uuid NOT NULL, group_id uuid NOT NULL, season_id uuid NOT NULL,
 season_team_id uuid NOT NULL, rank integer NOT NULL CHECK(rank>0),
 played integer NOT NULL CHECK(played>=0), won integer NOT NULL CHECK(won>=0),
 drawn integer NOT NULL CHECK(drawn>=0), lost integer NOT NULL CHECK(lost>=0),
 score_for integer NOT NULL CHECK(score_for>=0), score_against integer NOT NULL CHECK(score_against>=0),
 score_difference integer GENERATED ALWAYS AS(score_for-score_against) STORED, points numeric(10,2) NOT NULL,
 points_adjustment numeric(10,2) NOT NULL DEFAULT 0,
 UNIQUE(standing_version_id,season_team_id), UNIQUE(standing_version_id,rank), CHECK(played=won+drawn+lost),
 FOREIGN KEY(standing_version_id,group_id,season_id) REFERENCES sports_management.standing_versions(id,group_id,season_id),
 FOREIGN KEY(season_team_id,group_id,season_id) REFERENCES sports_management.season_teams(id,group_id,season_id)
);
CREATE TABLE sports_management.promotion_relegation_proposals (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 competition_rule_id uuid NOT NULL, season_team_id uuid NOT NULL,
 target_category_id uuid NOT NULL REFERENCES sports_management.categories,
 type text NOT NULL CHECK(type IN ('PROMOTION','RELEGATION')),
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','APPROVED','REJECTED','APPLIED')),
 justification text NOT NULL, approved_by uuid REFERENCES sports_management.users, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(competition_rule_id,season_id) REFERENCES sports_management.competition_rules(id,season_id),
 FOREIGN KEY(season_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id)
);
CREATE TABLE sports_management.competition_stages (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL,
 season_category_id uuid NOT NULL, name text NOT NULL, sort_order integer NOT NULL CHECK(sort_order>0),
 format jsonb NOT NULL, competition_rule_id uuid NOT NULL,
 FOREIGN KEY(season_category_id,season_id) REFERENCES sports_management.season_categories(id,season_id),
 FOREIGN KEY(competition_rule_id,season_id) REFERENCES sports_management.competition_rules(id,season_id),
 UNIQUE(id,season_id), UNIQUE(season_category_id,sort_order)
);
ALTER TABLE sports_management.matches ADD COLUMN stage_id uuid;
ALTER TABLE sports_management.matches ADD CONSTRAINT matches_stage_fk
 FOREIGN KEY(stage_id,season_id) REFERENCES sports_management.competition_stages(id,season_id);
CREATE FUNCTION sports_management.validate_match_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE home_category uuid; away_category uuid; stage_category uuid;
BEGIN
 IF NEW.stage_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM sports_management.season_teams WHERE id IN (NEW.home_team_id,NEW.away_team_id) AND group_id<>NEW.group_id) THEN
   RAISE EXCEPTION 'En fase regular ambos teams deben pertenecer al grupo del partido';
  END IF;
 ELSE
  SELECT g.season_category_id INTO home_category FROM sports_management.season_teams e JOIN sports_management.groups g ON g.id=e.group_id WHERE e.id=NEW.home_team_id;
  SELECT g.season_category_id INTO away_category FROM sports_management.season_teams e JOIN sports_management.groups g ON g.id=e.group_id WHERE e.id=NEW.away_team_id;
  SELECT season_category_id INTO stage_category FROM sports_management.competition_stages WHERE id=NEW.stage_id;
  IF home_category<>away_category OR home_category<>stage_category THEN
   RAISE EXCEPTION 'La liguilla debe usar teams de la category de su fase';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_group BEFORE INSERT OR UPDATE ON sports_management.matches FOR EACH ROW EXECUTE FUNCTION sports_management.validate_match_group();
CREATE TABLE sports_management.brackets (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, stage_id uuid NOT NULL,
 season_id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
 team_a_id uuid, team_b_id uuid, winner_id uuid,
 next_bracket_id uuid REFERENCES sports_management.brackets, next_slot integer CHECK(next_slot IN (1,2)),
 FOREIGN KEY(stage_id,season_id) REFERENCES sports_management.competition_stages(id,season_id),
 FOREIGN KEY(team_a_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 FOREIGN KEY(team_b_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 FOREIGN KEY(winner_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 UNIQUE(stage_id,number), CHECK(team_a_id IS NULL OR team_b_id IS NULL OR team_a_id<>team_b_id),
 CHECK(winner_id IS NULL OR winner_id=team_a_id OR winner_id=team_b_id)
);
CREATE TABLE sports_management.bracket_matches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 bracket_id uuid NOT NULL REFERENCES sports_management.brackets, match_id uuid UNIQUE REFERENCES sports_management.matches,
 leg_number integer NOT NULL CHECK(leg_number>0), UNIQUE(bracket_id,leg_number)
);
CREATE TABLE sports_management.season_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 season_id uuid NOT NULL, season_category_id uuid NOT NULL,
 season_team_id uuid NOT NULL, title text NOT NULL CHECK(title IN ('CHAMPION','RUNNER_UP')),
 UNIQUE(season_category_id,title),
 FOREIGN KEY(season_category_id,season_id) REFERENCES sports_management.season_categories(id,season_id),
 FOREIGN KEY(season_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id)
);

-- 10. Documentos versionados, news y publications aprobadas (RF13, RF16, RF23).
CREATE TABLE sports_management.document_templates (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 code text NOT NULL, version integer NOT NULL CHECK(version>0), content text NOT NULL,
 UNIQUE(league_id,code,version)
);
CREATE TABLE sports_management.official_documents (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 template_id uuid NOT NULL REFERENCES sports_management.document_templates, reference_number text NOT NULL UNIQUE,
 version integer NOT NULL CHECK(version>0), previous_document_id uuid REFERENCES sports_management.official_documents,
 club_id uuid REFERENCES sports_management.clubs, season_team_id uuid REFERENCES sports_management.season_teams,
 registration_id uuid REFERENCES sports_management.player_registrations, match_id uuid REFERENCES sports_management.matches,
 ruling_id uuid REFERENCES sports_management.disciplinary_rulings, file_id uuid NOT NULL REFERENCES sports_management.files,
 signed_file_id uuid REFERENCES sports_management.files, generated_by uuid NOT NULL REFERENCES sports_management.users,
 created_at timestamptz NOT NULL DEFAULT now(), verification_token_hash text UNIQUE,
 CHECK(num_nonnulls(club_id,season_team_id,registration_id,match_id,ruling_id)=1)
);
CREATE TABLE sports_management.news (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 title text NOT NULL, body text NOT NULL, category text NOT NULL,
 audience text NOT NULL CHECK(audience IN ('PUBLIC','INTERNAL')),
 author_id uuid NOT NULL REFERENCES sports_management.users, effective_from timestamptz NOT NULL DEFAULT now(),
 effective_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_until IS NULL OR effective_until>effective_from)
);
CREATE TABLE sports_management.news_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 news_id uuid NOT NULL REFERENCES sports_management.news, file_id uuid NOT NULL REFERENCES sports_management.files, UNIQUE(news_id,file_id)
);
-- Una publicacion guarda una VERSION de la informacion, no lee tablas privadas
-- en vivo. Una correccion posterior exige revisar y publicar otra version.
CREATE TABLE sports_management.publications (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 season_id uuid REFERENCES sports_management.seasons, type text NOT NULL
 CHECK(type IN ('SCHEDULE','RESULTS','STANDINGS','SANCTIONS','NEWS','COMPETITION')),
 match_id uuid REFERENCES sports_management.matches, standing_version_id uuid REFERENCES sports_management.standing_versions,
 sanction_id uuid REFERENCES sports_management.sanctions, news_id uuid REFERENCES sports_management.news,
 matchday_id uuid REFERENCES sports_management.matchdays,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','PUBLISHED','WITHDRAWN')),
 -- SOLO datos aprobados para exposicion publica; nunca CURP, address o disciplinary_cases.
 public_data jsonb NOT NULL, created_by uuid NOT NULL REFERENCES sports_management.users,
 reviewed_by uuid REFERENCES sports_management.users, published_by uuid REFERENCES sports_management.users,
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(match_id,standing_version_id,sanction_id,news_id,matchday_id)<=1),
 CHECK(status<>'PUBLISHED' OR (reviewed_by IS NOT NULL AND published_by IS NOT NULL
 AND published_at IS NOT NULL AND published_by<>created_by))
);
CREATE VIEW sports_management.public_portal_publications AS
 SELECT id,league_id,season_id,type,public_data,published_at
 FROM sports_management.publications WHERE status='PUBLISHED';
REVOKE ALL ON sports_management.public_portal_publications FROM PUBLIC;
COMMENT ON VIEW public_portal_publications IS 'Conceder SELECT solo al usuario del portal. El backend valida lista blanca de campos JSON y audience/vigencia de news antes de publicar.';

-- 11. Notificaciones asincronas e imports (RF20, RF24).
CREATE TABLE sports_management.notification_templates (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, league_id uuid NOT NULL REFERENCES sports_management.leagues,
 code text NOT NULL, version integer NOT NULL CHECK(version>0), subject text NOT NULL, body text NOT NULL,
 UNIQUE(league_id,code,version)
);
CREATE TABLE sports_management.notifications (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL REFERENCES sports_management.users,
 template_id uuid NOT NULL REFERENCES sports_management.notification_templates, idempotency_key text NOT NULL UNIQUE,
 private_data jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','FAILED')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sports_management.notification_attempts (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, notification_id uuid NOT NULL REFERENCES sports_management.notifications,
 number integer NOT NULL CHECK(number>0), status text NOT NULL CHECK(status IN ('SENT','FAILED')),
 error_code text, provider_reference text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(notification_id,number)
);
CREATE TABLE sports_management.imports (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 file_id uuid NOT NULL REFERENCES sports_management.files, entity text NOT NULL
 CHECK(entity IN ('CLUB','TEAM','PLAYER','VENUE','ARTICLE')),
 status text NOT NULL DEFAULT 'PREVIEW' CHECK(status IN ('PREVIEW','VALIDATED','APPLIED','FAILED')),
 sha256 varchar(64) NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES sports_management.users, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(season_id,entity,sha256)
);
CREATE TABLE sports_management.import_rows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 import_id uuid NOT NULL REFERENCES sports_management.imports, row_number integer NOT NULL CHECK(row_number>0),
 natural_key text, private_data jsonb NOT NULL, errors jsonb NOT NULL DEFAULT '[]',
 is_applied boolean NOT NULL DEFAULT false, UNIQUE(import_id,row_number),
 CHECK(NOT is_applied OR errors='[]'::jsonb)
);

-- 12. Auditoria inmutable, con contexto transaccional (RF19, RNF10).
-- El backend configura en CADA transaccion:
-- SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000001',true);
-- SELECT set_config('app.reason','Correccion autorizada ...',true);
-- No incluir PII en motivos. No usar la conexion propietaria starts_at la aplicacion.
CREATE TABLE sports_management.audit_logs (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid REFERENCES sports_management.users,
 occurred_at timestamptz NOT NULL DEFAULT now(), action text NOT NULL, table_name text NOT NULL,
 entity_id uuid, previous_data jsonb, new_data jsonb, reason text NOT NULL,
 correlation_id text DEFAULT nullif(current_setting('app.correlation_id',true),'')
);
CREATE TABLE sports_management.authentication_events (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid REFERENCES sports_management.users,
 action text NOT NULL CHECK(action IN ('LOGIN_OK','LOGIN_FAILED','LOGOUT','PASSWORD_CHANGED','BLOCK')),
 occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id text
);
CREATE FUNCTION sports_management.prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'El historial % es de solo insercion',TG_TABLE_NAME; END $$;
CREATE FUNCTION sports_management.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path = sports_management, pg_temp AS $$
DECLARE old_data jsonb; new_data jsonb; actor uuid; audit_reason text;
BEGIN
 actor:=nullif(current_setting('app.user_id',true),'')::uuid;
 audit_reason:=nullif(current_setting('app.reason',true),'');
 IF actor IS NULL OR audit_reason IS NULL THEN
  RAISE EXCEPTION 'La operacion en % exige app.user_id y app.reason',TG_TABLE_NAME;
 END IF;
 IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_data:=to_jsonb(NEW); END IF;
 -- Se auditan entidades operativas; people/files/tokens NO tienen este trigger.
 INSERT INTO sports_management.audit_logs(user_id,action,table_name,entity_id,previous_data,new_data,reason)
 VALUES(actor,TG_OP,TG_TABLE_NAME,COALESCE(new_data->>'id',old_data->>'id')::uuid,old_data,new_data,audit_reason);
 RETURN COALESCE(NEW,OLD);
END $$;
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['audit_logs','authentication_events','player_status_history','match_status_history',
 'disciplinary_rulings','sanctions','sanction_fulfillments','appeals','appeal_decisions',
 'team_withdrawals','withdrawal_decisions','withdrawal_match_effects','match_report_corrections','payments','payment_voids',
 'club_team_changes','notification_attempts'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON sports_management.%I FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_history_mutation()',table_name);
  EXECUTE format('CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON sports_management.%I FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation()',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['matches','match_results','disciplinary_cases','disciplinary_rulings','sanctions','team_withdrawals',
 'withdrawal_decisions','appeal_decisions','charges','payments','payment_voids','user_roles','role_permissions',
 'publications','promotion_relegation_proposals','imports','competition_rules','competition_rule_parameters'] LOOP
  EXECUTE format('CREATE TRIGGER record_audit AFTER INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change()',table_name);
 END LOOP;
END $$;

-- Temporadas cerradas: bloqueo de escrituras en tablas con season_id.
-- Una correccion requiere una autorizacion persistida; autorizar starts_at un
-- servicio administrativo separado, con authorization_id explicitamente comprobado.
CREATE TABLE sports_management.correction_authorizations (
 id uuid DEFAULT gen_random_uuid() PRIMARY KEY, season_id uuid NOT NULL REFERENCES sports_management.seasons,
 user_id uuid NOT NULL REFERENCES sports_management.users, authorized_by uuid NOT NULL REFERENCES sports_management.users,
 reason text NOT NULL, document_file_id uuid NOT NULL REFERENCES sports_management.files,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>created_at)
);
CREATE FUNCTION sports_management.protect_closed_season() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_id uuid; new_id uuid; tid uuid; is_closed boolean; authorization_id uuid;
BEGIN
 IF TG_TABLE_NAME='seasons' THEN
  IF TG_OP<>'INSERT' THEN previous_id:=OLD.id; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN previous_id:=OLD.season_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.season_id; END IF;
 END IF;
 FOREACH tid IN ARRAY ARRAY[previous_id,new_id] LOOP
  IF tid IS NULL THEN CONTINUE; END IF;
  SELECT status='CLOSED' INTO is_closed FROM sports_management.seasons WHERE id=tid FOR SHARE;
  IF is_closed THEN
   authorization_id:=nullif(current_setting('app.correction_id',true),'')::uuid;
   IF NOT EXISTS(SELECT 1 FROM sports_management.correction_authorizations a WHERE a.id=authorization_id
     AND a.season_id=tid AND a.user_id=nullif(current_setting('app.user_id',true),'')::uuid
     AND a.expires_at>now()) OR nullif(current_setting('app.reason',true),'') IS NULL THEN
    RAISE EXCEPTION 'Temporada % is_closed; se requiere autorizacion de correccion',tid;
   END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['seasons','competition_rules','season_categories','groups','matchdays','season_breaks',
 'club_affiliations','season_teams','player_registrations','club_team_changes','venue_loans','matches',
 'team_byes','club_season_referees','disciplinary_cases','billing_plans','charges','standing_versions','standing_entries',
 'promotion_relegation_proposals','competition_stages','brackets','season_awards','official_documents','imports',
 'schedule_proposals','publications'] LOOP
 EXECUTE format('CREATE TRIGGER season_read_only BEFORE INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH ROW EXECUTE FUNCTION sports_management.protect_closed_season()',table_name);
 END LOOP;
END $$;
CREATE TRIGGER audit_season AFTER UPDATE OR DELETE ON sports_management.seasons FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();

-- Los registros dependientes sin season_id tambien quedan protegidos.
CREATE FUNCTION sports_management.protect_closed_season_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('competition_rule_parameters','competition_rule_id','competition_rules'),
 ('regulation_articles','competition_rule_id','competition_rules'),
 ('document_requirements','season_category_id','season_categories'),
 ('club_officers','affiliation_id','club_affiliations'),
 ('player_documents','registration_id','player_registrations'),
 ('guardian_consents','registration_id','player_registrations'),
 ('player_status_history','registration_id','player_registrations'),
 ('home_venue_assignments','season_team_id','season_teams'),
 ('referee_assignments','match_id','matches'),('match_reports','match_id','matches'),
 ('match_results','match_id','matches'),('match_status_history','match_id','matches'),
 ('disciplinary_rulings','case_id','disciplinary_cases'),('case_evidence','case_id','disciplinary_cases'),
 ('payments','charge_id','charges'),('import_rows','import_id','imports'),
 ('bracket_matches','match_id','matches')) AS t(table_name,parameter_key,parent_table) LOOP
 EXECUTE format('CREATE TRIGGER dependency_read_only BEFORE INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH ROW EXECUTE FUNCTION sports_management.protect_closed_season_dependency(%L,%L)',r.table_name,r.parameter_key,r.parent_table);
 END LOOP;
END $$;

-- Resolver dependencias de varios niveles (evento -> cedula -> partido, etc.).
CREATE FUNCTION sports_management.get_entity_season(table_name text, entity uuid) RETURNS uuid
 LANGUAGE plpgsql STABLE AS $$
DECLARE tid uuid; parent_table text; parameter_key text; pid uuid;
BEGIN
 IF entity IS NULL THEN RETURN NULL; END IF;
 IF table_name IN ('competition_rules','season_categories','club_affiliations','season_teams',
 'player_registrations','matches','disciplinary_cases','charges','standing_versions','imports','brackets') THEN
  EXECUTE format('SELECT season_id FROM sports_management.%I WHERE id=$1',table_name) INTO tid USING entity;
  RETURN tid;
 END IF;
 SELECT t.p,t.c INTO parent_table,parameter_key FROM (VALUES
 ('match_reports','matches','match_id'),('lineups','match_reports','match_report_id'),
 ('match_events','match_reports','match_report_id'),('disciplinary_rulings','disciplinary_cases','case_id'),
 ('sanctions','disciplinary_rulings','ruling_id'),('appeals','disciplinary_rulings','ruling_id'),
 ('payments','charges','charge_id'),('team_withdrawals','season_teams','season_team_id')) t(n,p,c) WHERE t.n=table_name;
 IF parent_table IS NULL THEN RAISE EXCEPTION 'Dependencia no configurada: %',table_name; END IF;
 EXECUTE format('SELECT %I FROM sports_management.%I WHERE id=$1',parameter_key,table_name) INTO pid USING entity;
 RETURN sports_management.get_entity_season(parent_table,pid);
END $$;
CREATE OR REPLACE FUNCTION sports_management.protect_closed_season_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; old_data jsonb; tid uuid; parameter_value text; is_closed boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN row_data:=to_jsonb(NEW); END IF;
 FOREACH parameter_value IN ARRAY ARRAY[old_data->>TG_ARGV[0],row_data->>TG_ARGV[0]] LOOP
  IF parameter_value IS NULL THEN CONTINUE; END IF;
  tid:=sports_management.get_entity_season(TG_ARGV[1],parameter_value::uuid);
  SELECT status='CLOSED' INTO is_closed FROM sports_management.seasons WHERE id=tid FOR SHARE;
  IF is_closed AND (NOT EXISTS(SELECT 1 FROM sports_management.correction_authorizations a
    WHERE a.id=nullif(current_setting('app.correction_id',true),'')::uuid
    AND a.season_id=tid AND a.user_id=nullif(current_setting('app.user_id',true),'')::uuid
    AND a.expires_at>now()) OR nullif(current_setting('app.reason',true),'') IS NULL) THEN
   RAISE EXCEPTION 'Dependencia de temporada % is_closed',tid;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('lineups','match_report_id','match_reports'),('match_events','match_report_id','match_reports'),
 ('player_period_participations','lineup_id','lineups'),
 ('match_report_corrections','match_report_id','match_reports'),('match_report_syncs','match_report_id','match_reports'),
 ('sanctions','ruling_id','disciplinary_rulings'),('sanction_fulfillments','sanction_id','sanctions'),
 ('appeals','ruling_id','disciplinary_rulings'),('appeal_evidence','appeal_id','appeals'),
 ('appeal_decisions','appeal_id','appeals'),('team_withdrawals','season_team_id','season_teams'),
 ('withdrawal_decisions','withdrawal_id','team_withdrawals'),('withdrawal_match_effects','withdrawal_id','team_withdrawals'),
 ('payment_voids','payment_id','payments')) AS t(table_name,parameter_key,parent_table) LOOP
 EXECUTE format('CREATE TRIGGER dependency_read_only BEFORE INSERT OR UPDATE OR DELETE ON sports_management.%I FOR EACH ROW EXECUTE FUNCTION sports_management.protect_closed_season_dependency(%L,%L)',r.table_name,r.parameter_key,r.parent_table);
 END LOOP;
END $$;

-- No borrar fisicamente matches con historial.
CREATE FUNCTION sports_management.prevent_match_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Los matches usan borrado logico (deleted_at)'; END $$;
CREATE TRIGGER no_delete_match BEFORE DELETE ON sports_management.matches FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_match_deletion();

-- Las reglas aprobadas se versionan; no se cambian en el lugar.
CREATE FUNCTION sports_management.protect_approved_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid;
BEGIN
 IF TG_TABLE_NAME='competition_rules' THEN cid:=OLD.id;
 ELSE
  IF TG_OP<>'INSERT' THEN cid:=OLD.competition_rule_id;
   IF EXISTS(SELECT 1 FROM sports_management.competition_rules WHERE id=cid AND status='APPROVED') THEN
    RAISE EXCEPTION 'Convocatoria aprobada: crear nueva version de reglas';
   END IF;
  END IF;
  IF TG_OP<>'DELETE' THEN cid:=NEW.competition_rule_id; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM sports_management.competition_rules WHERE id=cid AND status='APPROVED') THEN
  RAISE EXCEPTION 'Convocatoria aprobada: crear nueva version de reglas';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER versioned_rules BEFORE UPDATE OR DELETE ON sports_management.competition_rules FOR EACH ROW EXECUTE FUNCTION sports_management.protect_approved_rules();
CREATE TRIGGER versioned_parameters BEFORE INSERT OR UPDATE OR DELETE ON sports_management.competition_rule_parameters FOR EACH ROW EXECUTE FUNCTION sports_management.protect_approved_rules();
CREATE TRIGGER versioned_articles BEFORE INSERT OR UPDATE OR DELETE ON sports_management.regulation_articles FOR EACH ROW EXECUTE FUNCTION sports_management.protect_approved_rules();

-- CURP obligatoria, ventana de altas y permanencia de equipo tras iniciar torneo.
CREATE FUNCTION sports_management.validate_player_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_team uuid; tournament_start timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sports_management.people WHERE id=NEW.person_id AND curp IS NOT NULL) THEN
  RAISE EXCEPTION 'El jugador requiere CURP y paid_at de nacimiento';
 END IF;
 IF TG_OP='INSERT' THEN
  IF extract(isodow FROM now() AT TIME ZONE 'America/Mexico_City') NOT BETWEEN 1 AND 3 THEN
   RAISE EXCEPTION 'Las altas solo se permiten lunes a miercoles (America/Mexico_City)';
  END IF;
  SELECT competition_starts_at INTO tournament_start FROM sports_management.seasons WHERE id=NEW.season_id;
  IF tournament_start IS NOT NULL AND now()>=tournament_start AND EXISTS(
   SELECT 1 FROM sports_management.player_registrations i WHERE i.person_id=NEW.person_id
   AND i.season_id=NEW.season_id AND i.season_team_id<>NEW.season_team_id) THEN
   RAISE EXCEPTION 'No se permite cambiar equipo una vez iniciada la competencia';
  END IF;
 ELSE
  IF NEW.person_id<>OLD.person_id OR NEW.season_id<>OLD.season_id OR NEW.season_team_id<>OLD.season_team_id THEN
   RAISE EXCEPTION 'La identidad y pertenencia de una inscripcion no se reescriben; gestionar baja y nueva alta';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_player BEFORE INSERT OR UPDATE ON sports_management.player_registrations FOR EACH ROW EXECUTE FUNCTION sports_management.validate_player_registration();

-- Indices para relaciones y filtros frecuentes. Se generan para TODAS las FK
-- que no tienen ya un indice cuyo prefijo cubra sus column_names.
DO $$ DECLARE r record; BEGIN
 FOR r IN
  SELECT c.conrelid::regclass AS table_name,c.conname,
    string_agg(quote_ident(a.attname),',' ORDER BY k.ord) AS column_names
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
  JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.contype='f' AND c.connamespace='sports_management'::regnamespace
   AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid
      AND i.indpred IS NULL AND ARRAY(SELECT unnest((i.indkey::smallint[])[0:cardinality(c.conkey)-1]))=c.conkey)
  GROUP BY c.conrelid,c.conname
 LOOP
  EXECUTE format('CREATE INDEX %I ON %s (%s)','fk_'||r.conname,r.table_name,r.column_names);
 END LOOP;
END $$;
CREATE INDEX matches_date ON sports_management.matches(season_id,starts_at);
CREATE INDEX venue_availability_date ON sports_management.venue_availability(venue_id,starts_at,ends_at);
CREATE INDEX audit_logs_date ON sports_management.audit_logs(occurred_at DESC);
CREATE INDEX audit_logs_entity ON sports_management.audit_logs(table_name,entity_id,occurred_at DESC);
CREATE INDEX pending_notifications ON sports_management.notifications(next_attempt_at) WHERE status IN ('PENDING','FAILED');
CREATE INDEX portal_publications ON sports_management.publications(league_id,type,published_at DESC) WHERE status='PUBLISHED';
CREATE INDEX sanctions_effective_dates ON sports_management.sanctions(starts_at,ends_at);

-- Las funciones de trigger resuelven siempre tablas del esquema sports_management,
-- aunque Prisma/pgAdmin use un search_path diferente.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
 WHERE p.pronamespace='sports_management'::regnamespace LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path = sports_management, pg_temp',f.signature);
 END LOOP;
END $$;

-- Proteccion por defecto: conceder privilegios explicitos a roles SQL de
-- despliegue distintos del propietario. Los roles del ERS NO son roles SQL.
REVOKE ALL ON ALL TABLES IN SCHEMA sports_management FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sports_management FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA sports_management FROM PUBLIC;
COMMENT ON SCHEMA sports_management IS 'ERS octubre 2026. Backend: RBAC por contexto, motores transaccionales, lista blanca publica y migraciones Prisma; privilegios de despliegue separados.';
COMMIT;
