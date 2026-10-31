-- Configuración por participación: no reinterpreta ni habilita filas legadas.
ALTER TABLE sports_management.season_categories ADD COLUMN player_policy jsonb;
ALTER TABLE sports_management.season_categories ADD CONSTRAINT player_policy_object
  CHECK (player_policy IS NULL OR jsonb_typeof(player_policy) = 'object');

-- Un cierre congela también los descendientes aunque exista una autorización
-- histórica de corrección. No se borran autorizaciones ni datos anteriores.
CREATE OR REPLACE FUNCTION sports_management.protect_closed_season() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_id uuid; new_id uuid; tid uuid; is_closed boolean;
BEGIN
 IF TG_TABLE_NAME='seasons' THEN
  IF TG_OP<>'INSERT' THEN previous_id:=OLD.id; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN previous_id:=OLD.season_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id:=NEW.season_id; END IF;
 END IF;
 FOREACH tid IN ARRAY ARRAY[previous_id,new_id] LOOP
  IF tid IS NULL THEN CONTINUE; END IF;
  SELECT status='CLOSED' INTO is_closed FROM sports_management.seasons WHERE id=tid FOR SHARE;
  IF is_closed THEN RAISE EXCEPTION 'Temporada cerrada: historial inmutable'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION sports_management.protect_closed_season_dependency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; old_data jsonb; tid uuid; parameter_value text; is_closed boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN row_data:=to_jsonb(NEW); END IF;
 FOREACH parameter_value IN ARRAY ARRAY[old_data->>TG_ARGV[0],row_data->>TG_ARGV[0]] LOOP
  IF parameter_value IS NULL THEN CONTINUE; END IF;
  tid:=sports_management.get_entity_season(TG_ARGV[1],parameter_value::uuid);
  SELECT status='CLOSED' INTO is_closed FROM sports_management.seasons WHERE id=tid FOR SHARE;
  IF is_closed THEN RAISE EXCEPTION 'Temporada cerrada: historial dependiente inmutable'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE FUNCTION sports_management.validate_season_closure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='CLOSED' AND OLD.status<>'CLOSED' THEN
  IF OLD.status<>'ACTIVE' THEN RAISE EXCEPTION 'Solo se cierra una temporada activa'; END IF;
  -- El UPDATE mantiene el bloqueo de la temporada. Los escritores dependientes
  -- toman FOR SHARE y no pueden introducir pendientes durante este cierre.
  IF EXISTS (
   SELECT 1 FROM sports_management.matches m
   JOIN sports_management.match_statuses s ON s.id=m.status_id
   LEFT JOIN sports_management.match_results r ON r.match_id=m.id
   WHERE m.season_id=OLD.id AND m.deleted_at IS NULL AND s.code<>'CANCELED'
    AND (s.code NOT IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') OR r.id IS NULL)
  ) THEN RAISE EXCEPTION 'Hay partidos sin resultado definitivo'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_closure BEFORE UPDATE ON sports_management.seasons
 FOR EACH ROW EXECUTE FUNCTION sports_management.validate_season_closure();
