-- Cierre de inscripciones de equipos separado del inicio de competencia.
ALTER TABLE sports_management.seasons ADD COLUMN team_registration_closed_at timestamptz;

CREATE FUNCTION sports_management.enforce_team_registration_open() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cutoff timestamptz;
BEGIN
  SELECT team_registration_closed_at INTO cutoff FROM sports_management.seasons WHERE id=NEW.season_id FOR SHARE;
  IF cutoff IS NOT NULL THEN
    RAISE EXCEPTION 'Inscripciones de equipos cerradas para esta temporada' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER team_registration_open BEFORE INSERT ON sports_management.season_teams
  FOR EACH ROW EXECUTE FUNCTION sports_management.enforce_team_registration_open();
