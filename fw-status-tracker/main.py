from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import threading
import webbrowser
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Generator

from flask import Flask, abort, jsonify, redirect, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash
from waitress import serve

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("TRACKER_DATA_DIR", ROOT / "data")).resolve()
DATABASE = DATA_DIR / "tracker.sqlite3"
SESSION_TTL = timedelta(hours=8)
MAX_REQUEST_BYTES = 2 * 1024 * 1024

app = Flask(__name__, static_folder=None)
app.config.update(
    MAX_CONTENT_LENGTH=MAX_REQUEST_BYTES,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=os.environ.get("TRACKER_COOKIE_SECURE", "true").lower() not in {"0", "false", "no"},
    PERMANENT_SESSION_LIFETIME=SESSION_TTL,
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

_initialization_lock = threading.Lock()
_initialized = False
_login_attempt_lock = threading.Lock()
_login_failures: dict[str, deque[datetime]] = defaultdict(deque)
LOGIN_WINDOW = timedelta(minutes=15)
MAX_LOGIN_FAILURES = 10


class BootstrapAdminRequired(RuntimeError):
    """Raised when a fresh database has no configured initial administrator."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _secret_key() -> str:
    configured = os.environ.get("TRACKER_SECRET_KEY")
    if configured:
        if len(configured) < 32 or configured.startswith("CHANGE_ME"):
            raise RuntimeError(
                "TRACKER_SECRET_KEY must be a unique random value with at least 32 characters."
            )
        return configured

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    key_file = DATA_DIR / "session-secret"
    if not key_file.exists():
        try:
            key_file.write_text(secrets.token_urlsafe(48), encoding="utf-8")
            if os.name != "nt":
                key_file.chmod(0o600)
        except FileExistsError:
            pass
    return key_file.read_text(encoding="utf-8").strip()


app.secret_key = _secret_key()


@contextmanager
def connect_db() -> Generator[sqlite3.Connection, None, None]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 15000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(bootstrap_admin: tuple[str, str] | None = None) -> None:
    global _initialized
    with _initialization_lock:
        if _initialized:
            return
        with connect_db() as db:
            db.execute("PRAGMA journal_mode = WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY,
                    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    is_admin INTEGER NOT NULL DEFAULT 0,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    csrf_token TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
                CREATE TABLE IF NOT EXISTS workspace (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    revision INTEGER NOT NULL,
                    entries_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS archived_modules (
                    id INTEGER PRIMARY KEY,
                    project_key TEXT NOT NULL,
                    module_key TEXT NOT NULL,
                    version_key TEXT NOT NULL,
                    fw_docs_key TEXT NOT NULL,
                    project_name TEXT NOT NULL,
                    module_name TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    UNIQUE(project_key, module_key, version_key, fw_docs_key)
                );
                """
            )
            db.execute(
                "INSERT OR IGNORE INTO workspace (id, revision, entries_json) "
                "VALUES (1, 0, '[]')"
            )
            user_count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if user_count == 0:
                username, password = bootstrap_admin or (
                    os.environ.get("TRACKER_BOOTSTRAP_ADMIN_USERNAME", "").strip(),
                    os.environ.get("TRACKER_BOOTSTRAP_ADMIN_PASSWORD", ""),
                )
                if (
                    not username
                    or username.startswith("CHANGE_ME")
                    or len(password) < 8
                    or password.startswith("CHANGE_ME")
                ):
                    raise BootstrapAdminRequired(
                        "No users exist. Set TRACKER_BOOTSTRAP_ADMIN_USERNAME and "
                        "TRACKER_BOOTSTRAP_ADMIN_PASSWORD (a unique value of at least 8 characters) "
                        "for the initial administrator, or start main.py in an interactive terminal "
                        "to create one."
                    )
                db.execute(
                    "INSERT INTO users (username, password_hash, is_admin, created_at) "
                    "VALUES (?, ?, 1, ?)",
                    (username, generate_password_hash(password), utc_now().isoformat()),
                )
        _initialized = True


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def current_session(db: sqlite3.Connection) -> sqlite3.Row | None:
    token = session.get("tracker_session")
    if not isinstance(token, str):
        return None
    return db.execute(
        """
        SELECT sessions.token_hash, sessions.csrf_token, users.id, users.username,
               users.is_admin, users.is_active
        FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        """,
        (_token_digest(token), utc_now().isoformat()),
    ).fetchone()


