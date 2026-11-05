-- Baja administrativa reversible: no modifica afiliaciones ni inscripciones.
ALTER TABLE sports_management.clubs ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE sports_management.clubs DROP CONSTRAINT clubs_status_check;
ALTER TABLE sports_management.clubs ADD CONSTRAINT clubs_status_check
  CHECK (status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'WITHDRAWN'));
ALTER TABLE sports_management.teams
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

-- El baseline no audita UPDATE de estas dos entidades. Las altas mantienen su flujo.
CREATE TRIGGER record_maintenance_audit AFTER UPDATE ON sports_management.clubs
  FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version) EXECUTE FUNCTION sports_management.audit_change();
CREATE TRIGGER record_maintenance_audit AFTER UPDATE ON sports_management.teams
  FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version) EXECUTE FUNCTION sports_management.audit_change();
