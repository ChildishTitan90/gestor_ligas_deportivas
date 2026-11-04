-- Conserva modalidad y grupos legados sin reclasificar ni modificar inscripciones.
ALTER TABLE sports_management.season_categories
  ADD COLUMN competition_format text NOT NULL DEFAULT 'LEGACY_GROUPS',
  ADD CONSTRAINT season_category_format_check CHECK (competition_format IN ('LEGACY_GROUPS','GENERAL_TABLE'));

-- Invariante diferida: al confirmar debe existir exactamente un General.
CREATE FUNCTION sports_management.check_general_table_group() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE targets uuid[]; target uuid; mode text; total integer; general integer;
BEGIN
 IF TG_TABLE_NAME='season_categories' THEN
   IF TG_OP='DELETE' THEN targets:=ARRAY[OLD.id]; ELSE targets:=ARRAY[NEW.id]; END IF;
 ELSE
   IF TG_OP='INSERT' THEN targets:=ARRAY[NEW.season_category_id];
   ELSIF TG_OP='DELETE' THEN targets:=ARRAY[OLD.season_category_id];
   ELSE targets:=ARRAY[OLD.season_category_id,NEW.season_category_id]; END IF;
 END IF;
 FOREACH target IN ARRAY targets LOOP
   SELECT competition_format INTO mode FROM sports_management.season_categories WHERE id=target;
   IF mode='GENERAL_TABLE' THEN
     SELECT count(*),count(*) FILTER(WHERE name='General') INTO total,general
       FROM sports_management.groups WHERE season_category_id=target;
     IF total<>1 OR general<>1 THEN RAISE EXCEPTION 'Tabla general requiere exactamente un grupo General'; END IF;
   END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER general_table_category AFTER INSERT OR UPDATE ON sports_management.season_categories
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sports_management.check_general_table_group();
CREATE CONSTRAINT TRIGGER general_table_groups AFTER INSERT OR UPDATE OR DELETE ON sports_management.groups
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sports_management.check_general_table_group();
