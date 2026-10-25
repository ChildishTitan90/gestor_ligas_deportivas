-- PDGLD-62: distingue solicitud de autorización. No autoriza filas históricas.
ALTER TABLE sports_management.club_affiliation_categories
  ADD COLUMN authorized_by uuid REFERENCES sports_management.users(id),
  ADD COLUMN authorized_at timestamptz,
  ADD CONSTRAINT affiliation_category_authorization_check
    CHECK ((authorized_by IS NULL) = (authorized_at IS NULL));
CREATE INDEX club_affiliation_categories_authorized_by_idx
  ON sports_management.club_affiliation_categories(authorized_by);

-- Las filas anteriores se conservan sin atribuirles una captura inventada.
ALTER TABLE sports_management.season_teams
  ADD COLUMN enrolled_by uuid REFERENCES sports_management.users(id),
  ADD COLUMN enrolled_at timestamptz,
  ADD COLUMN enrollment_key uuid,
  ADD COLUMN enrollment_hash varchar(64),
  ADD CONSTRAINT season_teams_enrolled_by_enrollment_key_key UNIQUE (enrolled_by, enrollment_key),
  ADD CONSTRAINT season_teams_enrollment_check CHECK (
    (enrolled_by IS NULL AND enrolled_at IS NULL AND enrollment_key IS NULL AND enrollment_hash IS NULL) OR
    (enrolled_by IS NOT NULL AND enrolled_at IS NOT NULL AND enrollment_key IS NOT NULL
      AND enrollment_hash IS NOT NULL AND enrollment_hash ~ '^[a-f0-9]{64}$')
  );

-- El baseline NO tiene record_audit en season_teams. Auditar el agregado sin
-- copiar clave de reintento, huella, nombre del equipo o datos de personas.
CREATE FUNCTION sports_management.audit_team_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = sports_management, pg_temp AS $$
DECLARE actor uuid; audit_reason text; previous_value jsonb; next_value jsonb;
BEGIN
  actor := nullif(current_setting('app.user_id', true), '')::uuid;
  audit_reason := nullif(current_setting('app.reason', true), '');
  IF actor IS NULL OR audit_reason IS NULL THEN
    RAISE EXCEPTION 'La inscripción exige contexto de auditoría';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    previous_value := jsonb_build_object('team_id', OLD.team_id, 'club_id', OLD.club_id,
      'season_id', OLD.season_id, 'group_id', OLD.group_id, 'status', OLD.status);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    next_value := jsonb_build_object('team_id', NEW.team_id, 'club_id', NEW.club_id,
      'season_id', NEW.season_id, 'group_id', NEW.group_id, 'status', NEW.status);
  END IF;
  INSERT INTO sports_management.audit_logs(user_id, action, table_name, entity_id, previous_data, new_data, reason)
    VALUES (actor, TG_OP, 'season_teams', COALESCE(NEW.id, OLD.id), previous_value, next_value, audit_reason);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION sports_management.audit_team_enrollment() FROM PUBLIC;
CREATE TRIGGER record_enrollment_audit AFTER INSERT OR UPDATE OR DELETE
  ON sports_management.season_teams FOR EACH ROW EXECUTE FUNCTION sports_management.audit_team_enrollment();

-- Sin tablas nuevas ni cambios de RLS/ACL en tablas existentes. La seguridad
-- Supabase y el bloqueo de temporadas del baseline permanecen vigentes.
