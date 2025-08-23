## Getting started

### Prerequisites
- Docker and Docker Compose
- Spotify account(s)
- Deezer account (optional, recommended for FLAC)
- Spotify API `client_id` and `client_secret` (from Spotify Developer Dashboard)

Quick start (Docker Compose):

```bash
# 1) Create a project directory
mkdir spotizerr && cd spotizerr

# 2) Add .env
# Download .env.example from the repo and create .env with your values

# 3) Add docker-compose.yaml
# Download docker-compose.yaml from the repo to this folder

# 4) Start
docker compose up -d
```

### Initial setup
- Open the web UI (default: `http://localhost:7171`)
- Go to Configuration → Accounts
- Use `spotizerr-auth` to register Spotify credentials quickly

Spotify account setup with spotizerr-auth:

```bash
docker run --network=host --rm -it cooldockerizer93/spotizerr-auth
```
or, if docker doesn't work:

#### Alternative installers

<details>
<summary>Linux / macOS</summary>

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install spotizerr-auth
```

</details>

<details>
<summary>Windows (PowerShell)</summary>

```powershell
python -m venv .venv; .venv\Scripts\Activate.ps1; pip install spotizerr-auth
```

</details>

<details>
<summary>Windows (cmd.exe)</summary>

```cmd
python -m venv .venv && .venv\Scripts\activate && pip install spotizerr-auth
```

</details>

Then run `spotizerr-auth`.

_Note: You will have to enable the virtual environment everytime you want to register a new account._

### Registering account
- Ensure Spotify client is opened before starting
- Enter Spotizerr URL (e.g., http://localhost:7171)
- Enter Spotify API `client_id` and `client_secret` if prompted (one-time)
- Name the account + region code (e.g., US)
- Transfer playback to the temporary device when asked
- Credentials are posted to Spotizerr automatically

**Next steps:**
- Add Deezer ARL in Configuration → Accounts (optional, allows for FLAC availability if premium)
- Adjust Download and Formatting options
- Enable Watch system if you want automatic downloads

**Troubleshooting (quick):**
- Downloads not starting: verify service credentials and API keys
- Watch not working: enable in Configuration → Watch and set intervals
- Auth issues: ensure JWT secret and SSO creds (if used); try clearing browser cache
- Queue stalling: force-refresh the page (ctrl+F5)

**Logs:**
```bash
docker logs spotizerr
```
- Enable Watch system if you want auto-downloads