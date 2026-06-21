"""
b量子速读 - 共享工具模块
"""

import json
import logging
import os
import socket
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(name="whisper_server"):
    """Configure rotating file + console logging"""
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)

    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # File handler with rotation
    fh = RotatingFileHandler(
        log_dir / f"{name}.log",
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(fh)

    # Console handler
    ch = logging.StreamHandler()
    ch.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(ch)

    return logger


def find_free_port(start=8787, end=8800):
    """Find first available port in range (socket test)."""
    for p in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", p))
                return p
            except OSError:
                continue
    raise RuntimeError(f"No free port in {start}-{end}")


def write_runtime(data):
    """Write runtime.json for native_host to read."""
    path = Path(__file__).parent / "runtime.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def read_runtime():
    """Read runtime.json, return dict or None."""
    path = Path(__file__).parent / "runtime.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


# ── Error classification ──

ERROR_MAP = {
    "deps_missing": {
        "message": "Whisper 依赖包未安装",
        "action": "点击「修复依赖」按钮重新安装，或运行 install.ps1 -Repair",
    },
    "model_download_failed": {
        "message": "模型下载失败（网络问题）",
        "action": "已自动切换 hf-mirror 镜像，点击「重试下载」或重启服务",
    },
    "ffmpeg_missing": {
        "message": "缺少 ffmpeg 音频解码器",
        "action": "点击「自动下载 ffmpeg」或手动放入 whisper_server/bin/ 目录",
    },
    "port_in_use": {
        "message": "端口被占用，已自动切换到空闲端口",
        "action": "无需操作，服务已自动恢复",
    },
    "bilibili_download_failed": {
        "message": "B 站音频下载失败",
        "action": "视频可能需要登录 / Cookie 过期 / 地域限制，请稍后重试或换视频",
    },
    "transcribe_failed": {
        "message": "转写出错",
        "action": "查看日志 logs/server.log，反馈给开发者",
    },
}


def classify_error(error_text: str) -> dict:
    """Classify an exception into error_class + user-facing message."""
    err = error_text.lower()
    if "no module named" in err or "import" in err:
        cls = "deps_missing"
    elif "ffmpeg" in err or "av_decode" in err or "codec" in err:
        cls = "ffmpeg_missing"
    elif "connection" in err or "timeout" in err or "reset" in err:
        cls = "model_download_failed"
    elif "address already in use" in err or "eaddrinuse" in err:
        cls = "port_in_use"
    elif "403" in err or "401" in err or "audio" in err or "bilibili" in err:
        cls = "bilibili_download_failed"
    else:
        cls = "transcribe_failed"
    return {"error_class": cls, **ERROR_MAP[cls]}
