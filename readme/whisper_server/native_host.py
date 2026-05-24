"""
b量子阅读 - Native Messaging Host (预留)

Chrome 扩展通过 Native Messaging 与此脚本通信，实现真正的一键启停 Whisper 服务。

安装方法:
  1. 修改 com.bquantum.whisper.json 中的 "path" 为本文件绝对路径
  2. 将 com.bquantum.whisper.json 复制到 Chrome NativeMessagingHosts 目录:
     Windows: %USERPROFILE%\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts\
  3. 重启 Chrome，扩展即可通过 chrome.runtime.connectNative 与此脚本通信

协议 (stdin/stdout JSON):
  → {"command": "start"}
  ← {"status": "ok", "pid": 12345}
  → {"command": "stop"}
  ← {"status": "ok"}
  → {"command": "status"}
  ← {"status": "running", "pid": 12345}
"""

import json
import os
import signal
import struct
import subprocess
import sys
import threading


def read_message():
    """读取 Chrome 发来的 Native Messaging 消息"""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    length = struct.unpack("=I", raw_length)[0]
    return json.loads(sys.stdin.buffer.read(length).decode("utf-8"))


def send_message(msg):
    """向 Chrome 发送 Native Messaging 消息"""
    data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    server_process = None
    script_dir = os.path.dirname(os.path.abspath(__file__))

    while True:
        msg = read_message()
        if msg is None:
            break

        command = msg.get("command", "")

        if command == "start":
            if server_process and server_process.poll() is None:
                send_message({"status": "ok", "pid": server_process.pid, "msg": "已经在运行"})
            else:
                server_process = subprocess.Popen(
                    [sys.executable, os.path.join(script_dir, "server.py")],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                send_message({"status": "ok", "pid": server_process.pid, "msg": "服务已启动"})

        elif command == "stop":
            if server_process and server_process.poll() is None:
                server_process.terminate()
                try:
                    server_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server_process.kill()
                send_message({"status": "ok", "msg": "服务已停止"})
            else:
                send_message({"status": "ok", "msg": "服务未在运行"})
            server_process = None

        elif command == "status":
            running = server_process is not None and server_process.poll() is None
            send_message({
                "status": "running" if running else "stopped",
                "pid": server_process.pid if running else None,
            })

        else:
            send_message({"status": "error", "msg": f"未知命令: {command}"})


if __name__ == "__main__":
    main()
