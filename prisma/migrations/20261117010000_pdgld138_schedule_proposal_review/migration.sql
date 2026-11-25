BEGIN;

ALTER TABLE sports_management.schedule_proposals
  ADD COLUMN status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT schedule_proposals_review_status CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED')),
  ADD CONSTRAINT schedule_proposals_review_version CHECK (version > 0);

CREATE TRIGGER audit_schedule_proposal_review
AFTER UPDATE OF status ON sports_management.schedule_proposals
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION sports_management.audit_change();

COMMIT;
