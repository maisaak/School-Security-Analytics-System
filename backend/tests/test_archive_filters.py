import csv
import io
import zipfile
from datetime import datetime

from app.db.models import Camera, Violation
from app.db.session import SessionLocal


def seed():
    with SessionLocal() as db:
        cam = Camera(name="=camera", location="+zone", rtsp_url="sim://entrance")
        db.add(cam); db.flush()
        rows = [Violation(camera_id=cam.id, violation_type="dog", confidence=.9, image_path="", detected_at=datetime(2026, 10, 30, hour), review_comment="@formula") for hour in (10, 11, 12)]
        db.add_all(rows); db.commit()
        return [row.id for row in rows]


def test_archive_list_csv_zip_share_dates_and_selection(client):
    ids = seed()
    params = {"date_from": "2026-10-30T10:00:00Z", "date_to": "2026-10-30T12:00:00Z", "ids": f"{ids[0]},{ids[2]}"}
    assert [row["id"] for row in client.get("/api/violations", params=params).json()] == [ids[0]]
    csv_response = client.get("/api/violations/export.csv", params=params)
    assert csv_response.status_code == 200
    lines = list(csv.reader(io.StringIO(csv_response.content.decode("utf-8-sig"))))
    assert len(lines) == 2 and lines[1][0] == str(ids[0])
    assert lines[1][2] == "'=camera" and lines[1][3] == "'+zone" and lines[1][7] == "'@formula"
    response = client.get("/api/violations/export.zip", params=params)
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        lines = list(csv.reader(io.StringIO(archive.read("violations.csv").decode("utf-8-sig"))))
        assert len(lines) == 2 and lines[1][0] == str(ids[0])


def test_invalid_archive_boundaries_and_empty_selection(client):
    for params in ({"ids": ""}, {"ids": "-1"}, {"date_from": "2026-10-30T10:00:00"}, {"date_from": "2026-10-31T00:00:00Z", "date_to": "2026-10-30T00:00:00Z"}):
        for path in ("/api/violations", "/api/violations/export.csv", "/api/violations/export.zip"):
            assert client.get(path, params=params).status_code == 422


def test_archive_timezone_offset_matches_same_utc_interval(client):
    ids = seed()
    params = {"date_from": "2026-10-30T13:00:00+03:00", "date_to": "2026-10-30T15:00:00+03:00"}
    response = client.get("/api/violations", params=params)
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [ids[1], ids[0]]


def test_archive_id_selection_intersects_confidence_and_camera(client):
    ids = seed()
    with SessionLocal() as db:
        first = db.get(Violation, ids[0])
        first.confidence = .1
        camera_id = first.camera_id
        db.commit()
    params = {"ids": ",".join(map(str, ids)), "min_confidence": .5, "camera_id": camera_id}
    assert [row["id"] for row in client.get("/api/violations", params=params).json()] == [ids[2], ids[1]]
    params["camera_id"] = 999999
    assert client.get("/api/violations", params=params).json() == []


def test_archive_pagination_is_stable_for_equal_timestamps(client):
    ids = seed()
    with SessionLocal() as db:
        for identifier in ids:
            db.get(Violation, identifier).detected_at = datetime(2026, 10, 30, 12)
        db.commit()
    first = client.get("/api/violations", params={"limit": 2}).json()
    second = client.get("/api/violations", params={"limit": 2, "offset": 2}).json()
    assert [row["id"] for row in first + second] == list(reversed(ids))
