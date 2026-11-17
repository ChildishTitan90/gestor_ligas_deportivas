-- Proyección privada de captura; el resultado oficial sigue en match_results.
ALTER TABLE sports_management.match_reports ADD COLUMN draft_data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE sports_management.lineups ADD COLUMN is_starter boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN sports_management.match_reports.draft_data IS 'DTO de captura v1 y referencias privadas; no sustituye resultados oficiales ni autoriza al actor.';
