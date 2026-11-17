-- The two test issuers every suite expects: demo (platform admin's home) and lasu
INSERT INTO tenants (id, name, subdomain, short_code, institution_type)
VALUES ('00000000-0000-0000-0000-000000000001', 'Innovation Lens Resources Ltd', 'demo', 'IL', 'academic'),
       (gen_random_uuid(), 'Lagos State University', 'lasu', 'LASU', 'academic')
ON CONFLICT DO NOTHING;
