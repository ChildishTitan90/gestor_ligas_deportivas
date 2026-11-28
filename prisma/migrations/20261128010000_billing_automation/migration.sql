BEGIN;
-- Configuración de emisión; las deudas y los pagos siguen en charges/payments.
CREATE TABLE sports_management.billing_automation_policies (
 id uuid PRIMARY KEY,
 season_id uuid NOT NULL REFERENCES sports_management.seasons(id),
 kind text NOT NULL CHECK(kind IN ('CLUB_AFFILIATION','TEAM_ENROLLMENT','REFEREE_MATCHDAY')),
 revision integer NOT NULL CHECK(revision>0),
 enabled boolean NOT NULL,
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 due_days integer NOT NULL CHECK(due_days BETWEEN 0 AND 365),
 first_matchday integer NOT NULL CHECK(first_matchday BETWEEN 1 AND 1000),
 last_matchday integer NOT NULL CHECK(last_matchday BETWEEN first_matchday AND 1000),
 created_by uuid NOT NULL REFERENCES sports_management.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 request_hash varchar(64) NOT NULL,
 UNIQUE(season_id,kind,revision)
);
CREATE TRIGGER keep_billing_automation_policy BEFORE UPDATE OR DELETE ON sports_management.billing_automation_policies
 FOR EACH ROW EXECUTE FUNCTION sports_management.prevent_history_mutation();
CREATE TRIGGER record_billing_automation_policy AFTER INSERT ON sports_management.billing_automation_policies
 FOR EACH ROW EXECUTE FUNCTION sports_management.audit_change();
ALTER TABLE sports_management.charges
 ADD COLUMN automation_source text UNIQUE,
 ADD COLUMN automation_policy_id uuid REFERENCES sports_management.billing_automation_policies(id);
ALTER TABLE sports_management.charges ADD CONSTRAINT charges_automation_origin
 CHECK((automation_source IS NULL)=(automation_policy_id IS NULL));
CREATE FUNCTION sports_management.guard_charge_automation_origin() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.automation_source IS DISTINCT FROM OLD.automation_source
 OR NEW.automation_policy_id IS DISTINCT FROM OLD.automation_policy_id
 THEN RAISE EXCEPTION 'CHARGE_CONTEXT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_charge_automation_origin BEFORE UPDATE ON sports_management.charges
 FOR EACH ROW EXECUTE FUNCTION sports_management.guard_charge_automation_origin();
REVOKE ALL ON FUNCTION sports_management.guard_charge_automation_origin() FROM PUBLIC;
REVOKE ALL ON sports_management.billing_automation_policies FROM PUBLIC;
DO $$ BEGIN
 IF to_regnamespace('auth') IS NOT NULL THEN
  ALTER TABLE sports_management.billing_automation_policies ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON sports_management.billing_automation_policies FROM anon, authenticated, service_role;
 END IF;
END $$;
-- Concesiones explícitas del backend se aplican mediante el plan de runtime.
-- Docker local conserva su decisión de RLS; Supabase deniega por defecto.
COMMIT;
