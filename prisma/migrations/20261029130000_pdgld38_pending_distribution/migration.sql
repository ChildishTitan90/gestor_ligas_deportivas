BEGIN;
ALTER TABLE sports_management.season_categories DROP CONSTRAINT season_category_format_check,
 ADD CONSTRAINT season_category_format_check CHECK (competition_format IN ('LEGACY_GROUPS','GENERAL_TABLE','GROUP_STAGE'));
ALTER TABLE sports_management.season_teams ADD COLUMN season_category_id uuid,
 ALTER COLUMN group_id DROP NOT NULL;

-- Solo la proyección nueva; no cambia grupos, claves, huellas ni auditoría legada.
-- ACCESS EXCLUSIVE del ALTER impide escrituras concurrentes durante la conversión.
CREATE TEMP TABLE pd38_trigger_state ON COMMIT DROP AS SELECT tgname,tgenabled FROM pg_trigger
 WHERE tgrelid='sports_management.season_teams'::regclass AND tgname IN ('record_enrollment_audit','season_read_only');
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM pd38_trigger_state WHERE tgenabled<>'D' LOOP
  EXECUTE format('ALTER TABLE sports_management.season_teams DISABLE TRIGGER %I',r.tgname);
 END LOOP;
 UPDATE sports_management.season_teams e SET season_category_id=g.season_category_id
 FROM sports_management.groups g WHERE g.id=e.group_id AND g.season_id=e.season_id;
 IF EXISTS(SELECT 1 FROM sports_management.season_teams WHERE season_category_id IS NULL) THEN
  RAISE EXCEPTION 'Inscripción sin categoría verificable; migración revertida';
 END IF;
 FOR r IN SELECT * FROM pd38_trigger_state WHERE tgenabled<>'D' LOOP
  EXECUTE format('ALTER TABLE sports_management.season_teams %s TRIGGER %I',
    CASE r.tgenabled WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END,r.tgname);
 END LOOP;
END $$;
ALTER TABLE sports_management.season_teams
 ADD CONSTRAINT enrollment_category_required CHECK(season_category_id IS NOT NULL),
 ADD CONSTRAINT enrollment_category_season_fk FOREIGN KEY(season_category_id,season_id)
 REFERENCES sports_management.season_categories(id,season_id) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX season_teams_season_category_id_season_id_idx ON sports_management.season_teams(season_category_id,season_id);

CREATE FUNCTION sports_management.enforce_enrollment_distribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_category uuid; mode text;
BEGIN
 IF NEW.group_id IS NOT NULL THEN
  SELECT season_category_id INTO selected_category FROM sports_management.groups
    WHERE id=NEW.group_id AND season_id=NEW.season_id FOR SHARE;
  IF selected_category IS NULL THEN RAISE EXCEPTION 'Grupo de otra temporada' USING ERRCODE='23503'; END IF;
  IF NEW.season_category_id IS NULL THEN NEW.season_category_id:=selected_category; END IF;
  IF NEW.season_category_id<>selected_category THEN RAISE EXCEPTION 'Grupo de otra categoría' USING ERRCODE='23503'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.season_category_id IS DISTINCT FROM OLD.season_category_id
   OR NEW.season_id<>OLD.season_id OR NEW.team_id<>OLD.team_id OR NEW.club_id<>OLD.club_id) THEN
  RAISE EXCEPTION 'La distribución no cambia la identidad ni categoría de inscripción';
 END IF;
 SELECT competition_format INTO mode FROM sports_management.season_categories
   WHERE id=NEW.season_category_id AND season_id=NEW.season_id FOR SHARE;
 IF TG_OP='INSERT' AND mode='GROUP_STAGE' AND NEW.group_id IS NOT NULL THEN RAISE EXCEPTION 'Inscribir primero sin distribución'; END IF;
 IF TG_OP='UPDATE' AND OLD.group_id IS NOT NULL AND NEW.group_id IS DISTINCT FROM OLD.group_id THEN
  RAISE EXCEPTION 'Grupo asignado: conservar historial';
 END IF;
 IF mode IS NULL OR (NEW.group_id IS NULL AND mode<>'GROUP_STAGE') THEN RAISE EXCEPTION 'Distribución pendiente inválida'; END IF;
 IF NEW.group_id IS NULL AND NEW.status<>'REGISTERED' THEN RAISE EXCEPTION 'Sin grupo solo puede estar inscrito'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enrollment_distribution BEFORE INSERT OR UPDATE ON sports_management.season_teams
 FOR EACH ROW EXECUTE FUNCTION sports_management.enforce_enrollment_distribution();

CREATE FUNCTION sports_management.require_assigned_match_teams() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT group_id FROM sports_management.season_teams
  WHERE id IN (NEW.home_team_id,NEW.away_team_id) AND season_id=NEW.season_id FOR SHARE LOOP
  IF r.group_id IS NULL THEN RAISE EXCEPTION 'Distribuir equipos antes de programar un partido'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER assigned_teams_before_match BEFORE INSERT OR UPDATE ON sports_management.matches
 FOR EACH ROW EXECUTE FUNCTION sports_management.require_assigned_match_teams();
CREATE FUNCTION sports_management.protect_distributed_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='season_categories' THEN
  IF NEW.competition_format IS DISTINCT FROM OLD.competition_format AND EXISTS(
    SELECT 1 FROM sports_management.season_teams WHERE season_category_id=OLD.id) THEN
   RAISE EXCEPTION 'Formato con inscripciones: conservar historia';
  END IF;
 ELSE
  IF NEW.season_category_id IS DISTINCT FROM OLD.season_category_id AND EXISTS(
    SELECT 1 FROM sports_management.season_teams WHERE group_id=OLD.id) THEN
   RAISE EXCEPTION 'Grupo con inscripciones: conservar categoría';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER distribution_category_history BEFORE UPDATE ON sports_management.season_categories
 FOR EACH ROW EXECUTE FUNCTION sports_management.protect_distributed_category();
CREATE TRIGGER distribution_group_history BEFORE UPDATE ON sports_management.groups
 FOR EACH ROW EXECUTE FUNCTION sports_management.protect_distributed_category();
COMMIT;
