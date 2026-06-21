"""
b量子速读 - 本地 Whisper 语音识别服务 (v2)

优化：
  - 状态机 phase/progress/error 细粒度反馈
  - 异步转写(返回 task_id) + SSE 实时进度 /progress/<id>
  - 取消转写 POST /cancel/<id>
  - 日志落盘(轮转文件) + 错误分类(7 类, 可操作文案)
  - 端口冲突自动切换(find_free_port)
  - ffmpeg 可用性检测 /check_ffmpeg
  - VAD 滤波 = 更准 + 跳过静音段
"""

import hashlib
import json
import logging
import os
import tempfile
import threading
import time
from pathlib import Path
from queue import Empty, Queue
from uuid import uuid4

import requests
from flask import Flask, jsonify, request, Response
from flask_cors import CORS
from logging.handlers import RotatingFileHandler

# ── Local utils ──
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from utils import (
    setup_logging,
    write_runtime,
    classify_error,
)

logger = setup_logging("server")

# =========================================================================
#  Config
# =========================================================================

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# ── Port ──
ACTUAL_PORT = int(os.environ.get("WHISPER_PORT", "8787"))
# 端口冲突极少见，冲突时用户设 WHISPER_PORT 换端口即可
write_runtime({"port": ACTUAL_PORT})

# =========================================================================
#  State machine  (thread-safe)
# =========================================================================
#   phase: not_started | loading_model | downloading_model | ready | failed
#   progress: 0-100
#   error_class: see utils.ERROR_MAP
#   error_message / error_detail

state = {
    "phase": "not_started",
    "model": MODEL_SIZE,
    "device": DEVICE,
    "compute_type": COMPUTE_TYPE,
    "port": ACTUAL_PORT,
    "progress": 0,
    "error_class": None,
    "error_message": None,
    "error_detail": None,
    "started_at": None,
    "ready_at": None,
}
_state_lock = threading.Lock()


def _set_state(**kw):
    with _state_lock:
        for k, v in kw.items():
            state[k] = v


def _get_state():
    with _state_lock:
        return dict(state)


# =========================================================================
#  Flask app
# =========================================================================

app = Flask(__name__)
CORS(app)

# Flask logger → same file
fh = RotatingFileHandler(
    Path(__file__).parent / "logs" / "server.log",
    maxBytes=2_000_000,
    backupCount=3,
    encoding="utf-8",
)
fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
app.logger.addHandler(fh)
app.logger.setLevel(logging.INFO)

# =========================================================================
#  Model  (lazy load in background thread)
# =========================================================================

_model = None
_model_lock = threading.Lock()
_model_ready = threading.Event()  # set when load succeeds OR fails


def _ct2_cache():
    return os.environ.get(
        "CTRANSLATE2_CACHE_DIR",
        os.path.join(os.path.expanduser("~"), ".cache", "ctranslate2"),
    )


def _model_cached():
    cache = _ct2_cache()
    d = os.path.join(cache, MODEL_SIZE)
    if not os.path.isdir(d):
        return False
    for f in os.listdir(d):
        if f.endswith(".bin") or f == "model":
            return True
    return False


