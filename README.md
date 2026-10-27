# FW Status Tracker

This guide covers how to prepare, run, deploy, and maintain the FW Status
Tracker. The application is intended for a small team using one physical
server. It runs as a Python web application or in Docker, stores shared data in
SQLite on the host/server, and can use Caddy for HTTPS. It does not require a
cloud application host or cloud database.


## Contents

- [What the application does](#what-the-application-does)
- [How the application works](#how-the-application-works)
- [Requirements and software to install](#requirements-and-software-to-install)
- [Run on a personal Windows computer](#run-on-a-personal-windows-computer)
- [Run on a personal Linux computer](#run-on-a-personal-linux-computer)
- [Deploy to a company physical server with Docker](#deploy-to-a-company-physical-server-with-docker)
- [Deploying inside a private company network](#deploying-inside-a-private-company-network)
- [Move data from the old browser-only version](#move-data-from-the-old-browser-only-version)
- [Back up and recover data](#back-up-and-recover-data)
- [Updates and routine administration](#updates-and-routine-administration)
- [Development and tests](#development-and-tests)
- [Troubleshooting](#troubleshooting)
- [Security and deployment checklist](#security-and-deployment-checklist)

## What the application does

- Tracks firmware project and module information in a browser-based interface.
- Provides a project tracker for entering and editing project/module records.
- Provides a dashboard with project/module metrics, project/module/timeline
  filters, project summaries, and a searchable module-history table.
- Supports importing `.xlsx`, `.xls`, and `.csv` workbooks from the dashboard.
  Imports merge into the shared workspace; modules with a matching name within
  an existing project are treated as duplicates.
- Supports exporting selected module-history rows from the dashboard.
- Supports multiple individual accounts. An administrator can create accounts,
  grant or remove administrator access, deactivate or reactivate accounts, and
  reset passwords.
- Keeps the active workspace shared among signed-in users. A saved edit is
  version-checked; if another user saves first, the stale save is rejected so
  it does not silently overwrite the newer workspace.
- Retains module records in history when they are removed from the active
  workspace.

The old browser-only version kept records separately in each browser. The
server version instead uses one SQLite database on the server, so user browser
storage is not the source of truth.

## How the application works

1. A user opens the tracker in a supported web browser and signs in with an
   account created by an administrator.
2. The browser loads the HTML, CSS, and JavaScript pages from the tracker
   server. The server authenticates the account and keeps a revocable
   server-side session. State-changing requests include a CSRF token.
3. The browser requests and saves shared projects through the tracker API.
   SQLite stores user accounts, the active project workspace, and archived
   module history on the same host.
4. The dashboard calculates and displays metrics and filtered views from the
   shared workspace/history. An import is merged into the active workspace and
   saved back to the server.
5. With the provided Docker deployment, Caddy receives browser traffic on
   ports 80/443, provides HTTPS, and forwards application traffic over a
   private Docker network to the tracker container. The tracker container's
   port is not directly published to the host.

Passwords are not stored as readable text. The server stores a salted,
deliberately slow password hash and checks a submitted password against that
hash at login. This protects account passwords if someone obtains a copy of
the database; it does not replace strong unique passwords or server security.
The minimum accepted password length is 8 characters. Prefer a longer, unique
password, particularly on a network-reachable deployment.

The application has no MFA or built-in organization identity-provider
integration. Login throttling is held in application memory, so it is
best-effort protection for a single running process, not a substitute for an
approved identity/access-control layer.

### Files and persistent data

- `main.py`: Flask application, API, authentication, SQLite access, and
  command-line entry point.
- `index.html`, `summary.html`, `login.html`, `style.css`, `script.js`,
  `summary.js`, `storage.js`: browser interface and API client.
- `assets/`: application images used by the interface.
- `tests/`: backend regression tests.
- `data/tracker.sqlite3`: local-run database (created on first startup).
- `data/session-secret`: generated local signing key (created if no
  `TRACKER_SECRET_KEY` is configured).
- `.env`: Docker deployment settings/secrets; create this from
  `.env.example`. It must remain private and is ignored by Git.

For Docker, the data directory is the persistent named volume `tracker-data`,
not the source-code directory. Caddy's certificate/configuration state is held
in the `caddy-data` and `caddy-config` volumes.

## Requirements and software to install

### To run directly on a personal computer

- Windows 10/11 or a supported Linux distribution.
- Python 3.10 or newer. The Docker image currently uses Python 3.13.
- The Python packages listed in `requirements.txt`; install them in a virtual
  environment using the instructions below.
- A modern browser.
- Internet access during dependency installation. The dashboard also loads
  Excel, date-picker, and font assets from external CDNs, so browsers need
  access to those CDN hosts for those interface features/assets.

Git is optional if you have already received the project folder. If Git is
used, install Git for Windows or the distribution's Git package and clone or
pull the approved repository. In all cases, run commands from the
`fw-status-tracker` project directory—the directory containing `main.py` and
`requirements.txt`, not its parent folder.

Official installation references:

- [Python downloads](https://www.python.org/downloads/)
- [Git downloads](https://git-scm.com/downloads)

### To deploy with Docker on a physical server

- A supported Windows Server or Linux host approved by company IT.
- Docker Engine and the Docker Compose plugin. On Windows, use the organization's
  approved Docker installation (often Docker Desktop for a development
  workstation; confirm licensing and production support before using Desktop
  as a server runtime). On Linux, install Docker Engine and the Compose plugin
  from the official Docker instructions for that distribution.
- Sufficient disk space for the operating system, Docker images, SQLite data,
  Caddy state, logs, and multiple off-host backups. Have IT set disk monitoring
  and a retention policy.
- For public HTTPS with this Caddy configuration: an approved DNS name pointing
  to a reachable public IP, inbound TCP ports 80 and 443 allowed/forwarded to
  the host, and outbound connectivity needed for Docker image retrieval and
  certificate issuance/renewal.
- An IT-approved backup destination separate from the server.

The Docker deployment does not require Python to be installed on the server;
Python and app dependencies are inside the application image. Docker itself
does not install automatically as part of this project.

Official installation references (confirm the exact server OS/version and
company policy before installing):

- [Docker Engine on Linux](https://docs.docker.com/engine/install/)
- [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Run on a personal Windows computer

These steps run the app locally for evaluation or development. The default
server bind address is `127.0.0.1`, so only the same computer can connect.

1. Open PowerShell and move into the project folder. Adjust the path if the
   folder is in a different location:

   ```powershell
   Set-Location 'C:\path\to\Fw-Status-Tracker\fw-status-tracker'
   ```

2. Confirm Python is installed:

   ```powershell
   py --version
   ```

   If `py` is not recognized, install Python 3.10+ from the official Python
   distribution or an IT-approved software portal, and enable the Python
   launcher/PATH option during installation.

3. Create and activate a virtual environment, then install dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   python -m pip install -r requirements.txt
   ```

   If PowerShell blocks activation, use the virtual environment's interpreter
   directly instead:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

   Do not change the machine-wide PowerShell execution policy just to run this
   app; direct interpreter commands avoid activation.

4. Start the app:

   ```powershell
   python .\main.py
   ```

   On the first run, the terminal asks for an administrator username and
   password twice. Password entry is not displayed. Choose at least 8
   characters; prefer a longer unique password. The new account is saved in
   `data\tracker.sqlite3`.

   If you are running the virtual environment without activating it:

   ```powershell
   .\.venv\Scripts\python.exe .\main.py
   ```

5. Open `http://127.0.0.1:8000` in the browser. Keep the PowerShell window open
   while using the application. Press `Ctrl+C` in that window to stop it.

The application creates its `data` folder in the project directory by default.
Keep it if you want to retain the account and records. Do not put the only copy
of important data in a temporary folder.

### Optional: use another computer on a trusted local network

For a short local-network test only, you can bind the development server to
all network interfaces:

```powershell
$env:TRACKER_COOKIE_SECURE = 'false'
python .\main.py --host 0.0.0.0 --port 8000 --no-browser
```

Then browse to `http://<computer-LAN-IP>:8000` from a permitted device. The
computer firewall must allow that traffic. This is plain HTTP and is **not
appropriate for public internet access or sensitive company data**. Do not
port-forward port 8000. Use the Docker/Caddy HTTPS deployment or an
IT-approved internal HTTPS reverse proxy for shared use.

## Run on a personal Linux computer

Install Python 3 and `venv` using the operating system's approved package
manager if they are not already installed. For Debian/Ubuntu-like systems,
the package names are commonly `python3`, `python3-venv`, and `python3-pip`;
other distributions use different package names.

From the project folder:

```bash
python3 --version
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python main.py
```

On first run, enter an initial administrator username and password when
prompted. Browse to `http://127.0.0.1:8000`. Keep the terminal open while
using the app and press `Ctrl+C` to stop it. Linux local data is stored under
`data/` unless `TRACKER_DATA_DIR` is set.

## Deploy to a company physical server with Docker

Use this deployment when the company wants a single self-hosted server and has
approved the network and data handling. Perform server setup with the
responsible IT administrator; do not bypass company change-control or firewall
processes.

### 1. Agree the deployment design with IT

Before installing or exposing anything, decide and document:

- Server owner, support contact, approved OS, patching window, monitoring, and
  who can administer Docker/the host.
- Whether users connect only inside the company network, over an approved VPN,
  or from the public internet.
- The DNS hostname and who owns its DNS record.
- Which TLS certificate approach is approved. The provided Caddy setup
  automatically requests/renews a public certificate; it requires the hostname
  and network reachability described below.
- Firewall rules and the network/security review for ports 80/443. The
  application port 8000 must not be exposed to the host/public network.
- Data classification, authorized users, backup retention, encryption, and
  recovery ownership.
- Whether external CDN access from users' browsers is allowed.

Use one server with persistent storage for a small team. This setup is not
high-availability, does not replicate the database, and is not a multi-server
cluster.

### 2. Prepare the server

1. Install and patch the company-approved OS. Configure time synchronization,
   endpoint protection, disk encryption where required, host firewall, and
   administrative access according to company policy.
2. Install Docker Engine and the Compose plugin using the official Docker
   instructions for the exact server OS/version, or have IT deploy its approved
   runtime. Confirm both commands work:

   ```text
   docker --version
   docker compose version
   ```

3. Assign the host a stable internal address. For public access, IT/network
   staff also need to provide the approved public-IP/DNS/firewall route.
4. Transfer the approved project source to the server using the company's
   authorized method. Do not copy `.env`, database files, or user data into a
   public repository or an unapproved file-sharing service.
5. Open a terminal in the `fw-status-tracker` directory.

### 3. Configure the hostname and secrets

Create a private `.env` file beside `compose.yaml`:

**PowerShell**

```powershell
Copy-Item .env.example .env
notepad .env
```

**Linux**

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set `TRACKER_DOMAIN` to the approved DNS name, for example
`tracker.company.example`. Replace every `CHANGE_ME` placeholder. Generate a
unique signing key and keep it private:

**PowerShell: generate a random key**

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

**Linux: generate a random key**

```bash
openssl rand -base64 48
```

Paste the output as `TRACKER_SECRET_KEY` in `.env`. Set a unique initial
administrator username and password of at least 8 characters; a longer,
randomly generated password is strongly recommended. Protect `.env` with
company-approved file permissions. Never put real credentials into this
README, source control, screenshots, tickets, or chat.

Example shape only—do not use these placeholder values as real secrets:

```dotenv
TRACKER_DOMAIN=tracker.company.example
TRACKER_SECRET_KEY=replace-with-your-own-random-value
TRACKER_BOOTSTRAP_ADMIN_USERNAME=replace-with-your-admin-name
TRACKER_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-unique-password
```

`TRACKER_COOKIE_SECURE` is set to `true` in the provided Docker Compose file.
Do not disable it for an HTTPS deployment.

### 4. Configure DNS, firewall, and TLS

For the supplied public-Caddy configuration:

1. Create the approved DNS A/AAAA record pointing to the server's reachable
   public address. Coordinate with IT/network staff if NAT or a load balancer is
   involved.
2. Allow/forward inbound **TCP 80 and TCP 443** to the host as approved.
   The Compose file also publishes UDP 443 for HTTP/3; if company policy does
   not allow it, remove that UDP mapping before deployment.
3. Allow the server outbound access needed to download the container images
   and for Caddy to obtain and renew its TLS certificate.
4. Ensure the DNS name resolves correctly from outside the company network
   before expecting public certificate issuance.

If the server is behind carrier-grade NAT, inbound access is blocked, or
public DNS cannot reach it, this public certificate setup cannot complete as
configured. Do not expose the app over plain HTTP as a workaround.

### 5. Start and verify the services

From the directory containing `compose.yaml`:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail 100 tracker
docker compose logs --tail 100 caddy
```

The same commands work in a Linux shell. `docker compose up --build -d`
builds the app image and starts the tracker and HTTPS proxy in the background.
The first startup needs configured bootstrap administrator credentials. The
database and generated state are kept in Docker volumes across container
recreation.

Verify the tracker reports healthy:

```powershell
docker compose ps
```

Then, from a permitted client browser, open `https://<TRACKER_DOMAIN>`. Confirm
the browser reports a valid HTTPS connection, sign in, create an ordinary
non-admin account, and verify the tracker and dashboard load. Test a harmless
record change with the responsible team before importing operational data.
Check that port 8000 is not reachable from another device.

After confirming the first admin can sign in, remove
`TRACKER_BOOTSTRAP_ADMIN_USERNAME` and `TRACKER_BOOTSTRAP_ADMIN_PASSWORD` from
`.env` and restart the services:

```powershell
docker compose up -d
```

The account remains in SQLite. Keep `TRACKER_SECRET_KEY` stable: changing it
invalidates browser sessions and can sign users out. Keep the data and Caddy
volumes; do not use `docker compose down -v` for routine maintenance.

### 6. Create user accounts

Sign in as the initial administrator and use **Account Administration** on
the dashboard to create individual accounts. Grant administrator rights only
when needed. Deactivate accounts when access is no longer appropriate; password
resets sign that user's existing sessions out. Do not share one team account.

### Public-server networking note

Public internet availability is a company security decision, not simply a
Docker setting. The company may require access through VPN, zero-trust access,
an identity-aware gateway, or a managed reverse proxy. Do not create router
port-forwarding or firewall exceptions without explicit authorization. If the
company does not permit inbound public access, use the approved internal/VPN
design instead.

## Deploying inside a private company network

The default Caddyfile requests a publicly trusted certificate for
`TRACKER_DOMAIN`; this may not work for an internal-only hostname or a server
that cannot be reached by a public certificate authority. Ask IT to choose one
of these supported organizational approaches before deployment:

- Use an organization-owned DNS name and a certificate issuance/validation
  method approved by IT.
- Terminate HTTPS at the company's existing reverse proxy/load balancer, with
  the proxy forwarding to the tracker on an isolated internal network. Ensure
  the tracker port is reachable only from that proxy and configure trusted
  proxy behavior safely before changing the provided deployment.
- Configure an IT-approved internal certificate authority and reverse proxy.

The supplied app trusts proxy headers for one proxy hop. Do not place it behind
an arbitrary chain of proxies or expose the app port directly without review.
Do not switch secure cookies off to make an internal HTTP deployment appear to
work; use approved HTTPS.

## Move data from the old browser-only version

The old version stored separate data in each user's browser, not on the old
static server. It cannot be automatically found by the new server.

1. In each old browser that contains records, open the old dashboard.
2. Expand **All Module Details**, select the rows to retain, and click
   **Export Selected**.
3. Sign in to the new tracker and open its dashboard.
4. Select **Import Excel**, choose the exported workbook, and review the
   imported projects/modules.
5. Repeat for each browser containing records. Keep the original exports until
   the new data has been checked and backed up.

The import merges module rows into matching project names. Existing module
names within a project may be considered duplicates and not imported again.
Check workbook headers/content and the resulting dashboard carefully before
retiring the old browser data.

## Back up and recover data

Create an online-consistent SQLite backup with the app's backup command. Run
from the project directory:

```powershell
docker compose exec tracker mkdir -p /tmp/tracker-backups
$backup = "fw-status-tracker-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite3"
docker compose exec tracker python main.py --backup "/tmp/tracker-backups/$backup"
docker compose cp "tracker:/tmp/tracker-backups/$backup" ".\$backup"
```

The backup command refuses to overwrite an existing destination. Copy the
result to a separate, access-controlled backup location, encrypt it at rest,
and apply a company-approved retention policy. A backup kept only on the same
server is not disaster recovery. Test recovery periodically using a separate
test instance and never overwrite production data during a test.

The SQLite backup contains users, workspace entries, and module history. It
does not include the `.env` file, Docker images, Caddy certificate volumes, or
the automatically generated `session-secret` file. Back up and protect the
signing key/configuration separately under company policy; losing the signing
key invalidates existing sessions, though users can sign in again if the
database and passwords remain available. Do not publish secrets with backups.

For a production restore, arrange a maintenance window, stop writes, preserve
the current database/volume, and have the Docker/IT administrator restore the
selected backup into the `tracker-data` volume with correct ownership for the
container's non-root `tracker` user. Restart and verify the restored app before
allowing users back in. Avoid copying a live raw SQLite database file while it
is being written; use the backup command instead.

## Updates and routine administration

### Update the application

1. Confirm a recent backup exists and is stored off-host.
2. Obtain the approved updated source from the trusted repository/release.
3. Review release changes and run the tests in a staging environment if
   available.
4. From the updated project directory, rebuild and restart:

   ```powershell
   docker compose up --build -d
   docker compose ps
   docker compose logs --tail 100 tracker
   docker compose logs --tail 100 caddy
   ```

5. Verify HTTPS login, dashboard load, and a non-destructive save. Retain a
   rollback plan and the pre-update backup.

Do not remove named volumes during an update. `docker compose down -v` deletes
the application database, signing-key state, and Caddy state.

### Stop, restart, and inspect

```powershell
docker compose ps
docker compose logs --tail 100 tracker
docker compose logs --tail 100 caddy
docker compose restart
docker compose stop
docker compose start
```

Run these from the deployment directory. `docker compose stop` preserves data;
removing containers without deleting volumes also preserves named-volume data.

### Administration tasks

- Review active accounts periodically and deactivate users who no longer need
  access.
- Reset passwords when required. A reset revokes that account's sessions.
- Keep an inventory of who is responsible for backups and recovery.
- Monitor host disk space, Docker health, certificate renewal, logs, and
  backup completion.
- Apply OS and Docker security updates through company change control.
- Keep `.env`, database backups, and signing-key material access restricted.

## Development and tests

Run these commands from the `fw-status-tracker` directory.

### Windows PowerShell

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

For local HTTP development, set the secure-cookie option off only in that
PowerShell process:

```powershell
$env:TRACKER_COOKIE_SECURE = 'false'
python .\main.py
```

### Linux/macOS shell

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
TRACKER_COOKIE_SECURE=false python main.py
```

On a fresh local database, `main.py` prompts for an initial administrator when
launched from an interactive terminal. Noninteractive/container starts require
`TRACKER_BOOTSTRAP_ADMIN_USERNAME` and `TRACKER_BOOTSTRAP_ADMIN_PASSWORD` to be
configured. The app defaults to `127.0.0.1:8000`; command-line options include
`--host`, `--port`, and `--no-browser`. Use `--backup PATH` to create a
consistent SQLite backup and exit.

The regression tests cover authentication, CSRF checks, shared persistence,
history retention, stale-save conflicts, validation, account administration,
and first-run administrator setup. Tests use a temporary database and do not
need the production database.

## Troubleshooting

### “No users exist. Set TRACKER_BOOTSTRAP_ADMIN_USERNAME...”

The selected database has no administrator yet.

- For a personal terminal run, launch `python main.py` interactively and
  complete the first-run prompts. Use at least 8 characters; a longer unique
  password is recommended.
- For Docker/noninteractive startup, set both bootstrap variables in `.env`
  and run `docker compose up -d`.
- Check that you are running the expected copy of the project and using the
  expected data directory/volume. A new empty database requires first-run
  setup; an existing database should be preserved rather than deleted.
- Do not delete `data/` or the `tracker-data` volume to resolve this message.
  That can permanently remove existing records.

### Cannot open the page

- Local run: check the terminal for startup errors and browse to
  `http://127.0.0.1:8000`.
- Docker run: use `docker compose ps` and inspect tracker/Caddy logs.
- Public deployment: verify DNS, TCP 80/443 firewall/NAT rules, Caddy
  certificate issuance, and whether a company proxy blocks the traffic.
- Do not expose port 8000 to solve a reverse-proxy or firewall problem.

### Login does not work

- Confirm the username/password and that the account is active.
- Confirm the browser URL and deployment point to the correct server/database.
- Restarting the app does not create another administrator if one already
  exists. Use an existing administrator's account-management flow for resets.
- If the database was restored, confirm it is the intended backup. Do not
  delete the database as a password-reset method.

### Docker says the environment variable is missing

Ensure `.env` is beside `compose.yaml`, `TRACKER_DOMAIN` is set to the
approved hostname, and no `CHANGE_ME` placeholders remain in the secrets.
Validate with `docker compose config --quiet`; do not paste secret values into
support messages.

### Browser assets do not load

Excel, date-picker, and font assets are currently requested from external CDN
URLs. The app/API may still be hosted internally, but those features or fonts
can be unavailable if client browsers cannot reach the CDN. Request an
approved network exception or have the assets vendored and reviewed for
restricted/offline environments.

## Security and deployment checklist

Before users begin using a server deployment, confirm all of the following:

- [ ] Company IT/security approved the application, server, hosting location,
  data classification, network path, and user access.
- [ ] The host OS and Docker runtime are supported, patched, monitored, and
  administered by authorized staff.
- [ ] `.env` contains a unique random `TRACKER_SECRET_KEY`, approved hostname,
  and unique initial admin credentials; file permissions are restricted.
- [ ] Bootstrap credentials were removed from `.env` after the first admin
  successfully signed in.
- [ ] HTTPS is valid in the browser. Secure cookies remain enabled.
- [ ] Only approved proxy ports are reachable. Port 8000 is not exposed.
- [ ] Access to the app is limited to approved users through the network and
  account controls approved by IT.
- [ ] At least one individual administrator account is available and account
  recovery ownership is known.
- [ ] A consistent backup has been copied off-host, protected, and included in
  a tested recovery procedure.
- [ ] The server's disk, Docker health, logs, backup status, and certificate
  renewal are monitored.
- [ ] External CDN access is allowed, or the organization has approved a plan
  to vendor the assets.
- [ ] Users understand that this is a single-host SQLite application, has no
  MFA, and is not currently designed for high availability or multi-server
  scaling.



## Option 2  simple deplyment over network

- current computer's local network address is 172.20.209.52.

- Step 1: Start the application with the network flags

  - Instead of launching the application normally, you must explicitly tell Python to bind to all network cards and open up communication ports. In your PowerShell window, run:
powershell
python main.py --host 0.0.0.0 --port 8000
  
  - (Keep this terminal open. If it is still asking for your Admin username/password from the first-run configuration, complete that step first so the server can fully start).

Step 2: How teammates can access it

  - Once the server is running, anyone sitting near you who is connected to the exact same office network branch can open their browser and type your IP address directly into the URL bar:

http://172.20.209.52:8000


### ⚠️ Corporate Network Security Caveats

Because you are on a highly secure enterprise network, two common roadblocks might prevent your teammates from opening that link:
1. Windows Defender Firewall: Your local computer's built-in Windows firewall might block inbound requests on port 8000. If your coworkers get a "Connection Timed Out" error, you would temporarily need to open your Windows Firewall settings and add an Inbound Rule allowing traffic on TCP Port 8000.
2. Network Isolation: Enterprise networks often implement "client isolation," which stops corporate laptops from communicating directly with each other even if they are on the same floor.

