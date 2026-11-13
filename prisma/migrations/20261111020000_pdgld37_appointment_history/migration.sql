BEGIN;

CREATE FUNCTION sports_management.guard_appointment_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, sports_management AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un nombramiento histórico no se puede borrar' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id, NEW.position_id, NEW.person_id, NEW.starts_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.position_id, OLD.person_id, OLD.starts_at)
    OR (OLD.ends_at IS NOT NULL AND (NEW.ends_at IS NULL OR NEW.ends_at > OLD.ends_at))
  THEN
    RAISE EXCEPTION 'No se puede sustituir la identidad, el cargo ni ampliar una vigencia histórica' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_appointment_history
BEFORE UPDATE OR DELETE ON sports_management.appointments
FOR EACH ROW EXECUTE FUNCTION sports_management.guard_appointment_history();

CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON sports_management.appointments
FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();

COMMIT;
