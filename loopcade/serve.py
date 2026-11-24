"""Serve Loopcade locally with the correct JavaScript module MIME type."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
    }

    def send_head(self):
        # Ignore cached copies that may have an incorrect module MIME type.
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    directory = Path(__file__).resolve().parent / "dist"
    handler = partial(Handler, directory=str(directory))
    with ThreadingHTTPServer(("127.0.0.1", 8000), handler) as server:
        print("Loopcade: http://localhost:8000 (Ctrl+C om te stoppen)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
