-- PDGLD-57. Aditiva: conserva solicitudes previas y no altera 0_init.
ALTER TABLE sports_management.club_affiliations
  ADD COLUMN club_name text,
  ADD COLUMN submission_key uuid,
  ADD COLUMN submission_hash varchar(64),
  ADD CONSTRAINT club_affiliations_submission_check CHECK (
    (submission_key IS NULL AND submission_hash IS NULL) OR
    (submission_key IS NOT NULL AND submission_hash IS NOT NULL
      AND submission_hash ~ '^[a-f0-9]{64}$' AND club_name IS NOT NULL)
  ),
  ADD CONSTRAINT club_affiliations_requested_by_submission_key_key UNIQUE (requested_by, submission_key);

CREATE TABLE sports_management.club_affiliation_categories (
  affiliation_id uuid NOT NULL,
  season_id uuid NOT NULL,
  category_id uuid NOT NULL,
  CONSTRAINT club_affiliation_categories_pkey PRIMARY KEY (affiliation_id, category_id),
  CONSTRAINT club_affiliation_categories_affiliation_id_season_id_fkey
    FOREIGN KEY (affiliation_id, season_id) REFERENCES sports_management.club_affiliations(id, season_id),
  CONSTRAINT club_affiliation_categories_season_id_category_id_fkey
    FOREIGN KEY (season_id, category_id) REFERENCES sports_management.season_categories(season_id, category_id)
);
CREATE INDEX club_affiliation_categories_affiliation_id_season_id_idx
  ON sports_management.club_affiliation_categories(affiliation_id, season_id);
CREATE INDEX club_affiliation_categories_season_id_category_id_idx
  ON sports_management.club_affiliation_categories(season_id, category_id);
CREATE TRIGGER season_read_only BEFORE INSERT OR UPDATE OR DELETE
  ON sports_management.club_affiliation_categories FOR EACH ROW
  EXECUTE FUNCTION sports_management.protect_closed_season();

-- Defensa adicional: nunca conceder acceso directo a clientes de Supabase.
-- RLS de producción necesita revisión explícita; no activarlo en Docker.
-- El guard de despliegue detiene CREATE TABLE hasta aprobar su plan de seguridad.
REVOKE ALL ON sports_management.club_affiliation_categories FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON sports_management.club_affiliation_categories FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
