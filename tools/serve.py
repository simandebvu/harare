# tools/serve.py — threaded static server (python's default http.server drops connections under parallel load)
import http.server, socketserver, sys
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    request_queue_size = 128
S(('127.0.0.1', port), http.server.SimpleHTTPRequestHandler).serve_forever()