def require_auth(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        initialize_database()
        with connect_db() as db:
            user = current_session(db)
            if user is None or not user["is_active"]:
                session.clear()
                return jsonify(error="Authentication required."), 401
            request.environ["tracker.user"] = user
        return view(*args, **kwargs)

    return wrapped


def require_admin(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    @require_auth
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        user = request.environ["tracker.user"]
        if not user["is_admin"]:
            return jsonify(error="Administrator access required."), 403
        return view(*args, **kwargs)

    return wrapped


@app.before_request
def enforce_csrf() -> Any:
    if not request.path.startswith("/api/") or request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    initialize_database()
    with connect_db() as db:
        auth_session = current_session(db)
        expected = (
            auth_session["csrf_token"]
            if auth_session is not None
            else session.get("preauth_csrf")
        )
    supplied = request.headers.get("X-CSRF-Token", "")
    if not expected or not hmac.compare_digest(str(expected), supplied):
        return jsonify(error="The security token expired. Refresh the page and try again."), 403
    return None


@app.get("/api/health")
def health() -> Any:
    initialize_database()
    with connect_db() as db:
        db.execute("SELECT 1")
    return jsonify(status="ok")


@app.get("/api/csrf")
def csrf_token() -> Any:
    initialize_database()
    with connect_db() as db:
        auth_session = current_session(db)
        if auth_session:
            return jsonify(token=auth_session["csrf_token"])
    token = session.get("preauth_csrf")
    if not token:
        token = secrets.token_urlsafe(32)
        session["preauth_csrf"] = token
    return jsonify(token=token)


@app.get("/api/session")
@require_auth
def session_info() -> Any:
    user = request.environ["tracker.user"]
    return jsonify(
        user={
            "id": user["id"],
            "username": user["username"],
            "is_admin": bool(user["is_admin"]),
        }
    )


@app.post("/api/login")
def login() -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Invalid login request."), 400
    username = payload.get("username")
    password = payload.get("password")
    if (
        not isinstance(username, str)
        or len(username) > 80
        or not isinstance(password, str)
        or len(password) > 1024
    ):
        return jsonify(error="Invalid username or password."), 401
    address = request.remote_addr or "unknown"
    now = utc_now()
    with _login_attempt_lock:
        failures = _login_failures[address]
        while failures and now - failures[0] >= LOGIN_WINDOW:
            failures.popleft()
        if len(failures) >= MAX_LOGIN_FAILURES:
            return jsonify(error="Too many login attempts. Try again later."), 429
    initialize_database()
    with connect_db() as db:
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now.isoformat(),))
        user = db.execute(
            "SELECT id, username, password_hash, is_admin, is_active FROM users "
            "WHERE username = ? COLLATE NOCASE",
            (username.strip(),),
        ).fetchone()
        if user is None or not user["is_active"] or not check_password_hash(
            user["password_hash"], password
        ):
            with _login_attempt_lock:
                _login_failures[address].append(now)
            return jsonify(error="Invalid username or password."), 401
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        expires = (utc_now() + SESSION_TTL).isoformat()
        db.execute(
            "INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) "
            "VALUES (?, ?, ?, ?)",
            (_token_digest(token), user["id"], csrf, expires),
        )
    with _login_attempt_lock:
        _login_failures.pop(address, None)
    session.clear()
    session["tracker_session"] = token
    session.permanent = True
    return jsonify(
        user={
            "id": user["id"],
            "username": user["username"],
            "is_admin": bool(user["is_admin"]),
        }
    )


@app.post("/api/logout")
@require_auth
def logout() -> Any:
    auth_user = request.environ["tracker.user"]
    with connect_db() as db:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (auth_user["token_hash"],))
    session.clear()
    return jsonify(status="ok")


