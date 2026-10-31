# Same as `python3 -m http.server`, minus the browser cache.
# A fresh export changes the bundle's name but NOT index.html's, so a
# cached index.html keeps asking for a bundle that no longer exists -
# which looks exactly like "the page is broken" and is not.
import http.server, functools, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

port = int(sys.argv[1])
directory = sys.argv[2]
handler = functools.partial(NoCache, directory=directory)
http.server.ThreadingHTTPServer(('', port), handler).serve_forever()