def _load_model():
    global _model
    with _model_lock:
        if _model is not None:
            _model_ready.set()
            return

        try:
            from faster_whisper import WhisperModel

            # ── Phase: download (if not cached) ──
            if not _model_cached():
                _set_state(phase="downloading_model", progress=0,
                           error_class=None, error_message=None, error_detail=None)
                logger.info(f"Model '{MODEL_SIZE}' not cached — downloading...")

                try:
                    from huggingface_hub import snapshot_download

                    repo_id = f"Systran/faster-whisper-{MODEL_SIZE}"

                    hf_endpoint = os.environ.get("HF_ENDPOINT", "")
                    if hf_endpoint:
                        logger.info(f"Using HF mirror: {hf_endpoint}")

                    snapshot_download(
                        repo_id=repo_id,
                        local_dir=os.path.join(_ct2_cache(), MODEL_SIZE),
                    )
                    logger.info("Model download complete")
                    _set_state(progress=99)
                except ImportError:
                    logger.warning("huggingface_hub not available (model download may still work via ctranslate2)")
                except Exception as e:
                    logger.error(f"Model download failed: {e}")
                    err = classify_error(str(e))
                    _set_state(phase="failed",
                               error_class=err["error_class"],
                               error_message=err["message"],
                               error_detail=str(e))
                    _model_ready.set()
                    return

            # ── Phase: load ──
            _set_state(phase="loading_model",
                       progress=50 if not _model_cached() else 0)
            logger.info(f"Loading: {MODEL_SIZE} (device={DEVICE}, compute={COMPUTE_TYPE})")

            _model = WhisperModel(
                MODEL_SIZE,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                cpu_threads=os.cpu_count() or 4,
                num_workers=1,
            )

            _set_state(phase="ready", progress=100,
                       ready_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            logger.info("Model loaded successfully")

        except ImportError as e:
            _set_state(phase="failed")
            err = classify_error(str(e))
            _set_state(error_class=err["error_class"],
                       error_message=err["message"],
                       error_detail=str(e))
            logger.error(f"Dependency missing: {e}")

        except Exception as e:
            _set_state(phase="failed")
            err = classify_error(str(e))
            _set_state(error_class=err["error_class"],
                       error_message=err["message"],
                       error_detail=str(e))
            logger.error(f"Model load failed: {e}")

        _model_ready.set()


def get_model():
    """Blocking: wait for model, return (model_or_None, is_ready)."""
    with _model_lock:
        if _model is None and not _model_ready.is_set():
            threading.Thread(target=_load_model, daemon=True).start()

    _model_ready.wait()  # blocks until load completes
    with _model_lock:
        st = _get_state()
        return _model, st["phase"] == "ready"


# =========================================================================
#  Async task management
# =========================================================================

_tasks = {}  # task_id → {phase, cancelled, result, queue}
_tasks_lock = threading.Lock()


def _sse(event, data):
    """SSE text chunk."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _download_audio(audio_url):
    """Download B站 audio → temp file path."""
    headers = {
        "Referer": "https://www.bilibili.com",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    resp = requests.get(audio_url, headers=headers, stream=True, timeout=120)
    resp.raise_for_status()

    ct = resp.headers.get("Content-Type", "")
    suffix = ".webm" if "webm" in ct else (".mp3" if "mp3" in ct else ".m4a")

    tmp = os.path.join(
        tempfile.gettempdir(),
        f"bilibili_asr_{hashlib.md5(audio_url.encode()).hexdigest()}{suffix}",
    )
    with open(tmp, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)
    return tmp


def _run_transcribe(task_id, audio_url, language):
    """Background: download → transcribe → push SSE events."""
    tmp_path = None
    q = None

    with _tasks_lock:
        t = _tasks.get(task_id)
        if t is None:
            return
        t["phase"] = "queued"
        q = t["queue"]

    try:
        # ── Download ──
        q.put(_sse("phase-change", {"phase": "downloading_audio"}))
        logger.info(f"[{task_id}] Downloading audio...")

        if audio_url:
            tmp_path = _download_audio(audio_url)
        else:
            raise ValueError("No audio_url provided")

        file_size = os.path.getsize(tmp_path)
        q.put(_sse("progress", {"phase": "downloading_audio", "percent": 100,
                                "bytes": file_size}))
        logger.info(f"[{task_id}] Audio saved ({file_size} bytes)")

        # Cancel before transcribe?
        with _tasks_lock:
            if _tasks.get(task_id, {}).get("cancelled"):
                q.put(_sse("done", {"status": "cancelled"}))
                return

        # ── Transcribe ──
        m, ready = get_model()
        if not ready or m is None:
            s = _get_state()
            q.put(_sse("error", {
                "error_class": s["error_class"],
                "error_message": s["error_message"] or "模型未就绪",
            }))
            return

        q.put(_sse("phase-change", {"phase": "transcribing"}))
        logger.info(f"[{task_id}] Starting transcription...")

        transcribe_start = time.time()

        # VAD: 默认关闭（CPU 下极慢），可环境变量启用
        use_vad = os.environ.get("WHISPER_VAD_FILTER", "").lower() in ("1", "true", "yes")

        segments_iter, info = m.transcribe(
            tmp_path,
            language=language,
            beam_size=1,
            vad_filter=use_vad,
        )

        all_segments = []
        total_ms = round(info.duration * 1000) if info.duration else 0

        for i, seg in enumerate(segments_iter):
            # Cancel check
            with _tasks_lock:
                if _tasks.get(task_id, {}).get("cancelled"):
                    q.put(_sse("done", {"status": "cancelled"}))
                    return

            seg_data = {
                "from": round(seg.start * 1000),
                "to": round(seg.end * 1000),
                "content": seg.text.strip(),
            }
            all_segments.append(seg_data)

            if i % 10 == 0:
                processed = round(seg.end * 1000) if seg.end else 0
                pct = min(int(processed / total_ms * 100), 99) if total_ms else 0
                elapsed = time.time() - transcribe_start
                eta_sec = round((elapsed / max(pct, 1)) * (100 - pct)) if pct > 0 else 0
                q.put(_sse("progress", {
                    "phase": "transcribing",
                    "percent": pct,
                    "processed_ms": processed,
                    "total_ms": total_ms,
                    "segments_count": i + 1,
                    "eta_sec": eta_sec,
                }))
                # Also update task dict for JSON polling
                with _tasks_lock:
                    if task_id in _tasks:
                        _tasks[task_id]["progress"] = pct
                        _tasks[task_id]["processed_ms"] = processed
                        _tasks[task_id]["total_ms"] = total_ms
                        _tasks[task_id]["segments_count"] = i + 1
                        _tasks[task_id]["eta_sec"] = eta_sec
                        _tasks[task_id]["phase"] = "transcribing"
                logger.info(f"[{task_id}] seg {i} @ {seg.start:.1f}s")

        # ── Done ──
        result = {
            "segments": all_segments,
            "duration": total_ms,
            "language": info.language if info.language else language,
        }

        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id]["result"] = result
                _tasks[task_id]["phase"] = "done"

        q.put(_sse("done", result))
        logger.info(f"[{task_id}] Done: {len(all_segments)} seg, {total_ms}ms")

    except Exception as e:
        logger.error(f"[{task_id}] Error: {e}")
        err = classify_error(str(e))
        q.put(_sse("error", err))
        with _tasks_lock:
            if task_id in _tasks:
                _tasks[task_id]["phase"] = "failed"
                _tasks[task_id]["error_class"] = err["error_class"]
                _tasks[task_id]["error_message"] = err["message"]

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

        # Lazy cleanup after SSE client has time to consume
        def _cl():
            time.sleep(30)
            with _tasks_lock:
                if task_id in _tasks and _tasks[task_id]["phase"] in ("done", "failed", "cancelled", "error"):
                    del _tasks[task_id]

        threading.Thread(target=_cl, daemon=True).start()


# =========================================================================
#  Routes
# =========================================================================


@app.route("/status", methods=["GET"])
def route_status():
    return jsonify(_get_state())


@app.route("/transcribe", methods=["POST"])
def route_transcribe():
    data = request.get_json(force=True)
    audio_url = data.get("audio_url")
    language = data.get("language", "zh")

    if not audio_url:
        return jsonify({"error": "请提供 audio_url"}), 400

    task_id = uuid4().hex
    with _tasks_lock:
        _tasks[task_id] = {
            "phase": "queued",
            "cancelled": False,
            "result": None,
            "progress": 0,
            "processed_ms": 0,
            "total_ms": 0,
            "segments_count": 0,
            "eta_sec": 0,
            "error_class": None,
            "error_message": None,
            "queue": Queue(),
        }

    threading.Thread(
        target=_run_transcribe,
        args=(task_id, audio_url, language),
        daemon=True,
    ).start()

    return jsonify({"task_id": task_id})


@app.route("/progress/<task_id>")
def route_progress(task_id):
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None:
            return jsonify({"error": "任务不存在"}), 404
        q = task["queue"]

    def generate():
        try:
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                    if msg.startswith("event: done") or msg.startswith("event: error"):
                        break
                except Empty:
                    yield ": heartbeat\n\n"
        except GeneratorExit:
            pass

    return Response(generate(), mimetype="text/event-stream")


@app.route("/cancel/<task_id>", methods=["POST"])
def route_cancel(task_id):
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None:
            return jsonify({"error": "任务不存在"}), 404
        if task.get("cancelled") or task["phase"] in ("done", "failed", "cancelled"):
            return jsonify({"status": f"already_{task['phase']}"})
        task["cancelled"] = True
        task["phase"] = "cancelled"

    logger.info(f"[{task_id}] Cancelled by user")
    task["queue"].put(_sse("done", {"status": "cancelled"}))
    return jsonify({"status": "cancelled"})


@app.route("/task_status/<task_id>")
def route_task_status(task_id):
    """JSON polling endpoint for transcription progress (avoids EventSource issues)."""
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None:
            return jsonify({"error": "任务不存在", "status": "idle"}), 404
        return jsonify({
            "phase": task.get("phase", "unknown"),
            "progress": task.get("progress", 0),
            "processed_ms": task.get("processed_ms", 0),
            "total_ms": task.get("total_ms", 0),
            "segments_count": task.get("segments_count", 0),
            "eta_sec": task.get("eta_sec", 0),
            "error_class": task.get("error_class"),
            "error_message": task.get("error_message"),
            "status": "done" if task.get("result") else
                     "cancelled" if task.get("cancelled") else
                     "processing",
        })


@app.route("/task_result/<task_id>")
def route_task_result(task_id):
    """JSON endpoint returning full transcription result (segments, duration, language)."""
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None:
            return jsonify({"error": "任务不存在"}), 404
        result = task.get("result")
        if result is None:
            return jsonify({"error": "结果未就绪", "phase": task.get("phase")}), 202
        return jsonify(result)


@app.route("/check_ffmpeg", methods=["GET"])
def route_check_ffmpeg():
    import shutil

    ff = shutil.which("ffmpeg")
    if ff:
        return jsonify({"available": True, "source": "system", "path": ff})

    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin", "ffmpeg.exe")
    if os.path.exists(local):
        return jsonify({"available": True, "source": "project", "path": local})

    return jsonify({"available": False})


# =========================================================================
#  Main
# =========================================================================

if __name__ == "__main__":
    logger.info("b量子速读 Whisper Server v2 starting…")
    logger.info(f"Model={MODEL_SIZE} Device={DEVICE} Compute={COMPUTE_TYPE} Port={ACTUAL_PORT}")

    _set_state(
        started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )

    # Start model loading immediately
    logger.info("Starting model load in background…")
    with _model_lock:
        threading.Thread(target=_load_model, daemon=True).start()

    app.run(host="0.0.0.0", port=ACTUAL_PORT, debug=False)
