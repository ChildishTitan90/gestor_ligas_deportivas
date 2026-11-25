BEGIN;

ALTER TABLE sports_management.venue_loans
  ADD COLUMN requested_by uuid REFERENCES sports_management.users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD COLUMN request_hash text,
  ADD COLUMN requested_windows jsonb,
  ADD COLUMN reviewed_by uuid REFERENCES sports_management.users(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD COLUMN reviewed_at timestamptz(6),
  ADD COLUMN review_reason text,
  ADD CONSTRAINT venue_loan_request_details CHECK (
    (requested_by IS NULL AND request_hash IS NULL AND requested_windows IS NULL)
    OR (requested_by IS NOT NULL AND request_hash IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$'
      AND requested_windows IS NOT NULL AND jsonb_typeof(requested_windows) = 'array')
  ),
  ADD CONSTRAINT venue_loan_review_details CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL)
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL
      AND length(btrim(review_reason)) BETWEEN 8 AND 500 AND status IN ('APPROVED', 'REJECTED'))
  );

CREATE TRIGGER audit_venue_loan_requests
AFTER INSERT OR UPDATE ON sports_management.venue_loans
FOR EACH ROW WHEN (NEW.requested_by IS NOT NULL)
EXECUTE FUNCTION sports_management.audit_change();

COMMIT;
