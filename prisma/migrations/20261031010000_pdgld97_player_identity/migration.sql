BEGIN;

-- Aditiva: los NULL conservan el significado de registros históricos no evaluados.
ALTER TABLE sports_management.player_registrations ADD COLUMN identity_review_status text;
ALTER TABLE sports_management.player_registrations
  ADD CONSTRAINT player_identity_review_status CHECK
    (identity_review_status IS NULL OR identity_review_status IN ('NOT_REQUIRED','REQUIRED')),
  ADD CONSTRAINT player_identity_review_blocks_approval CHECK
    (identity_review_status IS DISTINCT FROM 'REQUIRED' OR status <> 'ACTIVE');
CREATE INDEX people_birth_date_identity ON sports_management.people(birth_date);

-- El baseline no audita esta tabla. Un solo evento por escritura, sin nombres/CURP.
CREATE TRIGGER record_audit AFTER INSERT OR UPDATE OR DELETE ON sports_management.player_registrations
  FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();

-- No se alteran funciones existentes, ventanas, estados deportivos ni RLS.
COMMIT;
