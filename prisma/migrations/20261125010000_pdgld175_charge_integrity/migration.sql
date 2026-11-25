BEGIN;
-- Fallar ante duplicados históricos conserva los datos para su conciliación humana.
CREATE UNIQUE INDEX charges_club_business_period ON sports_management.charges
 (season_id,club_id,charge_concept_id,period_start_date,period_end_date) WHERE club_id IS NOT NULL;
CREATE UNIQUE INDEX charges_team_business_period ON sports_management.charges
 (season_id,season_team_id,charge_concept_id,period_start_date,period_end_date) WHERE season_team_id IS NOT NULL;

-- El trigger record_audit existente conserva el historial de cada cargo.
-- La clave de negocio permanece estable. Correcciones explícitas de importe/vencimiento.
CREATE FUNCTION sports_management.guard_charge_correction() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CHARGE_HISTORY_REQUIRED'; END IF;
 IF NEW.season_id IS DISTINCT FROM OLD.season_id OR NEW.club_id IS DISTINCT FROM OLD.club_id
 OR NEW.season_team_id IS DISTINCT FROM OLD.season_team_id OR NEW.charge_concept_id IS DISTINCT FROM OLD.charge_concept_id
 OR NEW.period_start_date IS DISTINCT FROM OLD.period_start_date OR NEW.period_end_date IS DISTINCT FROM OLD.period_end_date
 OR NEW.billing_plan_id IS DISTINCT FROM OLD.billing_plan_id OR NEW.sanction_id IS DISTINCT FROM OLD.sanction_id
 OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.issued_on IS DISTINCT FROM OLD.issued_on
 OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
 OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
 THEN RAISE EXCEPTION 'CHARGE_CONTEXT_IMMUTABLE'; END IF;
 IF EXISTS(SELECT 1 FROM sports_management.payments WHERE charge_id=OLD.id)
 THEN RAISE EXCEPTION 'CHARGE_HAS_PAYMENTS'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'CHARGE_VERSION_CONFLICT'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_charge_correction BEFORE UPDATE OR DELETE ON sports_management.charges
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_charge_correction();

-- Coordina futuras altas de pagos con correcciones, incluso en otra conexión.
CREATE FUNCTION sports_management.lock_charge_for_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM id FROM sports_management.charges WHERE id=NEW.charge_id FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER a_lock_charge_for_payment BEFORE INSERT ON sports_management.payments
 FOR EACH ROW EXECUTE FUNCTION sports_management.lock_charge_for_payment();
CREATE TRIGGER record_billing_plan_audit AFTER INSERT ON sports_management.billing_plans
 FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
CREATE TRIGGER keep_billing_plan BEFORE UPDATE OR DELETE ON sports_management.billing_plans
 FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_history_mutation();
REVOKE ALL ON FUNCTION sports_management.guard_charge_correction(),sports_management.lock_charge_for_payment() FROM PUBLIC;
COMMIT;
