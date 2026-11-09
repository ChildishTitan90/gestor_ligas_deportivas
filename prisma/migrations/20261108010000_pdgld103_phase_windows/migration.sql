BEGIN;
-- Restricción adicional de INSERT; no altera filas históricas ni RLS.
CREATE FUNCTION sports_management.validate_registration_phase_window()
RETURNS trigger LANGUAGE plpgsql SET search_path=sports_management,pg_temp AS $$
DECLARE
 policy jsonb;
 windows jsonb;
 item jsonb;
 local_clock timestamp;
 opening timestamp;
 closing timestamp;
 allowed boolean := false;
BEGIN
 SELECT sc.player_policy INTO policy
 FROM sports_management.season_teams st
 JOIN sports_management.groups g ON g.id=st.group_id AND g.season_id=st.season_id
 JOIN sports_management.season_categories sc ON sc.id=g.season_category_id AND sc.season_id=st.season_id
 WHERE st.id=NEW.season_team_id AND st.season_id=NEW.season_id
 FOR SHARE OF st,g,sc;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_ADMISSION_CONTEXT'; END IF;
 windows := policy->'registrationWindows';
 IF windows IS NULL THEN RETURN NEW; END IF;
 IF jsonb_typeof(windows) <> 'array' THEN RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING'; END IF;
 IF jsonb_array_length(windows)>20 THEN RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING'; END IF;
 IF jsonb_array_length(windows)=0 THEN RETURN NEW; END IF;
 local_clock := sports_management.player_participation_now() AT TIME ZONE (policy->>'timezone');
 IF local_clock IS NULL THEN RAISE EXCEPTION 'PLAYER_ADMISSION_WINDOW_CLOSED'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(windows) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
    OR jsonb_typeof(item->'phase') IS DISTINCT FROM 'string'
    OR length(btrim(item->>'phase')) NOT BETWEEN 1 AND 120
    OR jsonb_typeof(item->'opensAt') IS DISTINCT FROM 'string'
    OR jsonb_typeof(item->'closesAt') IS DISTINCT FROM 'string'
    OR (item->>'opensAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$'
    OR (item->>'closesAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$' THEN
   RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING';
  END IF;
  opening := (item->>'opensAt')::timestamp;
  closing := (item->>'closesAt')::timestamp;
  IF opening>=closing THEN RAISE EXCEPTION 'PLAYER_ADMISSION_POLICY_PENDING'; END IF;
  IF local_clock>=opening AND local_clock<closing THEN allowed:=true; END IF;
 END LOOP;
 IF NOT allowed THEN RAISE EXCEPTION 'PLAYER_ADMISSION_WINDOW_CLOSED'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sports_management.validate_registration_phase_window() FROM PUBLIC;
CREATE TRIGGER trg_registration_phase_window BEFORE INSERT ON sports_management.player_registrations
 FOR EACH ROW EXECUTE FUNCTION sports_management.validate_registration_phase_window();
COMMIT;
