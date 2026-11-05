-- Devuelve solo existencia, sin exponer datos de las tablas relacionadas.
CREATE FUNCTION sports_management.maintenance_has_references(entity_kind text, entity_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $$
DECLARE target oid; ref record; found boolean;
BEGIN
  target := CASE entity_kind
    WHEN 'club' THEN 'sports_management.clubs'::regclass
    WHEN 'team' THEN 'sports_management.teams'::regclass
    ELSE NULL END;
  IF target IS NULL THEN RAISE EXCEPTION 'Invalid maintenance entity'; END IF;
  -- Incluye FK compuestas y futuras referencias. Nunca ejecuta CASCADE.
  FOR ref IN
    SELECT DISTINCT n.nspname, c.relname, a.attname
    FROM pg_constraint fk
    JOIN pg_class c ON c.oid=fk.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) AS k(local_key, remote_key)
    JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k.local_key
    JOIN pg_attribute remote ON remote.attrelid=fk.confrelid AND remote.attnum=k.remote_key
    WHERE fk.contype='f' AND fk.confrelid=target AND remote.attname='id'
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)', ref.nspname,ref.relname,ref.attname)
      INTO found USING entity_id;
    IF found THEN RETURN true; END IF;
  END LOOP;
  RETURN EXISTS(SELECT 1 FROM sports_management.audit_logs a
    WHERE a.entity_id=maintenance_has_references.entity_id
      AND a.table_name=CASE entity_kind WHEN 'club' THEN 'clubs' ELSE 'teams' END);
END $$;
REVOKE ALL ON FUNCTION sports_management.maintenance_has_references(text,uuid) FROM PUBLIC;
