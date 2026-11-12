BEGIN;

ALTER TABLE sports_management.venues
  ADD COLUMN match_duration_minutes integer NOT NULL DEFAULT 90 CHECK (match_duration_minutes BETWEEN 1 AND 1440),
  ADD COLUMN buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 1440);

-- Open intervals may overlap a closure. Within each kind of interval, use
-- disjoint half-open ranges, so an end can touch the next start.
ALTER TABLE sports_management.venue_availability
  ADD CONSTRAINT venue_availability_no_overlap EXCLUDE USING gist (
    venue_id WITH =,
    (CASE WHEN type = 'AVAILABLE' THEN 1 ELSE 0 END) WITH =,
    (tstzrange(starts_at, ends_at, '[)')) WITH &&
  );

-- A write on the same venue row serializes availability and scheduling.
-- The row version also protects transactions using stronger isolation.
CREATE FUNCTION sports_management.serialize_venue_availability() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, sports_management AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.venue_id <> OLD.venue_id THEN
    RAISE EXCEPTION 'Cannot move an availability interval to another venue' USING ERRCODE = '23514';
  END IF;
  UPDATE sports_management.venues SET is_active = is_active
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.venue_id ELSE NEW.venue_id END;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER venue_availability_serialize
BEFORE INSERT OR UPDATE OR DELETE ON sports_management.venue_availability
FOR EACH ROW EXECUTE FUNCTION sports_management.serialize_venue_availability();

CREATE FUNCTION sports_management.check_match_venue_availability() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, sports_management AS $$
DECLARE
  venue sports_management.venues%ROWTYPE;
  match_slot tstzrange;
BEGIN
  IF NEW.starts_at IS NULL OR NEW.venue_id IS NULL OR NEW.deleted_at IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM sports_management.match_statuses WHERE id = NEW.status_id AND reserves_resources)
  THEN RETURN NEW; END IF;

  -- Existing reservations survive a newly recorded block or changes to the
  -- venue defaults. Only creating or moving the reservation uses today's rules.
  IF TG_OP = 'UPDATE'
    AND ROW(NEW.venue_id, NEW.starts_at, NEW.ends_at, NEW.reserved_until, NEW.season_id)
      IS NOT DISTINCT FROM ROW(OLD.venue_id, OLD.starts_at, OLD.ends_at, OLD.reserved_until, OLD.season_id)
    AND OLD.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM sports_management.match_statuses WHERE id = OLD.status_id AND reserves_resources)
  THEN RETURN NEW; END IF;

  UPDATE sports_management.venues SET is_active = is_active WHERE id = NEW.venue_id RETURNING * INTO venue;
  IF NOT FOUND OR NOT venue.is_active OR NOT EXISTS (
    SELECT 1 FROM sports_management.seasons WHERE id = NEW.season_id AND league_id = venue.league_id
  ) THEN
    RAISE EXCEPTION 'Venue is inactive or outside the season league' USING ERRCODE = '23514';
  END IF;
  IF NEW.ends_at IS DISTINCT FROM NEW.starts_at + make_interval(mins => venue.match_duration_minutes)
    OR NEW.reserved_until IS DISTINCT FROM NEW.ends_at + make_interval(mins => venue.buffer_minutes)
  THEN
    RAISE EXCEPTION 'Match duration or buffer does not match venue settings' USING ERRCODE = '23514';
  END IF;

  match_slot := tstzrange(NEW.starts_at, NEW.reserved_until, '[)');
  IF NOT EXISTS (
    SELECT 1 FROM sports_management.venue_availability
    WHERE venue_id = venue.id AND type = 'AVAILABLE'
      AND tstzrange(starts_at, ends_at, '[)') @> match_slot
  ) OR EXISTS (
    SELECT 1 FROM sports_management.venue_availability
    WHERE venue_id = venue.id AND type IN ('BLOCK', 'MAINTENANCE')
      AND tstzrange(starts_at, ends_at, '[)') && match_slot
  ) THEN
    RAISE EXCEPTION 'Match reservation is outside venue availability' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER matches_check_venue_availability
BEFORE INSERT OR UPDATE ON sports_management.matches
FOR EACH ROW EXECUTE FUNCTION sports_management.check_match_venue_availability();

COMMIT;
