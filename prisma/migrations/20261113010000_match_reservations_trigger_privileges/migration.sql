-- Las reservas son derivadas: el backend no recibe escritura directa sobre ellas.
-- El trigger ejecuta exclusivamente la sincronización definida por el propietario.
ALTER FUNCTION sports_management.sync_match_reservations() SECURITY DEFINER;
ALTER FUNCTION sports_management.sync_match_reservations() SET search_path = pg_catalog, sports_management;
REVOKE ALL ON FUNCTION sports_management.sync_match_reservations() FROM PUBLIC;
