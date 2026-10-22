from __future__ import annotations

from app.services.tracking import BagDwellMonitor, IoUTracker

FRAME_SHAPE = (540, 960, 3)


def _bag(x: int = 400, y: int = 300, conf: float = 0.8) -> dict:
    return {"confidence": conf, "bbox": [x, y, x + 90, y + 110]}


def _person(x: int = 700, y: int = 250) -> dict:
    return {"confidence": 0.9, "bbox": [x, y, x + 70, y + 220]}


def test_tracker_keeps_stable_id_for_moving_bag():
    tracker = IoUTracker(iou_threshold=0.2, max_age_sec=3.0, min_hits=2)
    ids = []
    t = 0.0
    for step in range(6):
        tracker.update([_bag(x=400 + step * 12)], now=t)
        t += 0.2
    ids = list(tracker.tracks.keys())
    assert len(ids) == 1, "Непрерывно видимый объект не должен порождать новые треки"
    assert tracker.tracks[ids[0]].hits >= 5


def test_dwell_timer_holds_bag_before_threshold():
    monitor = BagDwellMonitor(dwell_sec=5.0, distance_ratio=0.2)
    violations = []
    t = 100.0
    for _ in range(10):  # 2 секунды наблюдения
        result = monitor.update([_bag()], [_person(x=850, y=20)], FRAME_SHAPE, t)
        violations = result["violations"]
        t += 0.2

    assert violations == [], "Тревога не должна возникать до истечения таймера выдержки"
    states = result["states"]
    assert states and states[0]["state"] == "holding"
    assert 1.5 <= states[0]["dwell_seconds"] < 5.0


def test_dwell_timer_triggers_after_threshold():
    monitor = BagDwellMonitor(dwell_sec=2.0, distance_ratio=0.2)
    t = 0.0
    result = {"violations": []}
    for _ in range(40):  # 8 секунд при шаге 0.2
        result = monitor.update([_bag()], [], FRAME_SHAPE, t)
        t += 0.2
        if result["violations"]:
            break

    assert result["violations"], "После выдержки бесхозная сумка обязана поднять тревогу"
    violation = result["violations"][0]
    assert violation["type"] == "suspicious_bag"
    assert violation["track_id"].startswith("BAG-")
    assert violation["dwell_seconds"] >= 2.0
    assert result["threshold_sec"] == 2.0


def test_owner_nearby_resets_dwell_timer():
    monitor = BagDwellMonitor(dwell_sec=1.0, distance_ratio=0.2)
    t = 0.0
    # Сумка рядом с владельцем — состояние attended, тревоги нет
    for _ in range(30):
        result = monitor.update([_bag()], [_person(x=430, y=250)], FRAME_SHAPE, t)
        t += 0.2
    assert result["violations"] == []
    assert result["states"][0]["state"] == "attended"

    # Владелец ушёл: таймер стартует заново и не «догоняет» прошлое время
    first = monitor.update([_bag()], [], FRAME_SHAPE, t)
    assert first["violations"] == []
    assert first["states"][0]["state"] == "holding"
    assert first["states"][0]["dwell_seconds"] < 1.0


def test_dwell_survives_short_detection_gap():
    monitor = BagDwellMonitor(dwell_sec=1.0, distance_ratio=0.2, release_grace_sec=1.5)
    t = 0.0
    for _ in range(8):  # 1.6 секунды — тревога подтверждена
        monitor.update([_bag()], [], FRAME_SHAPE, t)
        t += 0.2
    assert monitor.tracker.tracks

    # Один пропущенный кадр детекции не должен обнулять накопленную выдержку
    monitor.update([], [], FRAME_SHAPE, t)
    state = monitor.update([_bag()], [], FRAME_SHAPE, t + 0.2)
    assert state["states"]
    assert state["states"][0]["dwell_seconds"] >= 1.0


def test_tracker_forgets_stale_tracks():
    tracker = IoUTracker(iou_threshold=0.3, max_age_sec=1.0, min_hits=1)
    tracker.update([_bag(x=100, y=100)], now=0.0)
    assert len(tracker.tracks) == 1
    tracker.update([], now=5.0)
    assert tracker.tracks == {}


def test_confirmed_alarm_survives_brief_detection_gap():
    """Статус подтверждённой тревоги удерживается, пока предмет не пропал дольше grace-окна."""
    monitor = BagDwellMonitor(dwell_sec=1.0, distance_ratio=0.2, release_grace_sec=1.5)
    t = 0.0
    result = {"violations": []}
    for _ in range(8):  # 1.6 с — тревога подтверждена
        result = monitor.update([_bag()], [], FRAME_SHAPE, t)
        t += 0.2
    assert result["violations"], "Тревога должна быть подтверждена"

    # Кадр без детекции (например, предмет перекрыт) — тревога не гаснет мгновенно
    gap = monitor.update([], [], FRAME_SHAPE, t)
    assert gap["states"][0]["state"] == "unattended"
    assert gap["violations"], "Короткий пропуск детекции не должен гасить подтверждённую тревогу"

    # Долгое отсутствие предмета (> grace) — трек забывается, тревога снимается
    later = monitor.update([], [], FRAME_SHAPE, t + 5.0)
    assert later["violations"] == []
