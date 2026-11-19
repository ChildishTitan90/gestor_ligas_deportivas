BEGIN;

-- La cédula registra la ausencia; NO_SHOW no confirma resultado ni clasificación.
INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE f.code = 'CONFIRMED' AND t.code = 'NO_SHOW'
    AND r.code IN ('DATA_ENTRY', 'REFEREE')
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

-- El cierre oficial se integra de forma transaccional con la clasificación;
-- esta fila no habilita por sí sola la confirmación en la interfaz.
INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE f.code = 'NO_SHOW' AND t.code = 'FINISHED' AND r.code = 'REFEREE'
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

-- El programador cambia horario/cancha cuando ambos equipos estuvieron ausentes;
-- una confirmación posterior comprueba de nuevo los requisitos operativos.
INSERT INTO sports_management.match_status_transitions(from_status_id, to_status_id, role_id)
  SELECT f.id, t.id, r.id FROM sports_management.match_statuses f
  CROSS JOIN sports_management.match_statuses t CROSS JOIN sports_management.roles r
  WHERE ((f.code = 'NO_SHOW' AND t.code = 'RESCHEDULED') OR (f.code = 'RESCHEDULED' AND t.code = 'CONFIRMED'))
    AND r.code = 'SCHEDULER'
  ON CONFLICT (from_status_id, to_status_id, role_id) DO NOTHING;

-- El acuse original contiene la incidencia privada; conservarlo aunque se
-- reutilice la cédula para el nuevo encuentro del mismo partido.
CREATE FUNCTION sports_management.protect_no_show_receipt() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, sports_management AS $$
BEGIN
  IF OLD.status = 'APPLIED' AND OLD.private_payload #>> '{command,kind}' = 'record-no-show' THEN
    RAISE EXCEPTION 'El registro de incomparecencia es inmutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_no_show_receipt BEFORE UPDATE OR DELETE ON sports_management.match_report_syncs
  FOR EACH ROW EXECUTE FUNCTION sports_management.protect_no_show_receipt();

COMMIT;
