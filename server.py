#!/usr/bin/env python3
"""FROSTLINE static server. Python standard library only."""

import argparse
import errno
import ipaddress
import mimetypes
import os
from pathlib import Path
import shutil
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Timer
from urllib.parse import unquote, urlsplit
import webbrowser


ROOT = Path(__file__).resolve().parent
GAME_FILES = frozenset({
    "index.html", "style.css", "app.js", "input.js", "audio.js",
    "campaign.js", "base-scene.js", "vehicle-catalog.js", "destroyer.js", "naval-models.js", "ambient-fleet.js", "ship-camera.js", "simulation.js", "renderer.js", "world-math.js", "sw.js",
    "aircraft-systems.js", "aircraft-stores.js", "hangar-workshop.js", "docs/aircraft-systems.md",
    "aircraft.js", "fa18.js", "assets/models/fa18c.metadata.json", "assets/models/f18-source/F-A-18C-rebuilt-v2.blend", "atmosphere.js", "water-reflection.js", "flight-presentation.js", "terrain.js", "chase-camera.js", "speed-effects.js",
    "manifest.webmanifest",
})
ASSET_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".avif",
    ".ogg", ".mp3", ".wav", ".woff", ".woff2", ".glb", ".gltf", ".bin",
})
MIME_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".md": "text/plain; charset=utf-8",
}


def game_path(request_target):
    """Resolve an explicitly allowed public game file, never a directory."""
    try:
        url_path = unquote(urlsplit(request_target).path, errors="strict")
    except (UnicodeError, ValueError):
        return None
    if "\\" in url_path or "\0" in url_path:
        return None
    if url_path == "/":
        relative = "index.html"
    else:
        if not url_path.startswith("/"):
            return None
        relative = url_path[1:]
    parts = relative.split("/")
    if any(not part or part.startswith(".") for part in parts):
        return None
    allowed = relative in GAME_FILES
    if len(parts) >= 2 and parts[0] == "assets":
        allowed = allowed or Path(relative).suffix.lower() in ASSET_EXTENSIONS
    if len(parts) == 2 and parts[0] == "vendor":
        allowed = parts[1] in {"three.module.js", "GLTFLoader.js", "BufferGeometryUtils.js"}
    if not allowed:
        return None
    candidate = ROOT / relative
    # Do not serve symlinks, including links from an allowed asset directory.
    cursor = ROOT
    for part in parts:
        cursor = cursor / part
        if cursor.is_symlink():
            return None
    try:
        resolved = candidate.resolve()
        resolved.relative_to(ROOT)
        return resolved if resolved.is_file() else None
    except (OSError, ValueError):
        return None


class GameHandler(BaseHTTPRequestHandler):
    server_version = "FROSTLINE"
    sys_version = ""

    def do_GET(self):
        self.serve_file(send_body=True)

    def do_HEAD(self):
        self.serve_file(send_body=False)

    def serve_file(self, send_body):
        path = game_path(self.path)
        if path is None:
            self.send_error(404, "Game resource not found")
            return
        try:
            stream = path.open("rb")
        except OSError:
            self.send_error(404, "Game resource not found")
            return
        with stream:
            stat = os.fstat(stream.fileno())
            content_type = MIME_TYPES.get(path.suffix.lower())
            if not content_type:
                content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(stat.st_size))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "same-origin")
            self.end_headers()
            if send_body:
                try:
                    shutil.copyfileobj(stream, self.wfile)
                except (BrokenPipeError, ConnectionResetError):
                    pass

    def log_message(self, fmt, *args):
        # Keep normal play quiet while retaining request failures for diagnosis.
        if len(args) >= 2 and str(args[1]).isdigit() and int(args[1]) < 400:
            return
        super().log_message(fmt, *args)


def lan_addresses():
    """Find assigned IPv4 addresses without sending a network request."""
    addresses = set()
    try:
        for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(result[4][0])
    except OSError:
        pass
    # UDP connect selects the default route's local address; no data is sent.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            addresses.add(probe.getsockname()[0])
    except OSError:
        pass
    result = []
    for address in addresses:
        parsed = ipaddress.ip_address(address)
        if not (parsed.is_loopback or parsed.is_unspecified or parsed.is_link_local):
            result.append(address)
    return sorted(result)


def port_number(value):
    try:
        port = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("端口须为 1–65535 的整数") from error
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("端口须为 1–65535 的整数")
    return port


def port_is_listening(port, addresses):
    # macOS can allow a wildcard bind over an existing loopback listener when
    # SO_REUSEADDR is set. Detect active local services before attempting bind.
    # Some TUN/VPN adapters report successful connects to arbitrary ports.
    # Only loopback connect is authoritative here; the subsequent OS bind
    # handles other real interface conflicts without touching their processes.
    for address in ["127.0.0.1"]:
        try:
            with socket.create_connection((address, port), timeout=0.2):
                return True
        except OSError:
            continue
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="霜线 FROSTLINE 本地单机服务器（无需 pip）")
    parser.add_argument("--port", type=port_number, default=8766, help="监听端口，默认 8766")
    parser.add_argument("--no-open", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args(argv)
    addresses = lan_addresses()
    try:
        if port_is_listening(args.port, addresses):
            raise OSError(errno.EADDRINUSE, "Port already has a local listener")
        server = ThreadingHTTPServer(("0.0.0.0", args.port), GameHandler)
    except OSError as error:
        if error.errno in (errno.EADDRINUSE, 10048):
            print(f"端口 {args.port} 已被占用。未停止任何进程。", file=sys.stderr)
            print("请关闭已运行的游戏服务，或使用 python3 server.py --port 8767", file=sys.stderr)
        else:
            print(f"无法启动服务：{error}", file=sys.stderr)
        return 1
    local_url = f"http://127.0.0.1:{server.server_port}/"
    print("\n霜线 FROSTLINE · 单机空战", flush=True)
    print(f"本机地址：{local_url}", flush=True)
    for address in addresses:
        print(f"手机候选地址：http://{address}:{server.server_port}/", flush=True)
    if addresses:
        print("手机与电脑连接同一 Wi-Fi，在手机浏览器输入对应局域网地址。", flush=True)
    else:
        print("未检测到局域网 IPv4 地址。连接 Wi-Fi 后重新启动服务。", flush=True)
    print("如有多个地址，请选 Wi-Fi 网卡的地址；需允许系统防火墙的本地网络访问。", flush=True)
    print("无需互联网；手机游玩时请保持此窗口开启。按 Ctrl+C 停止。\n", flush=True)
    no_open = args.no_open or os.environ.get("NO_OPEN", "").lower() in {"1", "true", "yes", "on"}
    opener = None
    if not no_open:
        opener = Timer(0.5, lambda: webbrowser.open(local_url))
        opener.daemon = True
        opener.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n飞行服务已停止。", flush=True)
    finally:
        if opener is not None:
            opener.cancel()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
