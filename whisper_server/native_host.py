"""
b量子阅读 - Native Messaging Host

Chrome 扩展通过 Native Messaging 与此脚本通信，实现一键启停 Whisper 服务。

协议 (stdin/stdout JSON 帧):
  → {"command": "start"}    ← {"status": "ok", "pid": 12345}
  → {"command": "stop"}     ← {"status": "ok"}
  → {"command": "status"}   ← {"status": "running"|"stopped", ...full_state}
  → {"command": "install_check"}  ← install_state.json content
  ← native_host → extension: {"event": "restarting"|"crashed", ...}

安装:
  由 install.ps1 注册到 Chrome NativeMessagingHosts 目录
"""

import json
import os
import struct
import subprocess
import sys
import threading
import time
import logging
from pathlib import Path

# ── Logging (to file, not stdout - stdout is for native messaging) ──
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(
    filename=LOG_DIR / "native_host.log",
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    encoding="utf-8",
)
logger = logging.getLogger("native_host")


def read_message():
    """Read a Native Messaging message from stdin."""
    raw = sys.stdin.buffer.read(4)
    if not raw:
        return None
    length = struct.unpack("=I", raw)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(msg):
    """Send a Native Messaging message to stdout."""
    data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


# ── Helpers ──

def find_venv_python():
    """Find venv python: install_state → .venv → sys.executable."""
    script_dir = Path(__file__).parent

    # 1. install_state.json
    state_file = script_dir / "install_state.json"
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
            vp = state.get("venv_python")
            if vp and os.path.exists(vp):
                return vp
        except Exception:
            pass

    # 2. .venv
    vp = script_dir / ".venv" / "Scripts" / "python.exe"
    if vp.exists():
        return str(vp)

    # 3. fallback: same interpreter
    return sys.executable


def read_runtime():
    """Read runtime.json for port info."""
    path = Path(__file__).parent / "runtime.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


class ServerSupervisor:
    """Manages server.py subprocess lifecycle."""

    def __init__(self):
        self.proc = None
        self._lock = threading.Lock()
        self._stop_watch = False
        self.restart_count = 0

    def start(self):
        """Start server.py via venv python."""
        with self._lock:
            if self.proc and self.proc.poll() is None:
                logger.info("Server already running")
                return self.proc.pid

            python_exe = find_venv_python()
            server_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")
            log_dir = Path(__file__).parent / "logs"

            stdout_log = open(log_dir / "server_stdout.log", "a", encoding="utf-8")
            stderr_log = open(log_dir / "server_stderr.log", "a", encoding="utf-8")

            logger.info(f"Starting server: {python_exe} {server_py}")
            self.proc = subprocess.Popen(
                [python_exe, server_py],
                stdout=stdout_log,
                stderr=stderr_log,
                cwd=os.path.dirname(server_py),
            )

            self.restart_count = 0
            self._stop_watch = False
            t = threading.Thread(target=self._watcher, args=(stdout_log, stderr_log), daemon=True)
            t.start()

            return self.proc.pid

    def _watcher(self, stdout_log, stderr_log):
        """Monitor subprocess, auto-restart on crash."""
        while not self._stop_watch:
            rc = self.proc.wait()
            if self._stop_watch:
                break
            logger.warning(f"Server exited with code {rc}")

            # Read server.log tail for diagnostics
            server_log = Path(__file__).parent / "logs" / "server.log"
            reason = "unknown"
            if server_log.exists():
                try:
                    lines = server_log.read_text(encoding="utf-8").strip().split("\n")
                    tail = "\n".join(lines[-20:])
                    if "Address already in use" in tail or "EADDRINUSE" in tail:
                        reason = "port_in_use"
                    elif "No module named" in tail:
                        reason = "deps_missing"
                    elif "ffmpeg" in tail.lower():
                        reason = "ffmpeg_missing"
                except Exception:
                    pass

            backoff = [5, 10, 30][min(self.restart_count, 2)]
            self.restart_count += 1

            self._emit_event("restarting", {"reason": reason, "delay": backoff, "attempt": self.restart_count})
            logger.info(f"Restarting in {backoff}s (attempt {self.restart_count})...")
            time.sleep(backoff)

            if self.restart_count > 3:
                self._emit_event("crashed", {"reason": reason, "fatal": True})
                logger.error("Fatal: max restart attempts reached")
                break

            self._restart(stdout_log, stderr_log)

        # Cleanup file handles
        try:
            stdout_log.close()
            stderr_log.close()
        except Exception:
            pass

    def _restart(self, stdout_log, stderr_log):
        python_exe = find_venv_python()
        server_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")
        self.proc = subprocess.Popen(
            [python_exe, server_py],
            stdout=stdout_log,
            stderr=stderr_log,
            cwd=os.path.dirname(server_py),
        )
        logger.info(f"Server restarted (pid={self.proc.pid})")

    def stop(self):
        """Stop server gracefully."""
        with self._lock:
            self._stop_watch = True
            if self.proc and self.proc.poll() is None:
                logger.info("Stopping server...")
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait()
                logger.info("Server stopped")
            self.proc = None

    def status(self):
        """Return full status: process + HTTP /status."""
        running = self.proc is not None and self.proc.poll() is None
        result = {
            "native_host": "running",
            "server_process": "running" if running else "stopped",
            "pid": self.proc.pid if running else None,
        }

        # Try to get HTTP /status from server
        if running:
            try:
                import requests
                port = read_runtime().get("port", 8787)
                r = requests.get(f"http://127.0.0.1:{port}/status", timeout=2)
                result["server_http"] = r.json()
            except Exception:
                result["server_http"] = None

        return result

    def _emit_event(self, event, data):
        """Push event to extension via native messaging."""
        try:
            send_message({"event": event, **data})
        except Exception:
            pass


# ── Main ──

def main():
    supervisor = ServerSupervisor()
    logger.info("Native Host started")

    while True:
        msg = read_message()
        if msg is None:
            logger.info("stdin closed, exiting")
            break

        command = msg.get("command", "")
        logger.info(f"Command: {command}")

        if command == "start":
            try:
                pid = supervisor.start()
                send_message({"status": "ok", "pid": pid, "msg": "服务已启动"})
            except Exception as e:
                logger.error(f"Start failed: {e}")
                send_message({"status": "error", "msg": str(e)})

        elif command == "stop":
            supervisor.stop()
            send_message({"status": "ok", "msg": "服务已停止"})

        elif command == "status":
            try:
                st = supervisor.status()
                send_message({"status": st["server_process"], "detail": st})
            except Exception as e:
                send_message({"status": "error", "msg": str(e)})

        elif command == "install_check":
            state_path = Path(__file__).parent / "install_state.json"
            if state_path.exists():
                try:
                    state = json.loads(state_path.read_text(encoding="utf-8"))
                    send_message({"status": "ok", "install_state": state})
                except Exception as e:
                    send_message({"status": "error", "msg": f"读取安装状态失败: {e}"})
            else:
                send_message({"status": "error", "msg": "install_state.json 不存在，请先运行 install.bat"})

        else:
            send_message({"status": "error", "msg": f"未知命令: {command}"})

    supervisor.stop()
    logger.info("Native Host exiting")


if __name__ == "__main__":
    main()
