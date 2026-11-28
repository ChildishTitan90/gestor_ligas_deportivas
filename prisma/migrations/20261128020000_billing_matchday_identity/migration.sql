BEGIN;
-- Jornadas distintas pueden compartir fechas. Su identidad automática es el
-- origen estable; los cargos manuales conservan la identidad por periodo.
DROP INDEX sports_management.charges_club_business_period;
DROP INDEX sports_management.charges_team_business_period;
CREATE UNIQUE INDEX charges_club_business_period ON sports_management.charges
 (season_id,club_id,charge_concept_id,period_start_date,period_end_date)
 WHERE club_id IS NOT NULL AND automation_source IS NULL;
CREATE UNIQUE INDEX charges_team_business_period ON sports_management.charges
 (season_id,season_team_id,charge_concept_id,period_start_date,period_end_date)
 WHERE season_team_id IS NOT NULL AND automation_source IS NULL;
-- La desigualdad 0<>1 impide manual↔automático para el mismo contexto/periodo.
-- Manual↔manual queda protegido arriba y automático↔automático por su origen UNIQUE.
-- btree_gist ya pertenece al baseline; no se instala infraestructura nueva.
ALTER TABLE sports_management.charges ADD CONSTRAINT charges_club_manual_auto_period
 EXCLUDE USING gist (season_id WITH =,club_id WITH =,charge_concept_id WITH =,
 period_start_date WITH =,period_end_date WITH =,
 (CASE WHEN automation_source IS NULL THEN 0 ELSE 1 END) WITH <>) WHERE (club_id IS NOT NULL);
ALTER TABLE sports_management.charges ADD CONSTRAINT charges_team_manual_auto_period
 EXCLUDE USING gist (season_id WITH =,season_team_id WITH =,charge_concept_id WITH =,
 period_start_date WITH =,period_end_date WITH =,
 (CASE WHEN automation_source IS NULL THEN 0 ELSE 1 END) WITH <>) WHERE (season_team_id IS NOT NULL);
COMMIT;