def _validated_entries(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > 10000:
        raise ValueError("Entries must be a list with no more than 10,000 projects.")
    entries: list[dict[str, Any]] = []
    for entry in value:
        if not isinstance(entry, dict) or not isinstance(entry.get("projectName"), str):
            raise ValueError("Each project must contain a projectName string.")
        project_name = entry["projectName"].strip()
        modules = entry.get("modules", [])
        if len(project_name) > 300 or not isinstance(modules, list) or len(modules) > 1000:
            raise ValueError("Project names or module lists exceed their allowed size.")
        clean_modules = []
        for module in modules:
            if not isinstance(module, dict):
                raise ValueError("Each module must be an object.")
            clean_module = {}
            for key, item in module.items():
                if not isinstance(key, str) or len(key) > 100:
                    raise ValueError("Module field names must be short strings.")
                if not isinstance(item, (str, int, float, bool, type(None))):
                    raise ValueError("Module field values must be primitive values.")
                if isinstance(item, str) and len(item) > 2000:
                    raise ValueError("A module field exceeds the allowed size.")
                clean_module[key] = item
            clean_modules.append(clean_module)
        entries.append({"projectName": project_name, "modules": clean_modules})
    return entries


def _archive_module(db: sqlite3.Connection, project_name: str, module: dict[str, Any]) -> None:
    module_name = str(module.get("moduleName") or "").strip()
    if not module_name:
        return
    version = str(module.get("version") or "").strip()
    fw_docs = str(module.get("fwDocs") or "").strip()
    db.execute(
        """
        INSERT INTO archived_modules (
            project_key, module_key, version_key, fw_docs_key,
            project_name, module_name, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_key, module_key, version_key, fw_docs_key)
        DO UPDATE SET project_name=excluded.project_name,
                      module_name=excluded.module_name,
                      payload_json=excluded.payload_json
        """,
        (
            project_name.casefold(),
            module_name.casefold(),
            version.casefold(),
            fw_docs.casefold(),
            project_name,
            module_name,
            json.dumps(module, ensure_ascii=False),
        ),
    )


@app.route("/api/entries", methods=["GET", "PUT"])
@require_auth
def entries() -> Any:
    initialize_database()
    with connect_db() as db:
        if request.method == "PUT":
            db.execute("BEGIN IMMEDIATE")
        record = db.execute(
            "SELECT revision, entries_json FROM workspace WHERE id = 1"
        ).fetchone()
        if request.method == "GET":
            return jsonify(revision=record["revision"], entries=json.loads(record["entries_json"]))

        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(error="Invalid save request."), 400
        try:
            clean_entries = _validated_entries(payload.get("entries"))
        except (ValueError, TypeError) as exc:
            return jsonify(error=str(exc)), 400
        revision = payload.get("revision")
        if not isinstance(revision, int) or revision != record["revision"]:
            return jsonify(
                error="The tracker changed since you opened it. Reload to avoid overwriting another user's changes.",
                revision=record["revision"],
            ), 409
        new_revision = record["revision"] + 1
        db.execute(
            "UPDATE workspace SET revision = ?, entries_json = ? WHERE id = 1",
            (new_revision, json.dumps(clean_entries, ensure_ascii=False)),
        )
        for entry in clean_entries:
            for module in entry["modules"]:
                _archive_module(db, entry["projectName"], module)
    return jsonify(revision=new_revision, entries=clean_entries)


@app.get("/api/modules")
@require_auth
def modules() -> Any:
    initialize_database()
    with connect_db() as db:
        records = db.execute(
            "SELECT project_name, payload_json FROM archived_modules ORDER BY id"
        ).fetchall()
    rows = []
    for record in records:
        module = json.loads(record["payload_json"])
        rows.append(
            {
                "projectName": record["project_name"],
                **module,
                "authoNum": module.get("authoNum")
                or _build_autho_num(module.get("authoNumSuffix", "")),
            }
        )
    return jsonify(rows=rows)


def _build_autho_num(suffix: Any) -> str:
    digits = "".join(character for character in str(suffix or "") if character.isdigit())[:5]
    return "00000000000" + digits.zfill(5) if digits else ""


@app.route("/api/users", methods=["GET", "POST"])
@require_admin
def users() -> Any:
    initialize_database()
    if request.method == "GET":
        with connect_db() as db:
            rows = db.execute(
                "SELECT id, username, is_admin, is_active, created_at FROM users ORDER BY username"
            ).fetchall()
        return jsonify(
            users=[
                {
                    "id": row["id"],
                    "username": row["username"],
                    "is_admin": bool(row["is_admin"]),
                    "is_active": bool(row["is_active"]),
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
        )
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Invalid user account request."), 400
    username = payload.get("username")
    password = payload.get("password")
    if not isinstance(username, str) or not 1 <= len(username.strip()) <= 80:
        return jsonify(error="Username must contain 1 to 80 characters."), 400
    if not isinstance(password, str) or not 8 <= len(password) <= 256:
        return jsonify(error="Password must contain 8 to 256 characters."), 400
    if not isinstance(payload.get("is_admin", False), bool):
        return jsonify(error="is_admin must be a boolean."), 400
    try:
        with connect_db() as db:
            cursor = db.execute(
                "INSERT INTO users (username, password_hash, is_admin, created_at) "
                "VALUES (?, ?, ?, ?)",
                (
                    username.strip(),
                    generate_password_hash(password),
                    int(bool(payload.get("is_admin"))),
                    utc_now().isoformat(),
                ),
            )
    except sqlite3.IntegrityError:
        return jsonify(error="That username already exists."), 409
    return jsonify(id=cursor.lastrowid, username=username.strip()), 201


@app.patch("/api/users/<int:user_id>")
@require_admin
def update_user(user_id: int) -> Any:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not all(
        isinstance(payload.get(field), bool) for field in ("is_active", "is_admin")
    ):
        return jsonify(error="Provide boolean is_active and is_admin values."), 400
    acting_user = request.environ["tracker.user"]
    if user_id == acting_user["id"] and (
        not payload["is_active"] or not payload["is_admin"]
    ):
        return jsonify(error="You cannot deactivate or remove your own administrator access."), 400
    with connect_db() as db:
        target = db.execute(
            "SELECT is_admin, is_active FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if target is None:
            return jsonify(error="User not found."), 404
        if target["is_admin"] and target["is_active"] and (
            not payload["is_active"] or not payload["is_admin"]
        ):
            active_admins = db.execute(
                "SELECT COUNT(*) FROM users WHERE is_admin = 1 AND is_active = 1"
            ).fetchone()[0]
            if active_admins <= 1:
                return jsonify(error="The last active administrator cannot be removed."), 400
        cursor = db.execute(
            "UPDATE users SET is_active = ?, is_admin = ? WHERE id = ?",
            (int(payload["is_active"]), int(payload["is_admin"]), user_id),
        )
        if cursor.rowcount == 0:
            return jsonify(error="User not found."), 404
        if not payload["is_active"]:
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return jsonify(status="ok")


@app.put("/api/users/<int:user_id>/password")
@require_admin
def reset_user_password(user_id: int) -> Any:
    payload = request.get_json(silent=True)
    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str) or not 8 <= len(password) <= 256:
        return jsonify(error="Password must contain 8 to 256 characters."), 400
    with connect_db() as db:
        cursor = db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(password), user_id),
        )
        if cursor.rowcount == 0:
            return jsonify(error="User not found."), 404
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return jsonify(status="ok")


@app.get("/")
def home() -> Any:
    return redirect("/summary.html" if session.get("tracker_session") else "/login.html")


@app.get("/<path:filename>")
def static_files(filename: str) -> Any:
    public_files = {
        "login.html",
        "index.html",
        "summary.html",
        "style.css",
        "script.js",
        "summary.js",
        "storage.js",
    }
    if filename not in public_files and not (
        filename.startswith("assets/images/")
        and Path(filename).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".svg"}
    ):
        abort(404)
    if filename in {"index.html", "summary.html"}:
        initialize_database()
        with connect_db() as db:
            auth_session = current_session(db)
        if auth_session is None or not auth_session["is_active"]:
            return redirect("/login.html")
    return send_from_directory(ROOT, filename)


