from app.services.event_policy import EventPolicy


def analysis(kind="suspicious_bag", bbox=None):
    return {"violations": [{"type": kind, "bbox": bbox or [10, 10, 50, 50], "confidence": .9}], "safe_objects": []}


def test_bag_needs_continuous_stationary_observation():
    policy = EventPolicy(3)
    for now in range(3):
        assert not policy.update(analysis(), now)["violations"]
    assert policy.update(analysis(), 3)["violations"]


def test_missing_or_attended_bag_resets_timer():
    policy = EventPolicy(3)
    policy.update(analysis(), 0)
    policy.update({"violations": [], "safe_objects": []}, 1)
    assert not policy.update(analysis(), 2)["violations"]
    assert not policy.update(analysis(), 3)["violations"]


def test_moving_bag_and_capture_gap_restart_timer():
    policy = EventPolicy(3)
    policy.update(analysis(), 0)
    assert not policy.update(analysis(bbox=[200, 200, 240, 240]), 1)["violations"]
    assert not policy.update(analysis(bbox=[200, 200, 240, 240]), 8)["violations"]


def test_weapons_need_repeated_detection_not_long_delay():
    policy = EventPolicy(30, confirmations=2)
    assert not policy.update(analysis("weapon"), 0)["violations"]
    assert policy.update(analysis("weapon"), .25)["violations"]


def test_two_bags_cannot_share_one_previous_track():
    policy = EventPolicy(0, confirmations=2)
    policy.update(analysis(), 0)
    data = analysis()
    data["violations"].append({"type": "suspicious_bag", "bbox": [20, 10, 60, 50], "confidence": .9})
    assert len(policy.update(data, 1)["violations"]) == 1


def test_slowly_moving_bag_cannot_accumulate_stationary_time():
    policy = EventPolicy(10)
    for now in range(15):
        box = [10 + now * 5, 10, 50 + now * 5, 50]
        assert not policy.update(analysis(bbox=box), now)["violations"]
