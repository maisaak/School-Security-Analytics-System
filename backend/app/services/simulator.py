from __future__ import annotations

import math
import threading
import time
from pathlib import Path
import cv2
import numpy as np

from app.core.config import PROJECT_ROOT
from ml.datasets.generate_dataset import extract_foreground_rgba, paste_sprite


class RealisticCCTVSimulator:
    """
    Генерирует фотореалистичные чистые (без предразметки!) видеопотоки школьных камер:
      - sim://entrance  — Главный вход / турникеты
      - sim://hallway   — Рекреация 1 этажа (ученик оставляет сумку на скамейке и уходит!)
      - sim://courtyard — Школьный двор и ворота периметра (пробегает безнадзорная собака!)
    Все рамки и детекции выполняются ИСКЛЮЧИТЕЛЬНО реальной нейросетью YOLOv8 поверх этих кадров!
    """

    _shared_lock = threading.Lock()
    _assets_cache: dict | None = None

    @classmethod
    def _get_assets(cls) -> dict:
        with cls._shared_lock:
            if cls._assets_cache is not None:
                return cls._assets_cache

            assets_dir = PROJECT_ROOT / "ml" / "assets"
            scenes = {}
            for key, fname in (
                ("entrance", "entrance_cctv.jpg"),
                ("hallway", "hallway_cctv.jpg"),
                ("courtyard", "courtyard_cctv.jpg"),
            ):
                img = cv2.imread(str(assets_dir / "scenes" / fname))
                if img is None:
                    img = np.full((540, 960, 3), 48, dtype=np.uint8)
                else:
                    img = cv2.resize(img, (960, 540), interpolation=cv2.INTER_AREA)
                scenes[key] = img

            sprites = {
                "person": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "student_white.png"))),
                "bag": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "backpack_white.png"))),
                "dog": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "dog_white.png"))),
                "weapon": extract_foreground_rgba(cv2.imread(str(assets_dir / "sprites" / "weapon_white.jpg"))),
            }
            cls._assets_cache = {"scenes": scenes, "sprites": sprites}
            return cls._assets_cache

    def __init__(self, source_url: str, phase_offset: float = 0.0) -> None:
        key = source_url.removeprefix("sim://").strip("/").lower()
        self.scene_key = key if key in {"entrance", "hallway", "courtyard"} else "entrance"
        self.phase_offset = phase_offset
        self._lock = threading.Lock()
        self._manual_scenario: str | None = None
        self._manual_started_at: float = 0.0
        self._manual_duration: float = 9.0

    def trigger_scenario(self, scenario: str, duration_sec: float = 9.0) -> None:
        with self._lock:
            self._manual_scenario = scenario
            self._manual_started_at = time.monotonic()
            self._manual_duration = duration_sec

    def read_frame(self) -> np.ndarray:
        assets = self._get_assets()
        frame = assets["scenes"][self.scene_key].copy()
        sprites = assets["sprites"]

        now = time.monotonic()
        with self._lock:
            manual = self._manual_scenario
            elapsed = now - self._manual_started_at
            if manual and elapsed > self._manual_duration:
                self._manual_scenario = None
                manual = None

        # Едва заметное «дыхание» экспозиции реальной матрицы CCTV
        flicker = 1.0 + 0.012 * math.sin(now * 2.3 + self.phase_offset)
        frame = np.clip(frame.astype(np.float32) * flicker, 0, 255).astype(np.uint8)

        if manual:
            p = min(1.0, max(0.0, elapsed / self._manual_duration))
            self._render_manual(frame, sprites, manual, p)
            return frame

        # Автоматический реалистичный цикл жизни школы (26 секунд)
        cycle = ((now + self.phase_offset) % 26.0) / 26.0

        if self.scene_key == "hallway":
            # 0.00..0.30: Ученик идёт по коридору С рюкзаком (рядом -> БЕЗОПАСНО, нет тревоги!)
            # 0.30..0.62: Ученик оставил рюкзак у скамейки и ушёл в класс -> СРАБАТЫВАЕТ suspicious_bag!
            # 0.62..1.00: Спокойный коридор, проходит другой ученик
            bag_x, bag_y = 355, 448
            if cycle < 0.30:
                px = int(170 + (bag_x - 170) * (cycle / 0.30))
                paste_sprite(frame, sprites["person"], center_x=px, bottom_y=462, target_h=265)
                paste_sprite(frame, sprites["bag"], center_x=px + 28, bottom_y=452, target_h=118)
            elif cycle < 0.42:
                # Ученик уходит вглубь коридора, рюкзак остаётся на полу!
                sub = (cycle - 0.30) / 0.12
                px = int(bag_x + 310 * sub)
                th = int(265 - 75 * sub)
                paste_sprite(frame, sprites["bag"], center_x=bag_x, bottom_y=bag_y, target_h=124)
                paste_sprite(frame, sprites["person"], center_x=px, bottom_y=int(462 - 45 * sub), target_h=th)
            elif cycle < 0.66:
                paste_sprite(frame, sprites["bag"], center_x=bag_x, bottom_y=bag_y, target_h=124)
            elif 0.74 <= cycle <= 0.95:
                sub = (cycle - 0.74) / 0.21
                sp = cv2.flip(sprites["person"], 1)
                paste_sprite(frame, sp, center_x=int(790 - 520 * sub), bottom_y=468, target_h=258)

        elif self.scene_key == "courtyard":
            # На школьном дворе периодически пробегает безнадзорная собака через ворота
            if 0.20 <= cycle <= 0.56:
                sub = (cycle - 0.20) / 0.36
                dx = int(195 + 520 * sub)
                dy = int(475 - 55 * math.sin(sub * math.pi))
                paste_sprite(frame, sprites["dog"], center_x=dx, bottom_y=dy, target_h=132)
            elif 0.68 <= cycle <= 0.92:
                sub = (cycle - 0.68) / 0.24
                paste_sprite(frame, sprites["person"], center_x=int(260 + 300 * sub), bottom_y=455, target_h=215)

        else:  # entrance
            # Главный вход: проходят посетители, периодически фиксируется критический тест оружия у турникета
            if cycle < 0.34:
                sub = cycle / 0.34
                paste_sprite(frame, sprites["person"], center_x=int(210 + 360 * sub), bottom_y=470, target_h=275)
            elif 0.52 <= cycle <= 0.74:
                paste_sprite(frame, sprites["weapon"], center_x=520, bottom_y=420, target_h=106, draw_shadow=False)

        return frame

    def _render_manual(self, frame: np.ndarray, sprites: dict, mode: str, p: float) -> None:
        if mode == "suspicious_bag":
            paste_sprite(frame, sprites["bag"], center_x=465, bottom_y=455, target_h=136)
        elif mode == "dog":
            dx = int(220 + 470 * p)
            paste_sprite(frame, sprites["dog"], center_x=dx, bottom_y=458, target_h=142)
        elif mode == "weapon":
            wx = int(420 + 110 * math.sin(p * math.pi))
            paste_sprite(frame, sprites["weapon"], center_x=wx, bottom_y=415, target_h=112, draw_shadow=False)
        elif mode == "person_with_bag":
            px = int(230 + 440 * p)
            paste_sprite(frame, sprites["person"], center_x=px, bottom_y=472, target_h=275)
            paste_sprite(frame, sprites["bag"], center_x=px + 26, bottom_y=458, target_h=120)
