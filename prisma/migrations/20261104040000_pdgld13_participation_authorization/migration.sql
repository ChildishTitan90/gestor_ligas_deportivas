BEGIN;
-- Se conservan las solicitudes, su origen único y las protecciones de inserción.
ALTER TABLE sports_management.player_category_participations
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN eligibility_fingerprint varchar(64),
 ADD COLUMN review_event_id uuid;
ALTER TABLE sports_management.player_category_participations
 DROP CONSTRAINT player_category_participations_status_check,
 ADD CONSTRAINT player_participation_state_check CHECK (
   (status='PENDING_ELIGIBILITY' AND version=1 AND eligibility_fingerprint IS NULL AND review_event_id IS NULL)
   OR (status='AUTHORIZED' AND version>1 AND eligibility_fingerprint IS NOT NULL AND eligibility_fingerprint ~ '^[a-f0-9]{64}$' AND review_event_id IS NOT NULL)
   OR (status='WITHDRAWN' AND version>1 AND eligibility_fingerprint IS NULL AND review_event_id IS NOT NULL)
 );
DROP TRIGGER guard_player_participation ON sports_management.player_category_participations;
CREATE TRIGGER guard_player_participation BEFORE INSERT ON sports_management.player_category_participations
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_category_participation();

CREATE FUNCTION sports_management.guard_player_participation_review() RETURNS trigger
LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE receipt record;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'PENDING_ELIGIBILITY' OR NEW.version<>1 OR NEW.eligibility_fingerprint IS NOT NULL OR NEW.review_event_id IS NOT NULL
   THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_IMMUTABLE'; END IF;
   RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_IMMUTABLE'; END IF;
 IF ROW(NEW.id,NEW.origin_registration_id,NEW.season_id,NEW.club_id,NEW.target_season_team_id,
   NEW.target_season_category_id,NEW.requested_by,NEW.request_key,NEW.request_hash,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.origin_registration_id,OLD.season_id,OLD.club_id,OLD.target_season_team_id,
   OLD.target_season_category_id,OLD.requested_by,OLD.request_key,OLD.request_hash,OLD.created_at)
   OR NEW.version<>OLD.version+1 OR NEW.review_event_id IS NULL
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_IMMUTABLE'; END IF;
 SELECT user_id,new_data,previous_data INTO receipt FROM audit_logs
 WHERE id=NEW.review_event_id AND entity_id=OLD.id AND action='PLAYER_PARTICIPATION_REVIEWED';
 IF NOT FOUND OR receipt.user_id::text IS DISTINCT FROM current_setting('app.user_id',true)
   OR receipt.new_data->>'status' IS DISTINCT FROM NEW.status
   OR receipt.new_data->>'version' IS DISTINCT FROM NEW.version::text
   OR receipt.previous_data->>'version' IS DISTINCT FROM OLD.version::text
   OR receipt.previous_data->>'status' IS DISTINCT FROM OLD.status
   OR receipt.new_data->>'fingerprint' IS DISTINCT FROM NEW.eligibility_fingerprint
 THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_IMMUTABLE'; END IF;
 IF NEW.status NOT IN ('AUTHORIZED','WITHDRAWN') THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_IMMUTABLE'; END IF;
 IF NEW.status='AUTHORIZED' AND NOT EXISTS (
   SELECT 1 FROM player_registrations pr JOIN season_teams st ON st.id=pr.season_team_id
   JOIN seasons s ON s.id=pr.season_id JOIN season_teams target ON target.id=OLD.target_season_team_id
   WHERE pr.id=OLD.origin_registration_id AND pr.status='ACTIVE' AND pr.withdrawn_at IS NULL
    AND st.status<>'WITHDRAWN' AND target.status<>'WITHDRAWN' AND s.status<>'CLOSED'
 ) THEN RAISE EXCEPTION 'PLAYER_PARTICIPATION_CONTEXT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_player_participation_review BEFORE INSERT OR UPDATE OR DELETE ON sports_management.player_category_participations
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_participation_review();
REVOKE ALL ON FUNCTION sports_management.guard_player_participation_review() FROM PUBLIC;
-- Conserva RLS, permisos y denegación de TRUNCATE ya existentes. No habilita CD.
COMMIT;