@app.errorhandler(413)
def request_too_large(_: Any) -> Any:
    return jsonify(error="The uploaded request is too large."), 413


@app.after_request
def add_security_headers(response: Any) -> Any:
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = "no-store"
    return response


def open_browser(url: str) -> None:
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()


def prompt_for_bootstrap_admin() -> tuple[str, str]:
    print("First-run setup: create the initial tracker administrator.")
    username = input("Administrator username: ").strip()
    password = getpass.getpass("Administrator password (at least 8 characters): ")
    confirmation = getpass.getpass("Confirm administrator password: ")
    if not username or username.startswith("CHANGE_ME"):
        raise ValueError("Administrator username must not be empty or a placeholder.")
    if len(password) < 8 or password.startswith("CHANGE_ME"):
        raise ValueError("Administrator password must be at least 8 characters.")
    if password != confirmation:
        raise ValueError("The passwords do not match.")
    return username, password


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the FW Status Tracker web application.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="Port to use. Default: 8000")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    parser.add_argument("--backup", metavar="PATH", help="Create a consistent SQLite backup and exit")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not (1 <= args.port <= 65535):
        print("Error: port must be between 1 and 65535.", file=sys.stderr)
        return 2
    try:
        initialize_database()
    except BootstrapAdminRequired as exc:
        if not sys.stdin.isatty():
            print(f"Startup failed: {exc}", file=sys.stderr)
            return 1
        try:
            username, password = prompt_for_bootstrap_admin()
            initialize_database((username, password))
        except (OSError, RuntimeError, ValueError, sqlite3.Error) as setup_error:
            print(f"Startup failed: {setup_error}", file=sys.stderr)
            return 1
    except (OSError, RuntimeError, sqlite3.Error) as exc:
        print(f"Startup failed: {exc}", file=sys.stderr)
        return 1
    if args.backup:
        destination = Path(args.backup).expanduser().resolve()
        try:
            if destination == DATABASE or destination.exists():
                raise FileExistsError(f"Backup destination already exists: {destination}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with connect_db() as source, sqlite3.connect(destination) as backup:
                source.backup(backup)
        except (OSError, sqlite3.Error) as exc:
            print(f"Backup failed: {exc}", file=sys.stderr)
            return 1
        print(f"Database backup created at {destination}")
        return 0
    url = f"http://{args.host}:{args.port}/"
    print(f"FW Status Tracker listening on {url}")
    if not args.no_browser:
        open_browser(url)
    serve(app, host=args.host, port=args.port, threads=8)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
