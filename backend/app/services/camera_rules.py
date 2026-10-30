"""Validated camera-local rules. Runtime evaluation never accesses the database."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

import cv2
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Zone(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    mode: Literal["include", "exclude"]
    points: list[tuple[float, float]] = Field(min_length=3, max_length=64)

    @model_validator(mode="after")
    def polygon(self):
        if any(not 0 <= n <= 1 for point in self.points for n in point):
            raise ValueError("Coordinates must be normalized")
        if len(set(self.points)) != len(self.points):
            raise ValueError("Duplicate polygon vertices")
        p = self.points
        def cross(a, b, c):
            return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        for i in range(len(p)):
            a, b = p[i], p[(i+1)%len(p)]
            for j in range(i+1, len(p)):
                if j == i+1 or (i == 0 and j == len(p)-1):
                    continue
                c, d = p[j], p[(j+1)%len(p)]
                if cross(a,b,c)*cross(a,b,d) <= 0 and cross(c,d,a)*cross(c,d,b) <= 0 and max(min(a[0],b[0]),min(c[0],d[0])) <= min(max(a[0],b[0]),max(c[0],d[0])) and max(min(a[1],b[1]),min(c[1],d[1])) <= min(max(a[1],b[1]),max(c[1],d[1])):
                    raise ValueError("Self-intersecting polygon")
        if abs(cv2.contourArea(np.array(p, dtype=np.float32))) < 1e-6:
            raise ValueError("Degenerate polygon")
        return self


class Window(StrictModel):
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @model_validator(mode="after")
    def valid(self):
        if self.start == self.end or len(set(self.weekdays)) != len(self.weekdays) or any(d < 0 or d > 6 for d in self.weekdays):
            raise ValueError("Invalid schedule window")
        return self


class Schedule(StrictModel):
    enabled: bool = False
    timezone: str = "Europe/Moscow"
    windows: list[Window] = Field(default_factory=list, max_length=64)

    @model_validator(mode="after")
    def valid(self):
        try:
            ZoneInfo(self.timezone)
        except (ValueError, KeyError):
            raise ValueError("Unknown IANA timezone")
        return self


class CameraRules(StrictModel):
    enabled_classes: list[Literal["weapon", "suspicious_bag", "dog"]] = Field(default_factory=lambda: ["weapon", "suspicious_bag", "dog"], max_length=3)
    zones: list[Zone] = Field(default_factory=list, max_length=32)
    schedule: Schedule = Field(default_factory=Schedule)

    @model_validator(mode="after")
    def unique(self):
        if len(set(self.enabled_classes)) != len(self.enabled_classes) or len({z.id for z in self.zones}) != len(self.zones):
            raise ValueError("Duplicate class or zone ID")
        return self


def is_active(rules: CameraRules, now: datetime | None = None) -> bool:
    if not rules.schedule.enabled:
        return True
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(rules.schedule.timezone))
    clock = local.strftime("%H:%M")
    for w in rules.schedule.windows:
        if w.start < w.end:
            if local.weekday() in w.weekdays and w.start <= clock < w.end:
                return True
        elif (local.weekday() in w.weekdays and clock >= w.start) or ((local - timedelta(days=1)).weekday() in w.weekdays and clock < w.end):
            return True
    return False


def filter_analysis(analysis: dict, rules: CameraRules, width: int, height: int) -> dict:
    includes = [z for z in rules.zones if z.mode == "include"]
    excludes = [z for z in rules.zones if z.mode == "exclude"]
    def allowed(item):
        if item["type"] not in rules.enabled_classes:
            return False
        box = item["bbox"]
        center = ((box[0]+box[2])/(2*width), (box[1]+box[3])/(2*height))
        def inside(z):
            return cv2.pointPolygonTest(np.array(z.points, dtype=np.float32), center, False) >= 0
        return (not includes or any(map(inside, includes))) and not any(map(inside, excludes))
    return {**analysis, "violations": [v for v in analysis.get("violations", []) if allowed(v)]}


def load_rules(db, camera_id: int) -> CameraRules:
    from app.db.models import AppSetting
    row = db.get(AppSetting, f"camera_rules:{camera_id}")
    return CameraRules.model_validate_json(row.value) if row else CameraRules()
