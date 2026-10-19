"""时光：仅使用 Python 标准库的网页与 SQLite 同步服务。"""
from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit
import webbrowser
from contextlib import contextmanager, closing

ROOT = Path(__file__).resolve().parent
WEB = ROOT
PUBLIC_FILES = {"index.html", "styles.css", "app.js", "core.js", "sw.js", "icon.svg", "manifest.webmanifest"}
CATEGORIES = {"work", "study", "life", "health", "rest", "other"}
CHINA = timezone(timedelta(hours=8))
MAX_BODY = 20 * 1024 * 1024
EMPTY = {"version": 1, "records": [], "todos": [], "days": {}}


def valid_number(value):
    return type(value) in (int, float) and 0 <= value <= 253402271999000


def validate_state(data):
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("备份格式不正确。")
    records, todos, days = data.get("records"), data.get("todos"), data.get("days")
    if not isinstance(records, list) or not isinstance(todos, list) or not isinstance(days, dict):
        raise ValueError("数据结构不正确。")
    if len(records) > 100000 or len(todos) > 50000 or len(days) > 50000:
        raise ValueError("数据量超出限制。")
    now = time.time() * 1000
    clean = {"version": 1, "records": [], "todos": [], "days": {}}
    for field, items in (("records", records), ("todos", todos)):
        ids = set()
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("事项格式不正确。")
            identity, title = item.get("id"), item.get("title")
            start, end = item.get("start"), item.get("end")
            category = item.get("category")
            if not isinstance(identity, str) or not identity or len(identity) > 128 or identity in ids:
                raise ValueError("事项编号缺失或重复。")
            if not isinstance(title, str) or not title.strip() or len(title) > 500:
                raise ValueError("事项名称需为 1 至 500 字。")
            if not valid_number(start) or not valid_number(end) or end <= start or category not in CATEGORIES:
                raise ValueError("事项的起止时间或分类不正确。")
            if field == "records" and (end > now + 1000 or end - start > 31 * 86400000):
                raise ValueError("实际记录不能在未来，且单条不能超过 31 天。")
            ids.add(identity)
            result = {"id": identity, "title": title.strip(), "start": start, "end": end, "category": category,
                      "createdAt": item.get("createdAt") if valid_number(item.get("createdAt")) else now}
            if field == "records":
                result["updatedAt"] = item.get("updatedAt") if valid_number(item.get("updatedAt")) else now
            else:
                if not isinstance(item.get("notes", ""), str) or len(item.get("notes", "")) > 2000:
                    raise ValueError("待办备注不能超过 2000 字。")
                result.update(done=bool(item.get("done")), notes=item.get("notes", ""))
            clean[field].append(result)
    clean["records"].sort(key=lambda r: r["start"])
    for before, after in zip(clean["records"], clean["records"][1:]):
        if before["end"] > after["start"]:
            raise ValueError("时间记录不能重叠。")
    for day, start in days.items():
        if not isinstance(day, str) or len(day) != 10 or not valid_number(start) or start > now:
            raise ValueError("每日起点不正确。")
        if datetime.fromtimestamp(start / 1000, CHINA).strftime("%Y-%m-%d") != day:
            raise ValueError("每日起点不在对应日期内。")
        clean["days"][day] = start
    return clean


class Store:
    def __init__(self, folder: Path):
        self.folder = folder
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "shiguang.sqlite3"
        self.lock = threading.Lock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, data TEXT NOT NULL)")
            db.execute("INSERT OR IGNORE INTO journal VALUES (1, 0, ?)", (json.dumps(EMPTY),))
        # A startup snapshot permits recovery even after an accidental import.
        backup_dir = folder / "backups"
        backup_dir.mkdir(exist_ok=True)
        backup = backup_dir / (datetime.now(CHINA).strftime("%Y-%m-%d") + ".sqlite3")
        if not backup.exists():
            with self.connect() as src, closing(sqlite3.connect(backup)) as dest:
                src.backup(dest)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        try:
            db.execute("PRAGMA busy_timeout=15000")
            with db:
                yield db
        finally:
            db.close()

    def read(self):
        with self.connect() as db:
            revision, data = db.execute("SELECT revision, data FROM journal WHERE id=1").fetchone()
        return {"revision": revision, "state": json.loads(data)}

    def write(self, state, expected):
        clean = validate_state(state)
        with self.lock, self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            revision = db.execute("SELECT revision FROM journal WHERE id=1").fetchone()[0]
            if revision != expected:
                raise ConflictError("另一台设备已更新数据，请刷新后重试。")
            revision += 1
            db.execute("UPDATE journal SET revision=?, data=? WHERE id=1",
                       (revision, json.dumps(clean, ensure_ascii=False, allow_nan=False)))
        return {"revision": revision, "state": clean}


class ConflictError(Exception):
    pass


