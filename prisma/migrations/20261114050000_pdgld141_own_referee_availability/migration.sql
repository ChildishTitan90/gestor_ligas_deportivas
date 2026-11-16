BEGIN;
-- Ampliación autorizada: UPDATE contextual de refereeing, únicamente propio.
CREATE FUNCTION sports_management.install_own_referee_availability_permission() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; target_role uuid; permission uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(54,2026);
 IF EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000143') THEN
  IF NOT EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000143' AND action='INSTALL' AND table_name='seed_own_referee_availability') THEN RAISE EXCEPTION 'PERMISSION_INSTALLATION_CONFLICT'; END IF;
  RETURN;
 END IF;
 SELECT user_id INTO actor FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000051' AND action='INSTALL' AND table_name='seed_permission_matrix';
 IF actor IS NULL THEN RETURN; END IF;
 SELECT id INTO target_role FROM sports_management.roles WHERE code='REFEREE';
 SELECT id INTO permission FROM sports_management.permissions WHERE module='refereeing' AND action='UPDATE';
 IF target_role IS NULL OR permission IS NULL THEN RAISE EXCEPTION 'PERMISSION_INSTALLATION_CONFLICT'; END IF;
 PERFORM set_config('app.user_id',actor::text,true),set_config('app.reason','PDGLD-141: disponibilidad propia del árbitro, autorizada por el usuario',true);
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(target_role,permission,true) ON CONFLICT(role_id,permission_id) DO NOTHING;
 INSERT INTO sports_management.audit_logs(id,user_id,action,table_name,entity_id,reason,new_data)
 VALUES('54000000-0000-4000-8000-000000000143',actor,'INSTALL','seed_own_referee_availability',permission,
  'PDGLD-141: disponibilidad propia del árbitro, autorizada por el usuario',
  jsonb_build_object('module','refereeing','action','UPDATE','role','REFEREE','contextOnly',true,'source','PDGLD-141'));
END $$;
REVOKE ALL ON FUNCTION sports_management.install_own_referee_availability_permission() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION sports_management.install_own_referee_availability_permission() FROM %I',r); END IF;
 END LOOP;
END $$;
SELECT sports_management.install_own_referee_availability_permission();
COMMIT;
