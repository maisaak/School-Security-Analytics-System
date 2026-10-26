import pytest
import yaml
from PIL import Image

from ml.dataset_validation import validate_dataset


def make_dataset(tmp_path):
    for split, count in (("train", 6), ("val", 3)):
        for index in range(count):
            image = tmp_path / "custom" / "images" / split / f"{index}.jpg"
            label = tmp_path / "custom" / "labels" / split / f"{index}.txt"
            image.parent.mkdir(parents=True, exist_ok=True)
            label.parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (20, 20), color=((index + (10 if split == "val" else 0)) * 10, 0, 0)).save(image)
            label.write_text(f"{index % 3} .5 .5 .5 .5\n")
    config = tmp_path / "dataset.yaml"
    config.write_text(yaml.safe_dump({"path": "custom", "train": "images/train", "val": "images/val", "names": {0: "dog", 1: "weapon", 2: "suspicious_bag"}}))
    return config


def test_valid_dataset(tmp_path):
    assert validate_dataset(make_dataset(tmp_path))["counts"] == {"train": 6, "val": 3}


def test_duplicate_train_val_rejected(tmp_path):
    config = make_dataset(tmp_path)
    (tmp_path / "custom/images/val/0.jpg").write_bytes((tmp_path / "custom/images/train/0.jpg").read_bytes())
    with pytest.raises(ValueError, match="train и val"):
        validate_dataset(config)


def test_invalid_bbox_rejected(tmp_path):
    config = make_dataset(tmp_path)
    (tmp_path / "custom/labels/train/0.txt").write_text("0 .99 .99 .5 .5")
    with pytest.raises(ValueError, match="Рамка"):
        validate_dataset(config)


def test_seed_images_rejected(tmp_path):
    config = make_dataset(tmp_path)
    (tmp_path / "custom/images/train/0.jpg").rename(tmp_path / "custom/images/train/seed_0.jpg")
    with pytest.raises(ValueError, match="Синтетические"):
        validate_dataset(config)
