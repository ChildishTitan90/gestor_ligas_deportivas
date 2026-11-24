BEGIN;

-- Solo el servicio interno de confirmación puede usar este par. La acción
-- genérica de transiciones continúa denegando FINISHED; clasificación y casos
-- disciplinarios deben confirmar en la misma transacción antes de habilitar UI.
INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE f.code = 'IN_PROGRESS' AND t.code = 'FINISHED'
    AND r.code IN ('DATA_ENTRY', 'REFEREE')
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

COMMIT;
