BEGIN;

-- Una inscripción de origen sigue siendo única. No se toca unique_player_per_season.
CREATE TABLE sports_management.player_category_levels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 season_category_id uuid NOT NULL UNIQUE,
 season_id uuid NOT NULL,
 pathway_code varchar(40) NOT NULL CHECK(pathway_code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
 level integer NOT NULL CHECK(level>0),
 configured_by uuid NOT NULL,
 configured_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT player_level_category_fk FOREIGN KEY(season_category_id,season_id) REFERENCES sports_management.season_categories(id,season_id),
 CONSTRAINT player_level_actor_fk FOREIGN KEY(configured_by) REFERENCES sports_management.users(id),
 CONSTRAINT player_level_category_season_key UNIQUE(season_category_id,season_id),
 CONSTRAINT player_level_pathway_key UNIQUE(season_id,pathway_code,level)
);
CREATE INDEX player_level_actor_idx ON sports_management.player_category_levels(configured_by);

CREATE TABLE sports_management.player_category_participations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 origin_registration_id uuid NOT NULL,
 season_id uuid NOT NULL,
 club_id uuid NOT NULL,
 target_season_team_id uuid NOT NULL,
 target_season_category_id uuid NOT NULL,
 requested_by uuid NOT NULL,
 request_key uuid NOT NULL,
 request_hash varchar(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'PENDING_ELIGIBILITY' CHECK(status='PENDING_ELIGIBILITY'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT player_participation_origin_fk FOREIGN KEY(origin_registration_id,season_id) REFERENCES sports_management.player_registrations(id,season_id),
 CONSTRAINT player_participation_team_fk FOREIGN KEY(target_season_team_id,season_id) REFERENCES sports_management.season_teams(id,season_id),
 CONSTRAINT player_participation_level_fk FOREIGN KEY(target_season_category_id,season_id) REFERENCES sports_management.player_category_levels(season_category_id,season_id),
 CONSTRAINT player_participation_club_fk FOREIGN KEY(club_id) REFERENCES sports_management.clubs(id),
 CONSTRAINT player_participation_actor_fk FOREIGN KEY(requested_by) REFERENCES sports_management.users(id),
 CONSTRAINT player_participation_category_key UNIQUE(origin_registration_id,target_season_category_id),
 CONSTRAINT player_participation_operation_key UNIQUE(requested_by,request_key)
);
CREATE INDEX player_participation_origin_idx ON sports_management.player_category_participations(origin_registration_id,season_id);
CREATE INDEX player_participation_team_idx ON sports_management.player_category_participations(target_season_team_id,season_id);
CREATE INDEX player_participation_level_idx ON sports_management.player_category_participations(target_season_category_id,season_id);
CREATE INDEX player_participation_club_idx ON sports_management.player_category_participations(club_id);

-- El servicio y el trigger comparten el reloj transaccional de PostgreSQL.
CREATE FUNCTION sports_management.player_participation_now() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS 'SELECT now()';
REVOKE ALL ON FUNCTION sports_management.player_participation_now() FROM PUBLIC;

CREATE FUNCTION sports_management.guard_player_category_level() RETURNS trigger
LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE category_kind text; season_state text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PLAYER_LEVEL_IMMUTABLE'; END IF;
 SELECT sc.type,s.status INTO category_kind,season_state FROM season_categories sc
 JOIN seasons s ON s.id=sc.season_id WHERE sc.id=NEW.season_category_id AND sc.season_id=NEW.season_id FOR SHARE OF sc,s;
 IF NOT FOUND OR season_state<>'PLANNED' THEN RAISE EXCEPTION 'PLAYER_LEVEL_CONTEXT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('player-pathway:'||NEW.season_id::text,0));
 IF EXISTS(SELECT 1 FROM player_category_levels l JOIN season_categories sc ON sc.id=l.season_category_id
   WHERE l.season_id=NEW.season_id AND l.pathway_code=NEW.pathway_code AND sc.type<>category_kind)
 THEN RAISE EXCEPTION 'PLAYER_LEVEL_MIXED_TYPES'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_player_level BEFORE INSERT OR UPDATE OR DELETE ON sports_management.player_category_levels
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_category_level();

CREATE FUNCTION sports_management.guard_configured_player_category() RETURNS trigger
LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
BEGIN
 IF NEW.type IS DISTINCT FROM OLD.type AND EXISTS(SELECT 1 FROM player_category_levels WHERE season_category_id=OLD.id)
 THEN RAISE EXCEPTION 'PLAYER_LEVEL_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_configured_player_category BEFORE UPDATE OF type ON sports_management.season_categories
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_configured_player_category();

CREATE FUNCTION sports_management.guard_player_origin_level() RETURNS trigger
LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
BEGIN
 PERFORM id FROM people WHERE id=NEW.person_id FOR UPDATE;
 IF EXISTS(
  SELECT 1 FROM player_registrations old_origin
  JOIN season_teams old_team ON old_team.id=old_origin.season_team_id
  JOIN groups old_group ON old_group.id=old_team.group_id
  JOIN player_category_levels old_level ON old_level.season_category_id=old_group.season_category_id
  JOIN season_teams new_team ON new_team.id=NEW.season_team_id
  JOIN groups new_group ON new_group.id=new_team.group_id
  JOIN player_category_levels new_level ON new_level.season_category_id=new_group.season_category_id
  WHERE old_origin.person_id=NEW.person_id AND old_origin.season_id=NEW.season_id
   AND old_level.pathway_code=new_level.pathway_code AND old_level.level>new_level.level
 ) THEN RAISE EXCEPTION 'PLAYER_ORIGIN_LOWER_CATEGORY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_player_origin_level BEFORE INSERT ON sports_management.player_registrations
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_origin_level();

CREATE FUNCTION sports_management.guard_player_category_participation() RETURNS trigger
LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE origin record; target record; age_value integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_IMMUTABLE'; END IF;
 SELECT pr.season_id,pr.status,pr.withdrawn_at,st.club_id,st.status AS team_status,
   sc.type,sc.minimum_age,sc.maximum_age,sc.age_cutoff_date,sc.eligibility_pending,
   l.pathway_code,l.level,p.birth_date INTO origin
 FROM player_registrations pr JOIN people p ON p.id=pr.person_id JOIN season_teams st ON st.id=pr.season_team_id
 JOIN groups g ON g.id=st.group_id JOIN season_categories sc ON sc.id=g.season_category_id
 JOIN player_category_levels l ON l.season_category_id=sc.id
 WHERE pr.id=NEW.origin_registration_id FOR SHARE OF pr,p,st,sc;
 IF NOT FOUND OR origin.withdrawn_at IS NOT NULL OR origin.status NOT IN ('ACTIVE','INELIGIBLE') OR origin.team_status='WITHDRAWN'
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_CONTEXT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('player-origin:'||NEW.origin_registration_id::text,0));
 SELECT st.club_id,st.season_id,st.status AS team_status,sc.id AS category_id,sc.type,
   sc.minimum_age,sc.maximum_age,sc.age_cutoff_date,sc.eligibility_pending,l.pathway_code,l.level,s.status AS season_status INTO target
 FROM season_teams st JOIN groups g ON g.id=st.group_id JOIN season_categories sc ON sc.id=g.season_category_id
 JOIN seasons s ON s.id=st.season_id JOIN player_category_levels l ON l.season_category_id=sc.id
 WHERE st.id=NEW.target_season_team_id FOR SHARE OF st,sc,s;
 IF NOT FOUND OR target.team_status='WITHDRAWN' OR target.season_status='CLOSED' OR
   origin.season_id<>NEW.season_id OR target.season_id<>NEW.season_id OR origin.club_id<>NEW.club_id OR target.club_id<>NEW.club_id OR
   target.category_id<>NEW.target_season_category_id OR target.type<>origin.type OR target.pathway_code<>origin.pathway_code OR target.level<>origin.level+1
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_CONTEXT'; END IF;
 IF origin.birth_date IS NULL OR origin.eligibility_pending OR target.eligibility_pending OR
   origin.minimum_age IS NULL OR target.minimum_age IS NULL OR origin.age_cutoff_date IS NULL OR target.age_cutoff_date IS NULL
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_POLICY'; END IF;
 age_value:=extract(year FROM origin.age_cutoff_date)-extract(year FROM origin.birth_date);
 IF age_value<origin.minimum_age OR (origin.maximum_age IS NOT NULL AND age_value>origin.maximum_age)
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_AGE'; END IF;
 age_value:=extract(year FROM target.age_cutoff_date)-extract(year FROM origin.birth_date);
 IF age_value<target.minimum_age OR (target.maximum_age IS NOT NULL AND age_value>target.maximum_age)
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_AGE'; END IF;
 IF extract(isodow FROM player_participation_now() AT TIME ZONE 'America/Mexico_City') NOT BETWEEN 1 AND 3
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_WINDOW'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_player_participation BEFORE INSERT OR UPDATE OR DELETE ON sports_management.player_category_participations
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_category_participation();

