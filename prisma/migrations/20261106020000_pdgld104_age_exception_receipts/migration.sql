BEGIN;
INSERT INTO sports_management.document_types(code,name)
VALUES ('AGE_EXCEPTION_LETTER','Carta de excepción de edad') ON CONFLICT (code) DO NOTHING;

-- Los campos existentes solo reflejan una decisión con acuse del mismo registro.
-- La aplicación exige además Secretaría + APPROVE vigentes sobre ese contexto.
CREATE FUNCTION sports_management.guard_player_age_exception() RETURNS trigger
LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE receipt record;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.authorized_by IS NOT NULL OR NEW.age_exception_file_id IS NOT NULL OR NEW.age_exception_reason IS NOT NULL
  THEN RAISE EXCEPTION 'PLAYER_AGE_EXCEPTION_RECEIPT_REQUIRED'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.authorized_by,NEW.age_exception_file_id,NEW.age_exception_reason)
   IS NOT DISTINCT FROM ROW(OLD.authorized_by,OLD.age_exception_file_id,OLD.age_exception_reason) THEN RETURN NEW; END IF;
 SELECT a.user_id,a.reason,a.new_data INTO receipt FROM audit_logs a
 WHERE a.entity_id=NEW.id AND a.action='PLAYER_AGE_EXCEPTION_DECIDED'
   AND a.id::text=current_setting('app.age_exception_event_id',true)
   AND a.user_id::text=current_setting('app.user_id',true)
   AND ((a.new_data->>'decision'='APPROVE' AND NEW.authorized_by=a.user_id
     AND NEW.age_exception_file_id::text=a.new_data->>'fileId' AND NEW.age_exception_reason=a.reason)
    OR (a.new_data->>'decision'='REJECT' AND NEW.authorized_by IS NULL
     AND NEW.age_exception_file_id IS NULL AND NEW.age_exception_reason IS NULL))
   AND EXISTS(SELECT 1 FROM audit_logs r WHERE r.id::text=a.new_data->>'requestId'
     AND r.entity_id=NEW.id AND r.action='PLAYER_AGE_EXCEPTION_REQUESTED'
     AND r.new_data->>'binding'=a.new_data->>'binding'
     AND r.new_data->>'fileId'=a.new_data->>'fileId')
 ORDER BY a.occurred_at DESC,a.id DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_AGE_EXCEPTION_RECEIPT_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_player_age_exception BEFORE INSERT OR UPDATE ON sports_management.player_registrations
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_player_age_exception();
REVOKE ALL ON FUNCTION sports_management.guard_player_age_exception() FROM PUBLIC;
-- No añade tablas ni cambia RLS. Los eventos usan la auditoría inmutable existente.
-- Sin backfill: ninguna excepción histórica se acredita automáticamente.
COMMIT;
