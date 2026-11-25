BEGIN;

ALTER TABLE sports_management.appointments
  ADD COLUMN request_id uuid,
  ADD COLUMN request_hash char(64),
  ADD CONSTRAINT appointment_request_pair CHECK ((request_id IS NULL) = (request_hash IS NULL));

CREATE UNIQUE INDEX appointments_request_id_key ON sports_management.appointments(request_id);

COMMIT;
