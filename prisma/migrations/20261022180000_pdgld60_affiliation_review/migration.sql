ALTER TABLE sports_management.club_affiliations
  ADD COLUMN review_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT club_affiliations_review_version_check CHECK (review_version >= 0);
