-- Precisión adicional sin inventar segundos para eventos históricos.
ALTER TABLE sports_management.match_events ADD COLUMN second smallint;
ALTER TABLE sports_management.match_events ADD CONSTRAINT match_events_second_range
  CHECK (second IS NULL OR (second BETWEEN 0 AND 59 AND minute IS NOT NULL));
