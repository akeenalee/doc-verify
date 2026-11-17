-- The two test issuers every suite expects: demo (platform admin's home) and dsu
INSERT INTO tenants (id, name, subdomain, short_code, institution_type)
VALUES ('00000000-0000-0000-0000-000000000001', 'Innovation Lens Resources Ltd', 'demo', 'IL', 'academic'),
       (gen_random_uuid(), 'Demo State University', 'dsu', 'DSU', 'academic')
ON CONFLICT DO NOTHING;

-- Migration 007 opens the demo portal, but on a fresh database it runs before demo exists
UPDATE tenants SET student_claim_required = FALSE WHERE subdomain = 'demo';
