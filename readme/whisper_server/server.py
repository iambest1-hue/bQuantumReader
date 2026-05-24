"""
b量子阅读 - 本地 Whisper 语音识别服务

用法:
  1. pip install -r requirements.txt
  2. python server.py
  3. 服务默认运行在 http://localhost:8787

接口:
  POST /transcribe
    参数: {"audio_url": "https://..."} 或 {"audio_file": "<base64>"}
    返回: {"segments": [{"from": 0, "to": 3.5, "content": "识别文本"}]}

  GET /status
    返回: {"ready": true, "model": "large-v3"}
"""

import os
import sys
import tempfile
import hashlib
import threading
from pathlib import Path

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
PORT = int(os.environ.get("WHISPER_PORT", "8787"))

model = None
model_lock = threading.Lock()


def get_model():
    global model
    with model_lock:
        if model is None:
            from faster_whisper import WhisperModel
            print(f"Loading Whisper model: {MODEL_SIZE} (device={DEVICE}, compute_type={COMPUTE_TYPE})")
            model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
            print("Model loaded successfully")
    return model


@app.route("/status", methods=["GET"])
def status():
    return jsonify({
        "ready": model is not None,
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    })


@app.route("/transcribe", methods=["POST"])
def transcribe():
    data = request.get_json(force=True)
    audio_url = data.get("audio_url")
    audio_b64 = data.get("audio_file")
    language = data.get("language", "zh")

    if not audio_url and not audio_b64:
        return jsonify({"error": "请提供 audio_url 或 audio_file"}), 400

    # Download or decode audio
    tmp_path = None
    try:
        if audio_url:
            print(f"Downloading audio from: {audio_url[:80]}...")
            # B站音频URL需要带Referer
            headers = {
                "Referer": "https://www.bilibili.com",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            resp = requests.get(audio_url, headers=headers, stream=True, timeout=120)
            resp.raise_for_status()

            suffix = ".m4a"
            content_type = resp.headers.get("Content-Type", "")
            if "webm" in content_type:
                suffix = ".webm"
            elif "mp3" in content_type:
                suffix = ".mp3"

            tmp_path = os.path.join(tempfile.gettempdir(), f"bilibili_asr_{hashlib.md5(audio_url.encode()).hexdigest()}{suffix}")
            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"Audio saved to: {tmp_path}")
        else:
            import base64
            audio_bytes = base64.b64decode(audio_b64)
            tmp_path = os.path.join(tempfile.gettempdir(), f"bilibili_asr_upload.m4a")
            with open(tmp_path, "wb") as f:
                f.write(audio_bytes)

        # Transcribe
        m = get_model()
        print("Starting transcription...")
        print(f"File size: {os.path.getsize(tmp_path)} bytes")
        segments_iter, info = m.transcribe(
            tmp_path,
            language=language,
            beam_size=1,
        )

        segments = []
        for i, seg in enumerate(segments_iter):
            if i % 50 == 0:
                print(f"Transcribing segment {i}... ({seg.start:.1f}s - {seg.end:.1f}s)")
            segments.append({
                "from": round(seg.start * 1000),  # ms
                "to": round(seg.end * 1000),
                "content": seg.text.strip(),
            })

        print(f"Transcription done: {len(segments)} segments, {info.duration:.1f}s")

        return jsonify({
            "segments": segments,
            "duration": round(info.duration * 1000),
            "language": info.language,
        })

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return jsonify({"error": str(e)}), 500

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


if __name__ == "__main__":
    # Pre-load model on startup
    print(f"b量子阅读 Whisper Server starting on port {PORT}...")
    print(f"Model: {MODEL_SIZE}, Device: {DEVICE}, Compute: {COMPUTE_TYPE}")
    print("Pre-loading model... (this may take a while on first run)")

    threading.Thread(target=get_model, daemon=True).start()

    app.run(host="0.0.0.0", port=PORT, debug=False)
