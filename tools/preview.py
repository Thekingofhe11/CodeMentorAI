"""Serve the CodeMentor fixture on loopback; never expose arbitrary project files."""
from __future__ import annotations

import argparse
import http.client
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
STATIC_FILES = {
    "/preview.js": (ROOT / "tools" / "preview.js", "text/javascript; charset=utf-8"),
    "/preview.css": (ROOT / "tools" / "preview.css", "text/css; charset=utf-8"),
    "/extension/core.js": (ROOT / "extension" / "core.js", "text/javascript; charset=utf-8"),
    "/extension/glass.js": (ROOT / "extension" / "glass.js", "text/javascript; charset=utf-8"),
    "/extension/visual-loader.js": (ROOT / "extension" / "visual-loader.js", "text/javascript; charset=utf-8"),
    "/extension/assets/visuals.js": (ROOT / "extension" / "assets" / "visuals.js", "text/javascript; charset=utf-8"),
    "/extension/content.js": (ROOT / "extension" / "content.js", "text/javascript; charset=utf-8"),
    "/extension/styles.css": (ROOT / "extension" / "styles.css", "text/css; charset=utf-8"),
    "/extension/popup.css": (ROOT / "extension" / "popup.css", "text/css; charset=utf-8"),
    "/extension/popup.js": (ROOT / "extension" / "popup.js", "text/javascript; charset=utf-8"),
    "/popup-preview.js": (ROOT / "tools" / "popup-preview.js", "text/javascript; charset=utf-8"),
    "/popup-preview.css": (ROOT / "tools" / "popup-preview.css", "text/css; charset=utf-8"),
}
PROBLEM_PATHS = {f"/problems/{slug}/" for slug in ("two-sum", "valid-parentheses", "binary-search")}
MAX_BODY = 300_000
# Allow a 12,000-character reply even when JSON escapes its Unicode characters.
MAX_RESPONSE_BYTES = 150_000


class PreviewHandler(BaseHTTPRequestHandler):
    def send_bytes(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status: int, data: dict) -> None:
        self.send_bytes(status, json.dumps(data).encode("utf-8"))

    def proxy(self, endpoint: str, body: bytes | None = None) -> None:
        connection = http.client.HTTPConnection("127.0.0.1", 8000, timeout=4 if body is None else 60)
        try:
            connection.request("POST" if body is not None else "GET", endpoint, body=body,
                               headers={"Content-Type": "application/json"} if body is not None else {})
            response = connection.getresponse()
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                self.send_json(502, {"detail": "The local backend response was too large."})
            else:
                self.send_bytes(response.status, data)
        except (OSError, http.client.HTTPException):
            self.send_json(503, {"detail": "Cannot reach CodeMentor. Start the backend on 127.0.0.1:8000, then try again."})
        finally:
            connection.close()

    def do_GET(self) -> None:
        route = urlsplit(self.path).path
        if route == "/":
            self.send_response(302)
            self.send_header("Location", "/problems/two-sum/")
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif route == "/api/health":
            self.proxy("/health")
        elif route in PROBLEM_PATHS:
            self.send_bytes(200, (ROOT / "tools" / "preview.html").read_bytes(), "text/html; charset=utf-8")
        elif route == "/popup/":
            self.send_bytes(200, (ROOT / "tools" / "popup-preview.html").read_bytes(), "text/html; charset=utf-8")
        elif route == "/extension/popup.html":
            # Exercise the real popup markup. The Chrome mock is confined to this fixture.
            popup = (ROOT / "extension" / "popup.html").read_text(encoding="utf-8")
            popup = popup.replace('<script src="glass.js" defer></script>',
                                  '<script src="/popup-preview.js" defer></script>\n    <script src="glass.js" defer></script>')
            self.send_bytes(200, popup.encode("utf-8"), "text/html; charset=utf-8")
        elif route in STATIC_FILES:
            file_path, mime = STATIC_FILES[route]
            self.send_bytes(200, file_path.read_bytes(), mime)
        else:
            self.send_json(404, {"detail": "This preview only serves its fixture and extension assets."})

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/mentor":
            self.send_json(404, {"detail": "Unknown preview endpoint."})
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
            self.send_json(415, {"detail": "Expected application/json."})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size <= 0 or size > MAX_BODY:
            self.send_json(413, {"detail": "The request must contain at most 300 KB of JSON."})
            return
        body = self.rfile.read(size)
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"detail": "Invalid JSON."})
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"detail": "Expected a mentor request object."})
            return
        self.proxy("/mentor", body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), PreviewHandler)
    print(f"CodeMentor preview: http://127.0.0.1:{args.port}/problems/two-sum/", flush=True)
    print("This is a local fixture, not the live LeetCode site. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
