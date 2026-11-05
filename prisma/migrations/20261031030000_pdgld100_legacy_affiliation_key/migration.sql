BEGIN;
-- Compatibilidad con solicitudes anteriores al contrato de envío. Las claves existentes
-- siguen inmutables incluso para el backend limitado; no se conceden permisos aquí.
CREATE FUNCTION sports_management.guard_affiliation_submission_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
BEGIN
  IF NEW.submission_key IS NOT DISTINCT FROM OLD.submission_key
     AND NEW.submission_hash IS NOT DISTINCT FROM OLD.submission_hash THEN
    RETURN NEW;
  END IF;
  IF OLD.submission_key IS NULL AND OLD.submission_hash IS NULL
     AND NEW.submission_key IS NOT NULL AND NEW.submission_hash ~ '^[a-f0-9]{64}$'
     AND OLD.status = 'PENDING' AND NEW.status = 'PENDING'
     AND OLD.review_reason IS NOT NULL AND NEW.review_version = OLD.review_version + 1
     AND NEW.requested_by = OLD.requested_by
     AND OLD.requested_by::text = current_setting('app.user_id',true)
     AND nullif(current_setting('app.reason',true),'') IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'La identidad de envío de la afiliación es inmutable' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER guard_submission_identity BEFORE UPDATE OF submission_key,submission_hash
  ON sports_management.club_affiliations FOR EACH ROW
  EXECUTE FUNCTION sports_management.guard_affiliation_submission_identity();
COMMIT;
