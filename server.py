#!/usr/bin/env python3
"""
BNU Sparks · 木铎星火 — 本地开发服务器
运行: python3 server.py
访问: http://localhost:8000
局域网: http://<本机IP>:8000
"""

import http.server
import socket
import sys
from pathlib import Path

HOST = "0.0.0.0"  # 监听所有网络接口（局域网可访问）
PORT = 8000
PUBLIC_DIR = Path(__file__).parent / "public"


class BNUHandler(http.server.SimpleHTTPRequestHandler):
    """自定义请求处理器"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def end_headers(self):
        # 允许局域网跨设备访问（CORS）
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def log_message(self, format, *args):
        # 美化日志输出
        status = args[1] if len(args) > 1 else ""
        path = args[0] if args else ""
        emoji = "✓" if status.startswith("2") else "✗" if status.startswith("4") or status.startswith("5") else "→"
        print(f"  {emoji} {path} [{status}]")


def get_local_ip():
    """获取本机局域网 IP 地址"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    local_ip = get_local_ip()

    server = http.server.HTTPServer((HOST, PORT), BNUHandler)

    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║     BNU Sparks · 木铎星火 服务器已启动    ║")
    print("  ╚══════════════════════════════════════════╝")
    print()
    print(f"  本地:    http://localhost:{PORT}")
    print(f"  局域网:   http://{local_ip}:{PORT}")
    print(f"  目录:     {PUBLIC_DIR}")
    print()
    print("  按 Ctrl+C 停止服务器")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务器已停止\n")
        server.server_close()
        sys.exit(0)


if __name__ == "__main__":
    main()
