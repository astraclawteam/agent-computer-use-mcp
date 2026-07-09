#!/usr/bin/env python3
"""xiaozhiclaw-ocr-sidecar MVP adapter.

This MVP keeps the long-term sidecar contract stable while using RapidOCR
3.9.1 as the reference adapter for PP-OCRv6 small ONNX model verification.
"""

from __future__ import annotations

import contextlib
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple


PROVIDER = "xiaozhiclaw-ocr-sidecar"
MODEL_PACK = "pp-ocrv6-small"


RUNTIME_PRIORITY = [
    (
        "CUDAExecutionProvider",
        "onnxruntime-cuda",
        "gpu",
        {"EngineConfig.onnxruntime.use_cuda": True},
    ),
    (
        "DmlExecutionProvider",
        "onnxruntime-directml",
        "gpu",
        {"EngineConfig.onnxruntime.use_dml": True},
    ),
    (
        "CoreMLExecutionProvider",
        "onnxruntime-coreml",
        "accelerator",
        {"EngineConfig.onnxruntime.use_coreml": True},
    ),
    (
        "CANNExecutionProvider",
        "onnxruntime-cann",
        "accelerator",
        {"EngineConfig.onnxruntime.use_cann": True},
    ),
    (
        "CPUExecutionProvider",
        "onnxruntime-cpu",
        "cpu",
        {},
    ),
]


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "doctor"
    if command == "doctor":
        print_json(doctor())
        return 0
    if command == "recognize":
        request = json.load(sys.stdin)
        print_json(recognize(request))
        return 0

    print_json({"status": "error", "reason": f"unknown command: {command}"})
    return 2


def doctor() -> Dict[str, Any]:
    try:
        import onnxruntime as ort  # type: ignore
        from rapidocr import RapidOCR  # noqa: F401
    except Exception as exc:
        return {
            "status": "unavailable",
            "provider": PROVIDER,
            "reason": "missing-python-or-rapidocr",
            "detail": str(exc),
        }

    available = list(ort.get_available_providers())
    selected = select_runtime(available)
    return {
        "status": "healthy",
        "provider": PROVIDER,
        "engine": "rapidocr-python-reference",
        "modelPack": MODEL_PACK,
        "runtime": selected["runtime"],
        "executionProvider": selected["executionProvider"],
        "acceleration": selected["acceleration"],
        "availableProviders": available,
        "rapidOcrParams": selected["rapidOcrParams"],
    }


def recognize(request: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from rapidocr import RapidOCR  # type: ignore
        import onnxruntime as ort  # type: ignore
    except Exception as exc:
        return {
            "status": "error",
            "provider": PROVIDER,
            "reason": "missing-python-or-rapidocr",
            "detail": str(exc),
        }

    available = list(ort.get_available_providers())
    selected = select_runtime(available)
    image_path = request.get("imagePath")
    fixture = None
    if not image_path and request.get("fixture") == "canvas-lab":
        image_path = str(create_canvas_lab_fixture())
        fixture = "canvas-lab"
    if not image_path:
        return {
            "status": "error",
            "provider": PROVIDER,
            "reason": "imagePath or fixture is required",
        }

    params = {
        "Global.log_level": "error",
        "Global.max_side_len": int(request.get("maxSidePx") or 1280),
    }
    params.update(selected["rapidOcrParams"])

    started = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        engine = RapidOCR(params=params)
        output = engine(image_path)
    total_ms = (time.perf_counter() - started) * 1000.0

    infer_ms = float(getattr(output, "elapse", 0.0) or 0.0) * 1000.0
    return {
        "status": "ok",
        "provider": PROVIDER,
        "engine": "rapidocr-python-reference",
        "modelPack": MODEL_PACK,
        "runtime": selected["runtime"],
        "executionProvider": selected["executionProvider"],
        "acceleration": selected["acceleration"],
        "availableProviders": available,
        "fixture": fixture,
        "items": output_items(output),
        "timings": {
            "preprocessMs": 0,
            "inferMs": round(infer_ms, 1),
            "postprocessMs": 0,
            "totalMs": round(total_ms, 1),
        },
    }


def select_runtime(available_providers: Iterable[str]) -> Dict[str, Any]:
    available = set(available_providers)
    for execution_provider, runtime, acceleration, params in RUNTIME_PRIORITY:
        if execution_provider in available:
            return {
                "runtime": runtime,
                "executionProvider": execution_provider,
                "acceleration": acceleration,
                "rapidOcrParams": dict(params),
            }

    return {
        "runtime": "onnxruntime-cpu",
        "executionProvider": "CPUExecutionProvider",
        "acceleration": "cpu",
        "rapidOcrParams": {},
    }


def output_items(output: Any) -> List[Dict[str, Any]]:
    boxes = getattr(output, "boxes", None)
    texts = getattr(output, "txts", None)
    scores = getattr(output, "scores", None)
    if boxes is None:
        boxes = []
    if texts is None:
        texts = []
    if scores is None:
        scores = []

    items = []
    for box, text, score in zip(boxes, texts, scores):
        items.append(
            {
                "text": str(text),
                "bounds": box_to_bounds(box),
                "confidence": float(score),
                "source": "ocr",
            }
        )
    return items


def box_to_bounds(box: Any) -> Dict[str, float]:
    points: List[Tuple[float, float]] = []
    for point in box:
        points.append((float(point[0]), float(point[1])))
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left = min(xs)
    top = min(ys)
    right = max(xs)
    bottom = max(ys)
    return {
        "x": round(left, 2),
        "y": round(top, 2),
        "width": round(right - left, 2),
        "height": round(bottom - top, 2),
    }


def create_canvas_lab_fixture() -> Path:
    from PIL import Image, ImageDraw, ImageFont  # type: ignore

    image = Image.new("RGB", (900, 520), (240, 248, 249))
    draw = ImageDraw.Draw(image)
    title_font = load_font(42)
    label_font = load_font(27)
    text_font = load_font(26)

    draw.rounded_rectangle((88, 82, 812, 438), radius=24, fill=(255, 255, 255), outline=(190, 211, 218), width=2)
    draw.text((116, 114), "Canvas Computer Use Lab", fill=(24, 36, 44), font=title_font)

    draw.text((116, 188), "Name", fill=(28, 48, 60), font=label_font)
    draw.rounded_rectangle((116, 224, 376, 264), radius=8, fill=(255, 255, 255), outline=(112, 140, 152), width=2)
    draw.text((128, 228), "xiaozhi", fill=(18, 31, 42), font=text_font)

    draw.rounded_rectangle((632, 222, 714, 264), radius=8, fill=(232, 118, 83), outline=(187, 82, 58), width=2)
    draw.text((648, 228), "Save", fill=(255, 255, 255), font=text_font)

    draw.text((116, 314), "Status", fill=(28, 48, 60), font=label_font)
    draw.text((116, 348), "Saved: xiaozhi", fill=(18, 31, 42), font=text_font)

    path = Path(tempfile.gettempdir()) / "agent-computer-use-ocr-canvas-lab.png"
    image.save(path)
    return path


def load_font(size: int) -> Any:
    from PIL import ImageFont  # type: ignore

    font_candidates = [
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/msyh.ttc"),
    ]
    for font_path in font_candidates:
        if font_path.exists():
            return ImageFont.truetype(str(font_path), size=size)
    return ImageFont.load_default()


def print_json(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    raise SystemExit(main())
