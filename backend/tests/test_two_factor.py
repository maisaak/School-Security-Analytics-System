from fastapi.testclient import TestClient

from app.api import auth
from app.core.accounts import hash_password
from app.db.models import Employee
from app.db.session import SessionLocal
from app.main import app

PASSWORD = "test-password-12345"


def browser_for_employee(client):
    auth._attempts.clear()
    with SessionLocal() as db:
        db.add(Employee(username="twofactor", display_name="Employee", role="viewer", password_hash=hash_password(PASSWORD)))
        db.commit()
    browser = TestClient(app, headers={"X-Requested-With": "SchoolSecurity"})
    assert browser.post("/api/auth/login", json={"username": "twofactor", "password": PASSWORD}).status_code == 200
    return browser


def setup(browser):
    response = browser.post("/api/auth/2fa/setup", json={"current_password": PASSWORD})
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    return response.json()["secret"]


def test_enable_requires_password_pending_code_and_revokes_other_sessions(client, monkeypatch):
    monkeypatch.setattr(auth.wall_time, "time", lambda: 1800000000)
    browser = browser_for_employee(client)
    other = TestClient(app, headers={"X-Requested-With": "SchoolSecurity"})
    assert other.post("/api/auth/login", json={"username": "twofactor", "password": PASSWORD}).status_code == 200
    assert browser.post("/api/auth/2fa/setup", json={"current_password": "wrong"}).status_code == 401
    secret = setup(browser)
    response = browser.post("/api/auth/2fa/enable", data={"code": auth._totp(secret)})
    assert response.status_code == 200, response.text
    assert browser.get("/api/auth/2fa").json()["enabled"]
    assert other.get("/api/auth/session").status_code == 401
    assert browser.post("/api/auth/2fa/setup", json={"current_password": PASSWORD}).status_code == 409
    with SessionLocal() as db:
        user = db.query(Employee).filter_by(username="twofactor").one()
        assert user.totp_secret == secret and user.totp_enabled
        assert user.totp_pending_secret is None


def test_replay_denied_and_disable_needs_password_and_fresh_code(client, monkeypatch):
    now = [1800000000]
    monkeypatch.setattr(auth.wall_time, "time", lambda: now[0])
    browser = browser_for_employee(client)
    secret = setup(browser)
    code = auth._totp(secret)
    assert browser.post("/api/auth/2fa/enable", data={"code": code}).status_code == 200
    auth._attempts.clear()
    fresh = TestClient(app, headers={"X-Requested-With": "SchoolSecurity"})
    credentials = {"username": "twofactor", "password": PASSWORD}
    assert fresh.post("/api/auth/login", json={**credentials, "totp_code": code}).status_code == 401
    now[0] += 30
    code = auth._totp(secret)
    assert fresh.post("/api/auth/login", json={**credentials, "totp_code": code}).status_code == 200
    assert browser.post("/api/auth/2fa/disable", json={"current_password": PASSWORD, "code": code}).status_code == 422
    now[0] += 30
    code = auth._totp(secret)
    assert browser.post("/api/auth/2fa/disable", json={"current_password": "wrong", "code": code}).status_code == 401
    assert browser.post("/api/auth/2fa/disable", json={"current_password": PASSWORD, "code": code}).status_code == 200
    assert fresh.get("/api/auth/session").status_code == 401
    assert browser.get("/api/auth/2fa").json()["enabled"] is False


def test_pending_setup_expires_and_csrf_remains_required(client, monkeypatch):
    now = [1800000000]
    monkeypatch.setattr(auth.wall_time, "time", lambda: now[0])
    browser = browser_for_employee(client)
    secret = setup(browser)
    now[0] += 601
    assert browser.post("/api/auth/2fa/enable", data={"code": auth._totp(secret)}).status_code == 422
    browser.headers.pop("X-Requested-With")
    assert browser.post("/api/auth/2fa/setup", json={"current_password": PASSWORD}).status_code == 403


def test_viewer_can_manage_own_password_and_sessions_not_other_accounts(client):
    browser = browser_for_employee(client)
    assert browser.post("/api/auth/password", json={"current_password": "wrong", "new_password": "new-password-12345"}).status_code == 401
    assert browser.post("/api/employees", json={"username": "forbidden"}).status_code == 403
    assert browser.post("/api/auth/sessions/revoke-all").status_code == 200
    assert browser.get("/api/auth/session").status_code == 401


def test_security_attempt_limit(client):
    browser = browser_for_employee(client)
    for _ in range(5):
        assert browser.post("/api/auth/2fa/setup", json={"current_password": "wrong"}).status_code == 401
    assert browser.post("/api/auth/2fa/setup", json={"current_password": PASSWORD}).status_code == 429


def test_compatibility_columns_idempotent(monkeypatch):
    from sqlalchemy import create_engine, inspect, text
    import app.main as main
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE cameras (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE violations (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE employees (id INTEGER PRIMARY KEY, totp_secret VARCHAR(64), totp_enabled BOOLEAN)"))
        connection.execute(text("INSERT INTO employees VALUES (1, 'PRESERVED', 1)"))
    monkeypatch.setattr(main, "engine", engine)
    main._ensure_compatibility_columns()
    main._ensure_compatibility_columns()
    assert {"totp_pending_secret", "totp_pending_expires", "totp_last_counter"} <= {column["name"] for column in inspect(engine).get_columns("employees")}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT totp_secret, totp_enabled FROM employees")).one() == ("PRESERVED", 1)
    engine.dispose()
