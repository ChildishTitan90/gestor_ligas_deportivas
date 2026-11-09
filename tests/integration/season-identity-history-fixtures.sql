-- Datos exclusivamente sintéticos; el runner crea su contenedor sin puertos.
CREATE SCHEMA history_test;
-- Reloj sintético solo en el contenedor desechable; conserva el trigger real.
CREATE FUNCTION history_test.now() RETURNS timestamptz LANGUAGE sql STABLE AS
 $$ SELECT '2026-10-26T12:00:00-06:00'::timestamptz $$;
ALTER FUNCTION sports_management.validate_player_registration()
 SET search_path TO history_test,sports_management,pg_catalog,pg_temp;
CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz
 LANGUAGE sql STABLE AS $$ SELECT '2026-10-26T12:00:00-06:00'::timestamptz $$;
INSERT INTO sports_management.people(id,first_name,paternal_surname)
 VALUES ('11700000-0000-4000-8000-000000000001','Actor','Sintetico');
INSERT INTO sports_management.users(id,person_id,username,email,password_hash)
 VALUES ('11700000-0000-4000-8000-000000000002','11700000-0000-4000-8000-000000000001',
 'history_synthetic','history@example.test','SYNTHETIC_NOT_A_LOGIN_HASH');
SELECT set_config('app.user_id','11700000-0000-4000-8000-000000000002',false),
 set_config('app.reason','Prueba sintetica aislada de historial',false);
CREATE TABLE history_test.cases(name text PRIMARY KEY,season_id uuid,person_id uuid,registration_id uuid);
CREATE FUNCTION history_test.fixture(case_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l uuid; c uuid; s uuid; sp uuid; p uuid; af uuid; ca uuid; cr uuid; sc uuid; g uuid; t uuid; st uuid; pr uuid; f uuid; guardian uuid; referee uuid;
BEGIN
 SELECT id INTO sp FROM sports_management.sports WHERE code='SOCCER';
 INSERT INTO sports_management.leagues(name) VALUES ('Sintetica '||case_name) RETURNING id INTO l;
 INSERT INTO sports_management.clubs(league_id,name,reference_number) VALUES(l,'Club sintetico',gen_random_uuid()::text) RETURNING id INTO c;
 INSERT INTO sports_management.seasons(league_id,sport_id,name,start_date,end_date)
 VALUES(l,sp,'Edicion sintetica','2026-01-01','2026-12-31') RETURNING id INTO s;
 INSERT INTO sports_management.people(first_name,paternal_surname,birth_date,curp)
 VALUES('Nombre anterior','Sintetico','1990-01-01',
  'SA'||chr(65+(SELECT count(*)::integer FROM history_test.cases))||'A900101HMNLRR00') RETURNING id INTO p;
 INSERT INTO sports_management.club_affiliations(season_id,club_id,league_id,reference_number,uniform_colors,status,requested_by)
 VALUES(s,c,l,gen_random_uuid()::text,'Azul','APPROVED','11700000-0000-4000-8000-000000000002') RETURNING id INTO af;
 INSERT INTO sports_management.club_officers(affiliation_id,person_id,office,starts_at,ends_at)
 VALUES(af,p,'PRESIDENT','2026-01-01','2026-02-01');
 INSERT INTO sports_management.categories(league_id,sport_id,name) VALUES(l,sp,'Abierta') RETURNING id INTO ca;
 INSERT INTO sports_management.competition_rules(season_id,version_number) VALUES(s,1) RETURNING id INTO cr;
 INSERT INTO sports_management.season_categories(season_id,category_id,competition_rule_id,hierarchy_order,type,age_cutoff_date,eligibility_pending,player_policy)
 VALUES(s,ca,cr,1,'OPEN','2026-12-31',false,'{"timezone":"America/Mexico_City","registrationDays":[1,2,3]}'::jsonb) RETURNING id INTO sc;
 INSERT INTO sports_management.groups(season_id,season_category_id,name) VALUES(s,sc,'Grupo') RETURNING id INTO g;
 INSERT INTO sports_management.teams(club_id,reference_number,name) VALUES(c,gen_random_uuid()::text,'Equipo') RETURNING id INTO t;
 INSERT INTO sports_management.season_teams(season_id,team_id,club_id,group_id) VALUES(s,t,c,g) RETURNING id INTO st;
 INSERT INTO sports_management.player_registrations(person_id,season_id,season_team_id,reference_number,status)
 VALUES(p,s,st,gen_random_uuid()::text,'ACTIVE') RETURNING id INTO pr;
 INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Tutor','Sintetico') RETURNING id INTO guardian;
 INSERT INTO sports_management.files(storage_key,original_name,mime_type,size_bytes,uploaded_by)
 VALUES(gen_random_uuid()::text,'sintetico.pdf','application/pdf',1,'11700000-0000-4000-8000-000000000002') RETURNING id INTO f;
 INSERT INTO sports_management.guardian_consents(registration_id,guardian_person_id,relationship,privacy_notice_version,signed_at,document_file_id)
 VALUES(pr,guardian,'Tutor','SYNTHETIC',now(),f);
 INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Arbitro','Sintetico') RETURNING id INTO referee;
 INSERT INTO sports_management.referees(person_id) VALUES(referee) RETURNING id INTO referee;
 INSERT INTO sports_management.club_season_referees(referee_id,season_id,club_id) VALUES(referee,s,c);
 UPDATE sports_management.seasons SET status='ACTIVE' WHERE id=s;
 INSERT INTO history_test.cases VALUES(case_name,s,p,pr);
END $$;
SELECT history_test.fixture('legacy');
UPDATE sports_management.seasons SET status='CLOSED',closed_at=now()
 WHERE id=(SELECT season_id FROM history_test.cases WHERE name='legacy');
