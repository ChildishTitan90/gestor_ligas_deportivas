BEGIN;

-- No cambia filas históricas, estados ni identidad. El reloj transaccional
-- existente se comparte con el servicio y no admite una fecha del payload.
CREATE OR REPLACE FUNCTION sports_management.validate_player_registration()
RETURNS trigger LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE
 tournament_start timestamptz;
 policy jsonb;
 pending boolean;
 season_state text;
 registration_clock timestamptz;
 registration_day integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sports_management.people WHERE id=NEW.person_id AND curp IS NOT NULL) THEN
  RAISE EXCEPTION 'El jugador requiere CURP y paid_at de nacimiento';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT sc.player_policy,sc.eligibility_pending,s.status,s.competition_starts_at
   INTO policy,pending,season_state,tournament_start
  FROM sports_management.season_teams st
  JOIN sports_management.groups g ON g.id=st.group_id AND g.season_id=st.season_id
  JOIN sports_management.season_categories sc ON sc.id=g.season_category_id AND sc.season_id=st.season_id
  JOIN sports_management.seasons s ON s.id=st.season_id
  WHERE st.id=NEW.season_team_id AND st.season_id=NEW.season_id
  FOR SHARE OF st,g,sc,s;
  IF NOT FOUND OR season_state='CLOSED' THEN RAISE EXCEPTION 'PLAYER_ADMISSION_CONTEXT'; END IF;
  IF pending IS DISTINCT FROM false OR policy IS NULL OR jsonb_typeof(policy)<>'object' THEN
   RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING';
  END IF;
  IF jsonb_typeof(policy->'timezone') IS DISTINCT FROM 'string'
    OR jsonb_typeof(policy->'registrationDays') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=policy->>'timezone')
    OR jsonb_array_length(policy->'registrationDays') NOT BETWEEN 1 AND 7 THEN
   RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'registrationDays') AS d(value)
    WHERE jsonb_typeof(value)<>'number' OR value::text !~ '^[1-7]$')
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(policy->'registrationDays') AS d(value))
       <> jsonb_array_length(policy->'registrationDays') THEN
   RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING';
  END IF;
  registration_clock:=sports_management.player_participation_now();
  registration_day:=extract(isodow FROM registration_clock AT TIME ZONE (policy->>'timezone'));
  IF registration_clock IS NULL OR NOT (policy->'registrationDays' @> to_jsonb(ARRAY[registration_day])) THEN
   RAISE EXCEPTION 'PLAYER_ADMISSION_WINDOW_CLOSED';
  END IF;
  IF tournament_start IS NOT NULL AND registration_clock>=tournament_start AND EXISTS(
   SELECT 1 FROM sports_management.player_registrations i WHERE i.person_id=NEW.person_id
   AND i.season_id=NEW.season_id AND i.season_team_id<>NEW.season_team_id) THEN
   RAISE EXCEPTION 'No se permite cambiar equipo una vez iniciada la competencia';
  END IF;
 ELSE
  IF NEW.person_id<>OLD.person_id OR NEW.season_id<>OLD.season_id OR NEW.season_team_id<>OLD.season_team_id THEN
   RAISE EXCEPTION 'La identidad y pertenencia de una inscripcion no se reescriben; gestionar baja y nueva alta';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sports_management.validate_player_registration() FROM PUBLIC;
-- No se recrea el trigger: conserva INSERT/UPDATE y su identidad existente.
-- Sin tablas nuevas, backfill, cambio de RLS ni despliegue automático.
COMMIT;
