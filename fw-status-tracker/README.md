# FW Status Tracker

The tracker is a shared web application for a physical server. It runs in Docker
on Windows or Linux; Caddy provides HTTPS, and SQLite stores the shared
workspace and module history on the server. It does not use a cloud application
host or cloud database.

## What changed

- The server, not a user's browser, is the source of truth for saved projects.
- Individual accounts are authenticated on the server; administrators can add,
  deactivate/reactivate, promote/demote, and reset accounts from the dashboard.
- All authenticated users share the same project workspace.
- Concurrent edits use a revision check. A stale save is rejected instead of
  silently overwriting another user's changes.
- Removing a project from the workspace retains its module history, as in the
  existing tracker.
- Module history is stored once in SQLite rather than duplicated in two
  browser-storage arrays.
- Passwords are hashed; sessions are opaque, revocable server records, and
  state-changing API requests require a CSRF token.
- The app container has no published host port. Only the HTTPS reverse proxy is
  exposed.

## Requirements

- Docker Engine and the Docker Compose plugin on the physical server.
- A public DNS name (for example, `tracker.example.com`) pointed at the server's
  public IP address.
- Router/firewall rules allowing inbound TCP 80 and 443 to the server. Do not
  expose port 8000.
- An internet connection for image/package installation and Caddy's automated
  HTTPS certificate issuance/renewal. Application hosting and database storage
  remain on the physical server.

If the public IP changes, update DNS. If the ISP blocks inbound connections or
places the server behind carrier-grade NAT, this direct-public-access design
will not work until the network provider supplies a reachable address and
allows inbound traffic. A VPN/tunnel is an alternative if those conditions
cannot be met.

## First deployment

Run these commands from this directory.

1. Copy `.env.example` to `.env`. Set `TRACKER_DOMAIN` to the public DNS name,
   then replace every `CHANGE_ME` value with unique secrets. Generate a
   `TRACKER_SECRET_KEY` with:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
   ```

   Use a unique administrator username and a randomly generated password of at
   least 14 characters. Keep `.env` private; it is ignored by Git.
2. Point the DNS record at the physical server and configure the router and
   operating-system firewall to forward/allow ports 80 and 443.
3. Start the services:

   ```powershell
   docker compose up --build -d
   docker compose ps
   ```

4. Open `https://<TRACKER_DOMAIN>` and sign in with the bootstrap administrator
   credentials. Create individual accounts in **Account Administration**.
5. After the first successful startup, remove
   `TRACKER_BOOTSTRAP_ADMIN_USERNAME` and `TRACKER_BOOTSTRAP_ADMIN_PASSWORD`
   from `.env`. The administrator is stored in SQLite; keeping bootstrap
   credentials on disk is unnecessary. Recreate the containers with
   `docker compose up -d`.

The database and generated signing key live in Docker's persistent
`tracker-data` volume. Do not remove that volume when updating the app. The Caddy
certificate state is also in Docker volumes and survives container recreation.

For local-only development without HTTPS, set `TRACKER_COOKIE_SECURE=false`
before starting `main.py`. On a fresh database, running `python main.py` from
an interactive terminal prompts you to create the initial administrator; the
password is entered without echo and only its hash is stored. Noninteractive
starts, including Docker, still require
`TRACKER_BOOTSTRAP_ADMIN_USERNAME` and `TRACKER_BOOTSTRAP_ADMIN_PASSWORD` to be
configured. Do not use the insecure-cookie setting for a public deployment.

## Move existing browser data

The older version saved data separately in each browser's local storage. That
data is not on the old static server and cannot be discovered or migrated
automatically. In the old browser, open the summary page, expand **All Module
Details**, select the rows to preserve, and use **Export Selected**. Sign in to
the new server, open the summary page, and use **Import Excel**. Confirm the
imported projects and module history before retiring the old copy. Repeat for
each browser that has records which need to be retained.

## Backups and recovery

Create a consistent online SQLite backup inside the server's data directory:

```powershell
docker compose exec tracker mkdir -p /tmp/tracker-backups
$backup = "fw-status-tracker-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite3"
docker compose exec tracker python main.py --backup "/tmp/tracker-backups/$backup"
docker compose cp "tracker:/tmp/tracker-backups/$backup" $backup
```

Move the copied backup to a separate, access-controlled device or storage
location, and encrypt it at rest. Periodically test restoring a backup to a
separate test instance. A backup stored only on the same physical device is not
a disaster-recovery plan. `docker compose down -v` deletes the application data
and certificates; do not use `-v` for routine restarts or updates.

## Operating safely

- Keep Docker, the host OS, and the app image patched. Review `docker compose
  logs` after updates.
- Use unique strong passwords. Admins should deactivate accounts when access is
  no longer needed.
- Restrict host administration and backups to authorized operators; enable
  full-disk encryption on the physical device.
- The current login has password-based authentication and server-side
  throttling, but no MFA. Add an MFA/identity-provider layer before treating
  this public-facing service as suitable for highly sensitive data.
- The UI currently loads Excel, date-picker, and font assets from external
  CDNs. The app data/API is self-hosted, but browsers need internet access to
  those assets. Vendor and pin these assets before use in a restricted or
  offline network.
- This app is designed for a small team on one physical host. SQLite provides
  durable single-host storage, not multi-server/high-availability clustering.

## Development checks

Install the pinned dependencies in a virtual environment first:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Then run:

```powershell
python -m unittest discover -s tests -p "test_app.py" -v
```

The included tests cover authentication, CSRF, shared persistence, historical
module retention, stale-save conflicts, input validation, and account
administration.
