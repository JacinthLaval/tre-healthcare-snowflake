import http.server
import os

DIST = "/Users/toddcrosslin/Downloads/CoCoStuff/healthcare-mcp-app/dist"

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def do_GET(self):
        path = os.path.join(DIST, self.path.lstrip('/').split('?')[0])
        if not os.path.exists(path):
            if self.path.startswith('/_expo/') or self.path.startswith('/assets/'):
                self.send_error(404)
                return
            self.path = '/index.html'
        return super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    server = http.server.HTTPServer(('', 8001), SPAHandler)
    print(f"Serving SPA on http://localhost:8001")
    server.serve_forever()