def make_handler(store: Store, token: str, port: int, lan: bool):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Shiguang/1.0"

        def log_message(self, fmt, *args):
            # Do not log URLs, access keys, authorization, or activity text.
            if len(args) > 1 and str(args[1]).startswith("5"):
                print("Service error:", args[1], flush=True)

        def respond(self, status, payload, content_type="application/json; charset=utf-8", head=False):
            if isinstance(payload, (dict, list)):
                payload = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            elif isinstance(payload, str):
                payload = payload.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
            self.end_headers()
            if not head:
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        def authenticated(self):
            provided = self.headers.get("Authorization", "").removeprefix("Bearer ")
            if not hmac.compare_digest(provided.encode(), token.encode()):
                self.respond(401, {"error": "访问码不正确，请重新连接。"})
                return False
            return True

        def do_HEAD(self):
            self.do_GET(head=True)

        def do_GET(self, head=False):
            path = urlsplit(self.path).path
            if path == "/api/health":
                return self.respond(200, {"service": "shiguang", "version": 1}, head=head)
            if path.startswith("/api/"):
                if not self.authenticated():
                    return
                if path == "/api/state":
                    return self.respond(200, store.read(), head=head)
                if path == "/api/info":
                    addresses = []
                    if lan:
                        try:
                            addresses = sorted({item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET) if not item[4][0].startswith("127.")})
                        except OSError:
                            pass
                    urls = [f"http://{address}:{port}" for address in addresses] or [f"http://127.0.0.1:{port}"]
                    return self.respond(200, {"urls": urls, "lan": lan}, head=head)
                return self.respond(404, {"error": "接口不存在。"}, head=head)
            try:
                relative = unquote(path).lstrip("/") or "index.html"
                if relative not in PUBLIC_FILES:
                    return self.respond(404, "Not found", "text/plain; charset=utf-8", head=head)
                file = (WEB / relative).resolve()
                if not file.is_relative_to(WEB.resolve()) or not file.is_file():
                    return self.respond(404, "Not found", "text/plain; charset=utf-8", head=head)
                types = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"}
                mime = types.get(file.suffix, mimetypes.guess_type(file.name)[0] or "application/octet-stream")
                self.respond(200, file.read_bytes(), mime, head=head)
            except (OSError, ValueError):
                self.respond(400, "Invalid path", "text/plain; charset=utf-8", head=head)

        def do_PUT(self):
            if urlsplit(self.path).path != "/api/state":
                return self.respond(404, {"error": "接口不存在。"})
            if not self.authenticated():
                return
            origin = self.headers.get("Origin")
            if origin and origin != "http://" + self.headers.get("Host", ""):
                return self.respond(403, {"error": "只允许从当前服务页面修改数据。"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY:
                    return self.respond(413, {"error": "数据大小需在 20 MB 以内。"})
                if not self.headers.get("Content-Type", "").startswith("application/json"):
                    return self.respond(415, {"error": "需要 JSON 格式。"})
                expected = int(self.headers.get("If-Match", "-1"))
                data = json.loads(self.rfile.read(length), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("数值不正确。")))
                result = store.write(data, expected)
                self.respond(200, result)
            except ConflictError as error:
                self.respond(409, {"error": str(error)})
            except (ValueError, TypeError, KeyError, OverflowError, UnicodeError) as error:
                self.respond(400, {"error": "数据校验失败：" + str(error)[:180]})
            except sqlite3.Error:
                self.respond(503, {"error": "数据库暂时无法写入，你的原数据未被覆盖，请重试。"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="时光时间手记服务（Python 标准库，无需安装依赖）")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--lan", action="store_true", help="允许同一 Wi-Fi 的手机连接")
    parser.add_argument("--open", action="store_true", help="启动后在浏览器打开")
    parser.add_argument("--data-dir", type=Path, default=ROOT / ".data")
    parser.add_argument("--quiet", action="store_true", help="不在终端显示含访问码的地址")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("端口必须在 1 至 65535 之间")
    folder = args.data_dir.resolve()
    store = Store(folder)
    key_file = folder / "access.key"
    if key_file.exists():
        token = key_file.read_text(encoding="utf-8").strip()
        if len(token) < 32:
            raise SystemExit("访问码文件损坏，请恢复 access.key 或移走该文件后重启。")
    else:
        token = secrets.token_urlsafe(32)
        key_file.write_text(token, encoding="utf-8")
        try:
            os.chmod(key_file, 0o600)
        except OSError:
            pass
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    try:
        httpd = ThreadingHTTPServer((host, args.port), make_handler(store, token, args.port, args.lan))
    except OSError as error:
        raise SystemExit(f"无法启动服务（端口可能已占用）：{error}")
    httpd.daemon_threads = True
    url = f"http://127.0.0.1:{args.port}/#key={token}"
    print(f"Shiguang is ready on port {args.port}. Press Ctrl+C to stop.", flush=True)
    if not args.quiet:
        print(f"Open on this computer: {url}", flush=True)
        if args.lan:
            print("Phone: open Settings > Phone connection in the app (same Wi-Fi).", flush=True)
    if args.open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever(poll_interval=0.4)
    except KeyboardInterrupt:
        print("\nShiguang stopped. Your data is saved.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
