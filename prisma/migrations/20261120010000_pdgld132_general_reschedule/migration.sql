BEGIN;

-- La operación revalida disponibilidad y permisos; la matriz no concede roles.
INSERT INTO sports_management.match_status_transitions(from_status_id,to_status_id,role_id)
SELECT f.id,t.id,r.id FROM sports_management.match_statuses f
CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
WHERE f.code IN ('SCHEDULED','CONFIRMED') AND t.code='RESCHEDULED' AND r.code='SCHEDULER'
ON CONFLICT (from_status_id,to_status_id,role_id) DO NOTHING;

COMMIT;
