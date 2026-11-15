BEGIN;
-- Evidencia privada: los binarios permanecen en Storage; aquí solo referencias.
CREATE TABLE sports_management.referee_presentation_credentials (
 id uuid PRIMARY KEY REFERENCES sports_management.referee_presentations,
 file_id uuid NOT NULL UNIQUE REFERENCES sports_management.files,
 uploaded_by uuid NOT NULL REFERENCES sports_management.users,
 operation_key uuid NOT NULL,input_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(uploaded_by,operation_key)
);
CREATE TRIGGER a_refereeing_lock BEFORE INSERT OR UPDATE OR DELETE ON sports_management.referee_presentation_credentials FOR EACH STATEMENT EXECUTE FUNCTION sports_management.lock_refereeing();
CREATE FUNCTION sports_management.guard_referee_credential() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CREDENTIAL_IMMUTABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sports_management.referee_presentations p JOIN sports_management.seasons s ON s.id=p.season_id WHERE p.id=NEW.id AND p.status='PENDING' AND s.status<>'CLOSED') THEN RAISE EXCEPTION 'CLOSED_CONTEXT'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sports_management.files f WHERE f.id=NEW.file_id AND f.uploaded_by=NEW.uploaded_by
   AND f.mime_type IN ('application/pdf','image/jpeg','image/png') AND f.size_bytes BETWEEN 1 AND 10485760 AND f.sha256 ~ '^[a-f0-9]{64}$'
   AND f.storage_key ~ '^referee-credentials/v1/([0-9a-f-]{36}/){4}[0-9a-f-]{36}$') THEN RAISE EXCEPTION 'CREDENTIAL_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_referee_credential BEFORE INSERT OR UPDATE OR DELETE ON sports_management.referee_presentation_credentials FOR EACH ROW EXECUTE FUNCTION sports_management.guard_referee_credential();
CREATE TRIGGER no_truncate_referee_credentials BEFORE TRUNCATE ON sports_management.referee_presentation_credentials FOR EACH STATEMENT EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE TRIGGER record_audit AFTER INSERT ON sports_management.referee_presentation_credentials FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
CREATE FUNCTION sports_management.require_referee_credential() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.status='PENDING' AND NEW.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM sports_management.referee_presentation_credentials c JOIN sports_management.files f ON f.id=c.file_id WHERE c.id=NEW.id AND f.sha256=NEW.approved_identity->>'credentialSha256') THEN RAISE EXCEPTION 'CREDENTIAL_REQUIRED'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credential_required_before_incorporation BEFORE UPDATE ON sports_management.referee_presentations FOR EACH ROW EXECUTE FUNCTION sports_management.require_referee_credential();
CREATE FUNCTION sports_management.keep_referee_credential_file() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sports_management.referee_presentation_credentials WHERE file_id=OLD.id) THEN RAISE EXCEPTION 'CREDENTIAL_IMMUTABLE'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER keep_referee_credential_file BEFORE UPDATE OR DELETE ON sports_management.files FOR EACH ROW EXECUTE FUNCTION sports_management.keep_referee_credential_file();
REVOKE ALL ON sports_management.referee_presentation_credentials FROM PUBLIC;
REVOKE ALL ON FUNCTION sports_management.guard_referee_credential(),sports_management.require_referee_credential(),sports_management.keep_referee_credential_file() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN ALTER TABLE sports_management.referee_presentation_credentials ENABLE ROW LEVEL SECURITY; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON sports_management.referee_presentation_credentials FROM %I',r); END IF;
 END LOOP;
END $$;
COMMIT;
