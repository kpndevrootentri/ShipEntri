-- Run this while connected to the dropdeploy database (not postgres).
-- From project root: psql -d dropdeploy -f scripts/fix-db-permissions.sql
-- Or: psql -d dropdeploy then paste these lines.

GRANT ALL ON SCHEMA public TO entri_user;
GRANT CREATE ON SCHEMA public TO entri_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO entri_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO entri_user;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO entri_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO entri_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO entri_user;
