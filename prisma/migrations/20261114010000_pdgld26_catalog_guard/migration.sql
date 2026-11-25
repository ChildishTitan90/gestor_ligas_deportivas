-- Catálogo: revisión optimista, auditoría y conservación de artículos referenciados.
ALTER TABLE sports_management.regulation_articles ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE sports_management.regulation_articles ADD CONSTRAINT article_revision_positive CHECK (revision > 0);

CREATE FUNCTION sports_management.guard_catalog_article() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
DECLARE rule_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.competition_rule_id <> OLD.competition_rule_id THEN
    RAISE EXCEPTION 'CATALOG_MOVE_FORBIDDEN';
  END IF;
  SELECT status INTO rule_status FROM sports_management.competition_rules
    WHERE id = CASE WHEN TG_OP='DELETE' THEN OLD.competition_rule_id ELSE NEW.competition_rule_id END FOR UPDATE;
  IF rule_status <> 'DRAFT' THEN RAISE EXCEPTION 'CATALOG_READ_ONLY'; END IF;
  IF TG_OP <> 'INSERT' AND (EXISTS(SELECT 1 FROM sports_management.sanctions WHERE article_id=OLD.id)
    OR EXISTS(SELECT 1 FROM sports_management.team_withdrawals WHERE article_id=OLD.id)) THEN
    RAISE EXCEPTION 'CATALOG_REFERENCED';
  END IF;
  IF TG_OP='UPDATE' THEN NEW.revision := OLD.revision + 1; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER catalog_article_guard BEFORE INSERT OR UPDATE OR DELETE ON sports_management.regulation_articles
FOR EACH ROW EXECUTE FUNCTION sports_management.guard_catalog_article();
CREATE TRIGGER record_audit AFTER INSERT OR UPDATE OR DELETE ON sports_management.regulation_articles
FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();

-- Una referencia bloquea su artículo mientras se inserta, evitando carreras con edición.
CREATE FUNCTION sports_management.lock_catalog_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
BEGIN
  PERFORM id FROM sports_management.regulation_articles WHERE id=NEW.article_id FOR SHARE;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_sanction_reference BEFORE INSERT ON sports_management.sanctions
FOR EACH ROW EXECUTE FUNCTION sports_management.lock_catalog_reference();
CREATE TRIGGER catalog_withdrawal_reference BEFORE INSERT ON sports_management.team_withdrawals
FOR EACH ROW EXECUTE FUNCTION sports_management.lock_catalog_reference();

-- Los ejemplos y artículos sin validación no se publican al aprobar el reglamento.
CREATE FUNCTION sports_management.guard_catalog_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = sports_management, pg_temp AS $$
BEGIN
  IF NEW.status='APPROVED' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS (
    SELECT 1 FROM sports_management.regulation_articles WHERE competition_rule_id=NEW.id
      AND (parameters->>'schemaVersion' IS DISTINCT FROM '1'
        OR parameters #>> '{source,origin}' IS DISTINCT FROM 'DOCUMENTED'
        OR parameters #>> '{source,confirmed}' IS DISTINCT FROM 'true')
  ) THEN RAISE EXCEPTION 'CATALOG_REQUIRES_VALIDATION'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_approval_guard BEFORE UPDATE ON sports_management.competition_rules
FOR EACH ROW EXECUTE FUNCTION sports_management.guard_catalog_approval();
