import logging
import shutil
import subprocess
import sys

import pytest
from pydantic import SecretStr
from fastapi.testclient import TestClient

from app.core.accounts import check_password
from app.core.bootstrap import bootstrap_admin
from app.core.config import PROJECT_ROOT, settings
from app.db.models import Employee
from app.db.session import SessionLocal
from app.main import app


def test_bootstrap_creates_hashed_admin_and_preserves_existing(client, monkeypatch, caplog):
    password = 'first-start-password-123'
    monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_PASSWORD', SecretStr(password))
    monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_USERNAME', 'bootstrap-admin')
    with caplog.at_level(logging.INFO):
        bootstrap_admin()
        with SessionLocal() as db:
            user = db.query(Employee).filter_by(username='bootstrap-admin').one()
            assert user.role == 'admin' and user.is_active
            assert check_password(password, user.password_hash)
            assert password not in user.password_hash
            original_hash = user.password_hash
            user.role = 'viewer'
            user.is_active = False
            user.totp_enabled = True
            user.totp_secret = 'keep-secret'
            db.commit()
        monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_PASSWORD', SecretStr('replacement-password-123'))
        bootstrap_admin()
    with SessionLocal() as db:
        user = db.query(Employee).filter_by(username='bootstrap-admin').one()
        assert user.password_hash == original_hash
        assert user.role == 'viewer' and not user.is_active
        assert user.totp_enabled and user.totp_secret == 'keep-secret'
    assert password not in caplog.text and 'replacement-password-123' not in caplog.text


@pytest.mark.parametrize('username,password', [('Bad Login', 'long-password-123'), ('admin', 'short'), ('admin', 'x' * 257)])
def test_bootstrap_invalid_config_does_not_create_user(client, monkeypatch, username, password):
    monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_USERNAME', username)
    monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_PASSWORD', SecretStr(password))
    with pytest.raises(RuntimeError) as error:
        bootstrap_admin()
    assert password not in str(error.value)
    with SessionLocal() as db:
        assert db.query(Employee).count() == 0


def test_bootstrap_disabled(client):
    bootstrap_admin()
    with SessionLocal() as db:
        assert db.query(Employee).count() == 0


def test_lifespan_bootstrap_can_login(client, monkeypatch):
    from app.api.auth import _attempts
    monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_USERNAME', 'first-admin')
    monkeypatch.setattr(settings, 'BOOTSTRAP_ADMIN_PASSWORD', SecretStr('first-login-password-123'))
    _attempts.clear()
    with TestClient(app, headers={'X-Requested-With': 'SchoolSecurity'}) as browser:
        assert browser.post('/api/auth/login', json={'username': 'first-admin', 'password': 'first-login-password-123'}).status_code == 200
        assert browser.get('/api/auth/session').json()['user']['role'] == 'admin'


def test_setup_env_generates_private_unique_credentials_without_overwrite(tmp_path):
    (tmp_path / 'scripts').mkdir()
    shutil.copy(PROJECT_ROOT / 'scripts/setup_env.py', tmp_path / 'scripts/setup_env.py')
    shutil.copy(PROJECT_ROOT / '.env.example', tmp_path / '.env.example')
    result = subprocess.run([sys.executable, str(tmp_path / 'scripts/setup_env.py')], capture_output=True, text=True)
    assert result.returncode == 0
    env = (tmp_path / '.env').read_text(encoding='utf-8')
    password = next(line.split('=', 1)[1] for line in env.splitlines() if line.startswith('BOOTSTRAP_ADMIN_PASSWORD='))
    assert len(password) >= 12 and password not in result.stdout + result.stderr
    second = subprocess.run([sys.executable, str(tmp_path / 'scripts/setup_env.py')], capture_output=True)
    assert second.returncode != 0
    assert (tmp_path / '.env').read_text(encoding='utf-8') == env
