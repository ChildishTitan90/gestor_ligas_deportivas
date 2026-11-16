-- Inicio transaccional desde cédula: las reservas siguen siendo derivadas.
-- El rol limitado no recibe INSERT/UPDATE/DELETE sobre venue_reservations.
-- Corrección independiente y aditiva; no incorpora transiciones del PR PDGLD-85.
ALTER FUNCTION sports_management.sync_match_reservations() SECURITY DEFINER;
ALTER FUNCTION sports_management.sync_match_reservations() SET search_path = pg_catalog, sports_management;
REVOKE ALL ON FUNCTION sports_management.sync_match_reservations() FROM PUBLIC;
