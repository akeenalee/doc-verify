-- The sectors database starts with the platform admin's home (demo) only.
-- Suites onboard their own issuers through /admin, as Innovation Lens would.
INSERT INTO tenants (id, name, subdomain, short_code, institution_type)
VALUES ('00000000-0000-0000-0000-000000000001', 'Innovation Lens Resources Ltd', 'demo', 'IL', 'academic')
ON CONFLICT DO NOTHING;
UPDATE tenants SET student_claim_required = FALSE WHERE subdomain = 'demo';
