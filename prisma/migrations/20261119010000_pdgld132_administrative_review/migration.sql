BEGIN;

INSERT INTO sports_management.match_status_transitions(from_status_id,to_status_id,role_id)
SELECT f.id,t.id,r.id FROM sports_management.match_statuses f
CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
WHERE f.code='SUSPENDED' AND t.code='UNDER_REVIEW' AND r.code='DISCIPLINARY_BOARD'
ON CONFLICT (from_status_id,to_status_id,role_id) DO NOTHING;

-- La revisión conserva la situación de reserva que tenía el partido: no vuelve
-- a ocupar la cancha que se liberó al suspenderlo, incluso en actualizaciones posteriores.
CREATE OR REPLACE FUNCTION sports_management.sync_match_reservations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, sports_management AS $$
DECLARE is_reserved boolean;
BEGIN
 SELECT reserves_resources INTO is_reserved FROM sports_management.match_statuses WHERE id=NEW.status_id;
 IF TG_OP='UPDATE' AND sports_management.get_match_status_code(NEW.status_id)='UNDER_REVIEW'
   AND sports_management.get_match_status_code(OLD.status_id) IN ('SUSPENDED','UNDER_REVIEW') THEN
   SELECT EXISTS(SELECT 1 FROM sports_management.venue_reservations WHERE match_id=NEW.id) INTO is_reserved;
 END IF;
 DELETE FROM sports_management.venue_reservations WHERE match_id=NEW.id;
 DELETE FROM sports_management.team_reservations WHERE match_id=NEW.id;
 IF is_reserved AND NEW.starts_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
  INSERT INTO sports_management.venue_reservations(match_id,venue_id,time_range) VALUES(NEW.id,NEW.venue_id,tstzrange(NEW.starts_at,NEW.reserved_until,'[)'));
  INSERT INTO sports_management.team_reservations(match_id,season_team_id,time_range) VALUES(NEW.id,NEW.home_team_id,tstzrange(NEW.starts_at,NEW.ends_at,'[)')),
    (NEW.id,NEW.away_team_id,tstzrange(NEW.starts_at,NEW.ends_at,'[)'));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sports_management.sync_match_reservations() FROM PUBLIC;
COMMIT;
