BEGIN;

-- Las filas previas conservan NULL; no se reescribe el historial inmutable.
ALTER TABLE sports_management.match_status_history
  ADD COLUMN expected_version integer CHECK (expected_version > 0 AND expected_version < 2147483647);

-- El UUID de historial es también la clave de operación. Una versión solo admite
-- una transición del servicio; el índice admite las filas históricas sin versión.
CREATE UNIQUE INDEX match_status_history_match_id_expected_version_key
  ON sports_management.match_status_history(match_id, expected_version);

-- No concede permisos ni asigna usuarios: conserva el catálogo RF22 existente.
INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE ((f.code = 'DRAFT' AND t.code = 'SCHEDULED') OR (f.code = 'SCHEDULED' AND t.code = 'CONFIRMED')) AND r.code = 'SCHEDULER'
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE ((f.code = 'CONFIRMED' AND t.code = 'IN_PROGRESS') OR (f.code = 'IN_PROGRESS' AND t.code = 'SUSPENDED')) AND r.code = 'DATA_ENTRY'
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE f.code IN ('SCHEDULED','CONFIRMED','SUSPENDED') AND t.code = 'CANCELED'
    AND r.code IN ('SUPERADMIN','EXECUTIVE_PRESIDENT')
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

COMMIT;
