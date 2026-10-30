"""Safe characterization proofs of audit findings, not desired-policy regressions.

These assertions document current vulnerabilities and must change when fixed.
All HTTP mutations use conftest's temporary DB/media; no live cameras are opened.
"""
import asyncio

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from starlette.requests import Request

from app.api.auth import _attempts
from app.core.config import settings
from app.core.security import validate_stream_source
from app.main import app
from app.services.stream_manager import stream_manager


def custom_employee(client, permissions):
    role = client.post('/api/roles', json={
        'name': 'Audit role', 'permissions': permissions,
    })
    assert role.status_code == 201, role.text
    user = client.post('/api/employees', json={
        'username': 'audit-user', 'display_name': 'Audit',
        'password': 'audit-password-12345', 'role': role.json()['key'],
    })
    assert user.status_code == 201, user.text
    _attempts.clear()
    browser = TestClient(app, headers={'X-Requested-With': 'SchoolSecurity'})
    result = browser.post('/api/auth/login', json={
        'username': 'audit-user', 'password': 'audit-password-12345',
    })
    assert result.status_code == 200, result.text
    return browser, user.json()


def test_audit_role_without_permissions_reads_monitoring_and_media(client, monkeypatch):
    camera = client.post('/api/cameras', json={'name': 'Audit camera', 'rtsp_url': 'sim://hallway'}).json()
    path = settings.MEDIA_ROOT / 'images' / 'audit-proof.jpg'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'audit-private-media')
    monkeypatch.setattr(stream_manager, 'get_frame', lambda _: b'audit-jpeg')
    browser, _ = custom_employee(client, [])
    with browser:
        assert browser.get('/api/auth/session').json()['user']['permissions'] == []
        for url in ['/api/cameras', '/api/violations', '/api/stats', '/api/floor-plans',
                    f"/api/cameras/{camera['id']}/snapshot", '/media/images/audit-proof.jpg']:
            result = browser.get(url)
            assert result.status_code == 200, (url, result.text)
        assert browser.get('/api/violations/export.csv').status_code == 403


def test_audit_camera_manager_can_add_toggle_delete_but_not_configure(client):
    browser, _ = custom_employee(client, ['manage_cameras'])
    with browser:
        result = browser.post('/api/cameras', json={'name': 'Audit camera', 'rtsp_url': 'sim://hallway'})
        assert result.status_code == 201, result.text
        camera_id = result.json()['id']
        assert browser.post(f'/api/cameras/{camera_id}/toggle').status_code == 200
        assert browser.put(f'/api/cameras/{camera_id}/rules', json={}).status_code == 403
        assert browser.delete(f'/api/cameras/{camera_id}').status_code == 204


def test_audit_open_stream_yields_after_account_disabled(client, monkeypatch):
    from app.api.routes import stream_camera
    from app.core.security import verify_api_key

    browser, employee = custom_employee(client, ['view_monitoring'])
    with browser:
        token = browser.cookies.get('school_session')
        request = Request({'type': 'http', 'method': 'GET', 'path': '/api/cameras/1/stream',
                           'headers': [(b'cookie', f'school_session={token}'.encode())]})
        verify_api_key(request, header_key=None)
        monkeypatch.setattr(stream_manager, 'has_camera', lambda _: True)
        monkeypatch.setattr(stream_manager, 'get_frame_with_seq', lambda _: (b'private-frame', 1))

        async def disconnected():
            return False

        monkeypatch.setattr(request, 'is_disconnected', disconnected)

        async def proof():
            response = await stream_camera(1, request)
            assert client.patch(f"/api/employees/{employee['id']}", json={'is_active': False}).status_code == 200
            assert browser.get('/api/auth/session').status_code == 401
            try:
                frame = await anext(response.body_iterator)
                assert b'private-frame' in frame
            finally:
                await response.body_iterator.aclose()

        asyncio.run(proof())


@pytest.mark.parametrize('host', ['::ffff:127.0.0.1', '::ffff:169.254.169.254'])
def test_audit_mapped_ipv6_blocked_in_current_runtime(client, monkeypatch, host):
    # Validator only: never connect to loopback or metadata addresses.
    monkeypatch.setattr(settings, 'DEV_MODE', False)
    monkeypatch.setattr(settings, 'ALLOW_PRIVATE_RTSP', True)
    monkeypatch.setattr(settings, 'CAMERA_ALLOWED_HOSTS', [host])
    url = f'rtsp://[{host}]:554/live'
    with pytest.raises(HTTPException) as error:
        validate_stream_source(url)
    assert error.value.status_code == 400
