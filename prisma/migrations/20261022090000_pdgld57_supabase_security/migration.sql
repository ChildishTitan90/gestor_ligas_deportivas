-- Seguridad adicional de PDGLD-57, sin modificar la migración ya compartida.
-- Docker/CI no tienen los esquemas y roles administrados de Supabase.
DO $security$
DECLARE marker_count integer;
BEGIN
  SELECT (SELECT count(*) FROM pg_namespace WHERE nspname IN ('auth', 'storage'))
       + (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))
    INTO marker_count;
  IF marker_count = 0 THEN
    RETURN;
  END IF;
  IF marker_count <> 5 THEN
    RAISE EXCEPTION 'Marcadores parciales de Supabase; revisar el destino antes de migrar';
  END IF;

  ALTER TABLE sports_management.club_affiliation_categories ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON sports_management.club_affiliation_categories FROM PUBLIC, anon, authenticated, service_role;
  -- Sin políticas para clientes: denegación por defecto. La aplicación usa
  -- Prisma y la autorización de NextAuth; no se introducen políticas auth.uid().
  -- No se conceden privilegios, membresías ni BYPASSRLS a ningún rol.
END
$security$;
