BEGIN;

-- Una corrección posterior al cierre necesita su procedimiento autorizado.
-- Hasta entonces ningún escritor de la aplicación modifica un partido finalizado,
-- aunque tenga UPDATE sobre matches. No afecta el paso IN_PROGRESS -> FINISHED.
CREATE FUNCTION sports_management.prevent_finished_match_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, sports_management AS $$
BEGIN
  IF sports_management.get_match_status_code(OLD.status_id) = 'FINISHED' THEN
    RAISE EXCEPTION 'FINISHED_MATCH_LOCKED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prevent_finished_match_edit
BEFORE UPDATE ON sports_management.matches
FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_finished_match_edit();

COMMIT;
