from __future__ import annotations

import argparse
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_test_data = tempfile.TemporaryDirectory()
os.environ["TRACKER_DATA_DIR"] = _test_data.name
os.environ["TRACKER_BOOTSTRAP_ADMIN_USERNAME"] = "admin"
os.environ["TRACKER_BOOTSTRAP_ADMIN_PASSWORD"] = "a-secure-test-password-2026"
os.environ["TRACKER_COOKIE_SECURE"] = "false"

import main


class TrackerAppTests(unittest.TestCase):
    def setUp(self) -> None:
        main._initialized = False
        if main.DATABASE.exists():
            main.DATABASE.unlink()
        for suffix in ("-shm", "-wal"):
            Path(str(main.DATABASE) + suffix).unlink(missing_ok=True)
        main.initialize_database()
        self.client = main.app.test_client()

    def _csrf(self) -> str:
        response = self.client.get("/api/csrf")
        self.assertEqual(response.status_code, 200)
        return response.json["token"]

    def _login(self) -> str:
        token = self._csrf()
        response = self.client.post(
            "/api/login",
            json={"username": "admin", "password": "a-secure-test-password-2026"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(response.status_code, 200)
        return self._csrf()

    def test_first_run_prompts_for_admin_in_interactive_terminal(self) -> None:
        main._initialized = False
        if main.DATABASE.exists():
            main.DATABASE.unlink()
        for suffix in ("-shm", "-wal"):
            Path(str(main.DATABASE) + suffix).unlink(missing_ok=True)

        args = argparse.Namespace(
            host="127.0.0.1", port=8000, no_browser=True, backup=None
        )
        with (
            patch.dict(
                os.environ,
                {
                    "TRACKER_BOOTSTRAP_ADMIN_USERNAME": "",
                    "TRACKER_BOOTSTRAP_ADMIN_PASSWORD": "",
                },
            ),
            patch("main.parse_args", return_value=args),
            patch("main.sys.stdin") as stdin,
            patch("builtins.input", return_value="first-admin"),
            patch(
                "main.getpass.getpass",
                side_effect=["secure8!", "secure8!"],
            ),
            patch("main.serve") as serve,
        ):
            stdin.isatty.return_value = True
            self.assertEqual(main.main(), 0)
            serve.assert_called_once()

        with main.connect_db() as db:
            user = db.execute(
                "SELECT username, is_admin FROM users WHERE username = ?",
                ("first-admin",),
            ).fetchone()
        self.assertIsNotNone(user)
        self.assertEqual(user["is_admin"], 1)

    def test_protected_pages_and_api_require_authentication(self) -> None:
        self.assertEqual(self.client.get("/api/health").json["status"], "ok")
        self.assertEqual(self.client.get("/summary.html").status_code, 302)
        self.assertEqual(self.client.get("/api/entries").status_code, 401)
        self.assertEqual(self.client.get("/main.py").status_code, 404)
        self.assertEqual(self.client.get("/Dockerfile").status_code, 404)

    def test_login_requires_csrf_and_rejects_wrong_password(self) -> None:
        response = self.client.post(
            "/api/login",
            json={"username": "admin", "password": "wrong"},
            headers={"X-CSRF-Token": self._csrf()},
        )
        self.assertEqual(response.status_code, 401)
        response = self.client.post(
            "/api/login",
            json={"username": "admin", "password": "a-secure-test-password-2026"},
        )
        self.assertEqual(response.status_code, 403)

    def test_workspace_save_is_shared_versioned_and_archived(self) -> None:
        token = self._login()
        initial = self.client.get("/api/entries").json
        payload = {
            "revision": initial["revision"],
            "entries": [
                {
                    "projectName": "Project Alpha",
                    "modules": [
                        {
                            "moduleName": "Module One",
                            "fwDocs": "FDD",
                            "version": "v1",
                            "checkSum": "abc",
                            "size": "20 KB",
                        }
                    ],
                }
            ],
        }
        saved = self.client.put(
            "/api/entries", json=payload, headers={"X-CSRF-Token": token}
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json["revision"], initial["revision"] + 1)
        self.assertEqual(self.client.get("/api/entries").json["entries"], payload["entries"])
        archived = self.client.get("/api/modules")
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.json["rows"][0]["moduleName"], "Module One")

        stale = self.client.put(
            "/api/entries", json=payload, headers={"X-CSRF-Token": token}
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(len(self.client.get("/api/modules").json["rows"]), 1)

        removed = self.client.put(
            "/api/entries",
            json={"revision": saved.json["revision"], "entries": []},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.client.get("/api/entries").json["entries"], [])
        self.assertEqual(len(self.client.get("/api/modules").json["rows"]), 1)

    def test_admin_can_create_user_and_deactivate_them(self) -> None:
        token = self._login()
        too_short = self.client.post(
            "/api/users",
            json={"username": "short-password-user", "password": "short7!"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(too_short.status_code, 400)
        created = self.client.post(
            "/api/users",
            json={"username": "team-user", "password": "secure8!"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(created.status_code, 201)
        user_id = created.json["id"]
        updated = self.client.patch(
            f"/api/users/{user_id}",
            json={"is_active": False, "is_admin": False},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(updated.status_code, 200)
        reset = self.client.put(
            f"/api/users/{user_id}/password",
            json={"password": "newpass8"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(reset.status_code, 200)
        too_short_reset = self.client.put(
            f"/api/users/{user_id}/password",
            json={"password": "short7!"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(too_short_reset.status_code, 400)
        users = self.client.get("/api/users").json["users"]
        self.assertFalse(next(user for user in users if user["id"] == user_id)["is_active"])

    def test_invalid_workspace_data_does_not_overwrite_saved_data(self) -> None:
        token = self._login()
        response = self.client.put(
            "/api/entries",
            json={"revision": 0, "entries": [{"projectName": "x", "modules": ["bad"]}]},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/entries").json["revision"], 0)

    def test_logout_revokes_server_side_session(self) -> None:
        token = self._login()
        response = self.client.post("/api/logout", headers={"X-CSRF-Token": token})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/entries").status_code, 401)

    def test_only_active_admins_can_manage_users(self) -> None:
        token = self._login()
        created = self.client.post(
            "/api/users",
            json={"username": "team-user", "password": "secure8!"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(created.status_code, 201)
        self.client.post("/api/logout", headers={"X-CSRF-Token": token})
        self.assertEqual(self.client.post(
            "/api/login",
            json={"username": "team-user", "password": "secure8!"},
            headers={"X-CSRF-Token": self._csrf()},
        ).status_code, 200)
        denied = self.client.get("/api/users")
        self.assertEqual(denied.status_code, 403)


if __name__ == "__main__":
    unittest.main()
