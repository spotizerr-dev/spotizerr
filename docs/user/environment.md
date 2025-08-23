## Environment variables

Location: project `.env`. Minimal reference for server admins.

### Core
- HOST: Interface to bind (default `0.0.0.0`)
- EXPLICIT_FILTER: Filter explicit content (`true|false`, default `false`)

### Redis
- REDIS_HOST: Hostname (default `redis`)
- REDIS_PORT: Port (default `6379`)
- REDIS_DB: Database index (default `0`)
- REDIS_PASSWORD: Password

### File ownership & permissions
- UMASK: Default permissions for new files (default `0022`)
- SKIP_SET_PERMISSIONS: Skip permission fix on startup (`true|false`, default `false`)

### Multi-user & auth
- ENABLE_AUTH: Enable authentication (`true|false`, default `false`)
- JWT_SECRET: Long random string for tokens (required if auth enabled)
- JWT_EXPIRATION_HOURS: Session duration in hours (default `720`)
- DEFAULT_ADMIN_USERNAME: Seed admin username (default `admin`)
- DEFAULT_ADMIN_PASSWORD: Seed admin password (change it!)
- DISABLE_REGISTRATION: Disable public signups (`true|false`, default `false`)

### SSO
- SSO_ENABLED: Enable SSO (`true|false`)
- SSO_BASE_REDIRECT_URI: Base backend callback (e.g. `http://127.0.0.1:7171/api/auth/sso/callback`)
- FRONTEND_URL: Public UI base (e.g. `http://127.0.0.1:7171`)
- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
- GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET

### Tips
- If running behind a reverse proxy, set `FRONTEND_URL` and `SSO_BASE_REDIRECT_URI` to public URLs.
- Change `DEFAULT_ADMIN_*` on first login or disable registration and create users from the admin panel.