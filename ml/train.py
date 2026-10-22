from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable
import matplotlib
matplotlib.use("Agg")
import yaml
from ultralytics import YOLO

from ml.datasets.generate_dataset import ensure_custom_dataset


def train_model(
    base_weights: str | Path | None = None,
    data_yaml: str | Path | None = None,
    epochs: int = 6,
    imgsz: int = 416,
    batch: int = 8,
    output_weights: str | Path | None = None,
    progress_callback: Callable[[int, int, dict], None] | None = None,
) -> dict:
    """
    Дообучает модель YOLOv8 (инкрементальный transfer learning с заморозкой ранних слоёв backbone)
    на датасете школьной безопасности (0: dog, 1: weapon, 2: suspicious_bag).
    """
    project_root = Path(__file__).resolve().parents[1]

    out_pt = Path(output_weights) if output_weights else project_root / "ml" / "models" / "school_security_best.pt"
    if not out_pt.is_absolute():
        out_pt = (project_root / out_pt).resolve()
    out_pt.parent.mkdir(parents=True, exist_ok=True)

    start_pt = Path(base_weights) if base_weights else project_root / "ml" / "models" / "yolov8n.pt"
    if not start_pt.is_absolute():
        start_pt = (project_root / start_pt).resolve()

    dataset_stats = ensure_custom_dataset(project_root)

    src_yaml = Path(data_yaml) if data_yaml else project_root / "ml" / "datasets" / "school_security.yaml"
    if not src_yaml.is_absolute():
        src_yaml = (project_root / src_yaml).resolve()

    cfg = yaml.safe_load(src_yaml.read_text(encoding="utf-8"))
    cfg["path"] = str((project_root / "ml" / "datasets" / "custom").resolve())
    resolved_yaml = project_root / "ml" / "runs" / "resolved_school_security.yaml"
    resolved_yaml.parent.mkdir(parents=True, exist_ok=True)
    resolved_yaml.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")

    model = YOLO(str(start_pt))

    def _on_epoch_end(trainer) -> None:
        if progress_callback is None:
            return
        cur_epoch = int(getattr(trainer, "epoch", 0)) + 1
        total_epochs = int(getattr(trainer, "epochs", epochs))
        loss_items = getattr(trainer, "loss_items", None)
        step_metrics: dict[str, float] = {}
        if isinstance(loss_items, dict):
            for lk, lv in loss_items.items():
                if isinstance(lv, (int, float)):
                    step_metrics[f"{lk}_loss" if not lk.endswith("loss") else lk] = round(float(lv), 4)
        elif loss_items is not None:
            vals = list(loss_items)
            if len(vals) >= 3:
                step_metrics["box_loss"] = round(float(vals[0]), 4)
                step_metrics["cls_loss"] = round(float(vals[1]), 4)
                step_metrics["dfl_loss"] = round(float(vals[2]), 4)
        for k, v in (getattr(trainer, "metrics", {}) or {}).items():
            if isinstance(v, (int, float)):
                step_metrics[k] = round(float(v), 4)
        progress_callback(cur_epoch, total_epochs, step_metrics)

    model.add_callback("on_fit_epoch_end", _on_epoch_end)

    results = model.train(
        data=str(resolved_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        freeze=10,
        workers=0,
        plots=False,
        project=str(project_root / "ml" / "runs"),
        name="school_security_retrain",
        exist_ok=True,
        verbose=False,
    )

    save_dir = Path(results.save_dir)
    best_candidate = save_dir / "weights" / "best.pt"
    last_candidate = save_dir / "weights" / "last.pt"
    chosen = best_candidate if best_candidate.exists() else (last_candidate if last_candidate.exists() else None)
    if chosen is not None:
        import os as _os
        tmp_pt = out_pt.with_suffix(".pt.tmp")
        shutil.copy2(chosen, tmp_pt)
        _os.replace(tmp_pt, out_pt)

    raw_metrics = getattr(results, "results_dict", {}) or {}
    clean_metrics = {
        k: round(float(v), 4)
        for k, v in raw_metrics.items()
        if isinstance(v, (int, float))
    }

    return {
        "saved_weights": str(out_pt),
        "epochs": epochs,
        "dataset": dataset_stats,
        "metrics": clean_metrics,
    }


if __name__ == "__main__":
    import argparse
    import json as _json

    parser = argparse.ArgumentParser(description="Train YOLOv8 School Security model")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--data", type=str, default=None)
    parser.add_argument("--base", type=str, default=None)
    parser.add_argument("--output", type=str, default=None, help="Путь для сохранения обученных весов (staging)")
    parser.add_argument("--json-progress", action="store_true")
    args = parser.parse_args()

    def _emit_epoch(cur: int, total: int, metrics: dict) -> None:
        if args.json_progress:
            print("PROGRESS_JSON:" + _json.dumps({"epoch": cur, "epochs": total, "metrics": metrics}), flush=True)

    summary = train_model(
        base_weights=args.base,
        data_yaml=args.data,
        output_weights=args.output,
        epochs=args.epochs,
        imgsz=416,
        batch=8,
        progress_callback=_emit_epoch if args.json_progress else None,
    )
    if args.json_progress:
        print("RESULT_JSON:" + _json.dumps(summary), flush=True)
    else:
        print("Training completed successfully:", summary)
