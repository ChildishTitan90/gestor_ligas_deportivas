ALTER TABLE sports_management.users
  ADD COLUMN admin_reset_expires_at timestamptz,
  ADD COLUMN admin_reset_consumed_at timestamptz,
  ADD CONSTRAINT users_admin_reset_state_check CHECK (
    (admin_reset_expires_at IS NULL AND admin_reset_consumed_at IS NULL) OR
    (must_change_password AND admin_reset_expires_at IS NOT NULL AND
      (admin_reset_consumed_at IS NULL OR admin_reset_consumed_at < admin_reset_expires_at))
  );
