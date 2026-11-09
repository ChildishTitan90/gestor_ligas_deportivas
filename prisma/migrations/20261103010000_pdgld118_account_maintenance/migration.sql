-- Revisión administrativa independiente de users.version (revocación de sesiones).
ALTER TABLE sports_management.users
  ADD COLUMN maintenance_revision integer NOT NULL DEFAULT 0
  CHECK (maintenance_revision >= 0);
