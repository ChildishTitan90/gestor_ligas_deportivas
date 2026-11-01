-- Conserva las filas previas y su configuración. Las nuevas asociaciones pueden
-- prepararse antes de PV-04 sin inventar una fecha de corte ni habilitar jugadores.
ALTER TABLE sports_management.season_categories
  ADD COLUMN eligibility_pending boolean NOT NULL DEFAULT false,
  ALTER COLUMN age_cutoff_date DROP NOT NULL;
ALTER TABLE sports_management.season_categories
  ADD CONSTRAINT season_categories_eligibility_configuration_check
  CHECK (eligibility_pending OR age_cutoff_date IS NOT NULL);
