BEGIN;
-- Ampliación RF22 autorizada: capacidad acotada, sin users:CREATE/UPDATE.
-- Función privada de instalación para bases ya sembradas y para seed posterior.
CREATE FUNCTION sports_management.install_referee_access_permission() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid; target_role uuid; permission uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(54,2026);
 IF EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000141') THEN
  IF NOT EXISTS(SELECT 1 FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000141' AND action='INSTALL' AND table_name='seed_referee_access_permission') THEN RAISE EXCEPTION 'PERMISSION_INSTALLATION_CONFLICT'; END IF;
  RETURN; -- No restaurar una concesión retirada deliberadamente.
 END IF;
 SELECT user_id INTO actor FROM sports_management.audit_logs WHERE id='54000000-0000-4000-8000-000000000051' AND action='INSTALL' AND table_name='seed_permission_matrix';
 IF actor IS NULL THEN RETURN; END IF; -- El seed instalará primero la matriz inicial.
 SELECT id INTO target_role FROM sports_management.roles WHERE code='REFEREE_MANAGER';
 IF target_role IS NULL THEN RAISE EXCEPTION 'PERMISSION_INSTALLATION_CONFLICT'; END IF;
 PERFORM set_config('app.user_id',actor::text,true),set_config('app.reason','PDGLD-141: acceso acotado de árbitros incorporados, autorizado por el usuario',true);
 INSERT INTO sports_management.permissions(module,action) VALUES('referee-accounts','CREATE') ON CONFLICT(module,action) DO NOTHING;
 SELECT id INTO permission FROM sports_management.permissions WHERE module='referee-accounts' AND action='CREATE';
 INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES(target_role,permission,false) ON CONFLICT(role_id,permission_id) DO NOTHING;
 INSERT INTO sports_management.audit_logs(id,user_id,action,table_name,entity_id,reason,new_data)
 VALUES('54000000-0000-4000-8000-000000000141',actor,'INSTALL','seed_referee_access_permission',permission,
  'PDGLD-141: acceso acotado de árbitros incorporados, autorizado por el usuario',
  jsonb_build_object('module','referee-accounts','action','CREATE','role','REFEREE_MANAGER','source','PDGLD-141'));
END $$;
REVOKE ALL ON FUNCTION sports_management.install_referee_access_permission() FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION sports_management.install_referee_access_permission() FROM %I',r); END IF;
 END LOOP;
END $$;
-- Solo el propietario/migrador instala; Preview y los roles API no la ejecutan.
SELECT sports_management.install_referee_access_permission();
COMMIT;
