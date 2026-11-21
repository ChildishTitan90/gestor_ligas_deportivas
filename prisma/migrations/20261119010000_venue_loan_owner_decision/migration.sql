BEGIN;
ALTER TABLE sports_management.venue_loans
 ADD COLUMN owner_decision_required boolean NOT NULL DEFAULT false,
 ADD COLUMN owner_decision text,
 ADD COLUMN owner_reviewed_by uuid REFERENCES sports_management.users(id),
 ADD COLUMN owner_reviewed_at timestamptz(6),
 ADD COLUMN owner_review_reason text,
 ADD CONSTRAINT venue_loan_owner_decision_check CHECK (
   (owner_decision IS NULL AND owner_reviewed_by IS NULL AND owner_reviewed_at IS NULL AND owner_review_reason IS NULL)
   OR (owner_decision IS NOT NULL AND owner_decision IN ('APPROVED', 'REJECTED') AND owner_reviewed_by IS NOT NULL AND owner_reviewed_at IS NOT NULL AND owner_review_reason IS NOT NULL AND length(btrim(owner_review_reason)) BETWEEN 8 AND 500)
 );
COMMIT;
