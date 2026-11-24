"""Serve the plan2run Firebase frontend locally."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript", ".js": "text/javascript"}

    def send_head(self):
        # Do not revive old cached modules with an incorrect MIME type.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("/login.html", "/local", "/local/") or path.startswith("/local/"):
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_GET()


def serve(port=8000, host="127.0.0.1"):
    handler = partial(Handler, directory=str(BASE / "dist"))
    with ThreadingHTTPServer((host, port), handler) as server:
        print(f"plan2run: http://{host}:{server.server_port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    try:
        serve(args.port, args.host)
    except KeyboardInterrupt:
        pass
