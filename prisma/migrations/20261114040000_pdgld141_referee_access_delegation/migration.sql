BEGIN;
-- Conservar la creación/delegación de Comisión desde el administrador de cuentas.
-- Es una concesión explícita; no agrega APPROVE de refereeing ni un bypass por rol.
CREATE FUNCTION sports_management.install_referee_access_delegation_permission() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; target_role uuid; permission uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(54,2026);
 IF EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000142') THEN
  IF NOT EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000142' AND action='INSTALL' AND table_name='seed_referee_access_delegation') THEN RAISE EXCEPTION 'PERMISSION_INSTALLATION_CONFLICT'; END IF;
  RETURN;
 END IF;
 SELECT user_id INTO actor FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000051' AND action='INSTALL' AND table_name='seed_permission_matrix';
 IF actor IS NULL THEN RETURN; END IF;
 SELECT id INTO target_role FROM sports_management.roles WHERE code='SUPERADMIN';
 SELECT id INTO permission FROM sports_management.permissions WHERE module='referee-accounts' AND action='CREATE';
 IF target_role IS NULL OR permission IS NULL THEN RAISE EXCEPTION 'PERMISSION_INSTALLATION_CONFLICT'; END IF;
 PERFORM set_config('app.user_id',actor::text,true),set_config('app.reason','PDGLD-141: conservar la delegación explícita de acceso arbitral por Administración',true);
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(target_role,permission,false) ON CONFLICT(role_id,permission_id) DO NOTHING;
 INSERT INTO sports_management.audit_logs(id,user_id,action,table_name,entity_id,reason,new_data)
 VALUES('54000000-0000-4000-8000-000000000142',actor,'INSTALL','seed_referee_access_delegation',permission,
  'PDGLD-141: conservar la delegación explícita de acceso arbitral por Administración',
  jsonb_build_object('module','referee-accounts','action','CREATE','role','SUPERADMIN','source','PDGLD-141'));
END $$;
REVOKE ALL ON FUNCTION sports_management.install_referee_access_delegation_permission() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION sports_management.install_referee_access_delegation_permission() FROM %I',r); END IF;
 END LOOP;
END $$;
SELECT sports_management.install_referee_access_delegation_permission();
COMMIT;
