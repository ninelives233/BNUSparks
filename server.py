#!/usr/bin/env python3
"""
BNU Sparks · 木铎星火 — 本地开发服务器
运行: python3 server.py
访问: http://localhost:8000
局域网: http://<本机IP>:8000
"""

import socket
import subprocess
import sys
from pathlib import Path


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
    port = 8000
    local_ip = get_local_ip()

    print()
    print("  ╔══════════════════════════════════════════╗")
    print("  ║     BNU Sparks · 木铎星火 服务器已启动    ║")
    print("  ╚══════════════════════════════════════════╝")
    print()
    print(f"  本地:    http://localhost:{port}")
    print(f"  局域网:   http://{local_ip}:{port}")
    print()
    print("  Django 管理后台: http://localhost:8000/admin/")
    print("  管理员账号: admin / admin123")
    print()
    print("  按 Ctrl+C 停止服务器")
    print()

    try:
        subprocess.run([
            sys.executable, "manage.py", "runserver",
            f"0.0.0.0:{port}",
        ], check=True)
    except KeyboardInterrupt:
        print("\n  服务器已停止\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
