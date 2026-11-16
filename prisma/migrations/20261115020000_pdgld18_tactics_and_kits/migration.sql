-- Aditiva: conservar los textos históricos y las referencias existentes.
ALTER TABLE sports_management.club_affiliations ADD COLUMN uniform_kits jsonb;
ALTER TABLE sports_management.club_affiliations ADD CONSTRAINT club_affiliations_uniform_kits_object
  CHECK (uniform_kits IS NULL OR jsonb_typeof(uniform_kits) = 'object');
INSERT INTO sports_management.event_types (sport_id, code, name, requires_disciplinary_case)
SELECT id, 'INJURY', 'Lesión', false FROM sports_management.sports WHERE code = 'SOCCER'
ON CONFLICT (sport_id, code) DO NOTHING;
