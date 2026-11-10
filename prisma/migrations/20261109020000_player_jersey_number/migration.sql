BEGIN;
ALTER TABLE sports_management.player_registrations
  ADD COLUMN jersey_number integer,
  ADD CONSTRAINT player_registration_team_jersey_key UNIQUE (season_team_id, jersey_number),
  ADD CONSTRAINT player_registration_jersey_nonnegative CHECK (jersey_number >= 0);

-- Una vez elegido, el dorsal queda fijo durante toda la temporada. Las cédulas
-- conservan por separado lineups.jersey_number.
CREATE FUNCTION sports_management.guard_registration_jersey_number() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE season_state text;
BEGIN
  IF OLD.jersey_number IS NOT NULL THEN
    RAISE EXCEPTION 'PLAYER_JERSEY_LOCKED';
  END IF;
  SELECT status INTO season_state FROM sports_management.seasons
    WHERE id = NEW.season_id FOR SHARE;
  IF season_state = 'CLOSED' THEN
    RAISE EXCEPTION 'PLAYER_JERSEY_SEASON_CLOSED';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION sports_management.guard_registration_jersey_number() FROM PUBLIC;
CREATE TRIGGER guard_registration_jersey_number
  BEFORE UPDATE OF jersey_number ON sports_management.player_registrations
  FOR EACH ROW WHEN (OLD.jersey_number IS DISTINCT FROM NEW.jersey_number)
  EXECUTE FUNCTION sports_management.guard_registration_jersey_number();
COMMIT;