CREATE TRIGGER record_audit AFTER INSERT ON sports_management.player_category_levels FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
CREATE TRIGGER record_audit AFTER INSERT ON sports_management.player_category_participations FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
CREATE TRIGGER no_truncate_player_levels BEFORE TRUNCATE ON sports_management.player_category_levels FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE TRIGGER no_truncate_player_participations BEFORE TRUNCATE ON sports_management.player_category_participations FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();
REVOKE ALL ON FUNCTION sports_management.guard_player_category_level(),sports_management.guard_configured_player_category(),sports_management.guard_player_origin_level(),sports_management.guard_player_category_participation() FROM PUBLIC;
REVOKE ALL ON sports_management.player_category_levels,sports_management.player_category_participations FROM PUBLIC;
DO $security$ DECLARE api_role text; BEGIN
 IF to_regnamespace('auth') IS NOT NULL AND to_regnamespace('storage') IS NOT NULL THEN
  ALTER TABLE sports_management.player_category_levels ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sports_management.player_category_participations ENABLE ROW LEVEL SECURITY;
 END IF;
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON sports_management.player_category_levels,sports_management.player_category_participations FROM %I',api_role);
  END IF;
 END LOOP;
END $security$;
-- Sin backfill, sin políticas públicas y sin autorizar despliegue a Supabase.
COMMIT;
