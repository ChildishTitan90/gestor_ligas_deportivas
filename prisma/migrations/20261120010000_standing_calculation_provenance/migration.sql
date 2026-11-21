-- A unique positive rank cannot encode an unresolved tie. NULL is intentional;
-- existing positive ranks and UNIQUE constraints are preserved.
ALTER TABLE sports_management.standing_entries ALTER COLUMN rank DROP NOT NULL;
ALTER TABLE sports_management.standing_versions
  ADD COLUMN input_fingerprint text,
  ADD COLUMN calculation_data jsonb;
CREATE INDEX standing_versions_calculation_input_key
 ON sports_management.standing_versions(group_id,matchday_id,competition_rule_id,input_fingerprint);
COMMENT ON COLUMN sports_management.standing_entries.rank IS 'Posición resuelta; NULL indica empate pendiente de decisión reglamentaria.';
COMMENT ON COLUMN sports_management.standing_versions.calculation_data IS 'Proyección interna versionada y procedencia de resultados/eventos; no constituye publicación ni validación.';

-- Even a future validator must not present an unresolved ranking as validated.
CREATE FUNCTION sports_management.check_standing_rank_validation() RETURNS trigger
 LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE vid uuid;
BEGIN
 IF TG_TABLE_NAME='standing_versions' THEN vid:=NEW.id; ELSE vid:=NEW.standing_version_id; END IF;
 IF EXISTS(SELECT 1 FROM standing_versions v JOIN standing_entries e ON e.standing_version_id=v.id
           WHERE v.id=vid AND v.status='VALIDATED' AND e.rank IS NULL) THEN
   RAISE EXCEPTION 'No se puede validar una clasificación con posiciones pendientes' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER standing_version_resolved_ranks
 AFTER INSERT OR UPDATE ON sports_management.standing_versions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION sports_management.check_standing_rank_validation();
CREATE CONSTRAINT TRIGGER standing_entry_resolved_rank
 AFTER INSERT OR UPDATE ON sports_management.standing_entries DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION sports_management.check_standing_rank_validation();
