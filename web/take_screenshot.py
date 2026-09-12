import sys
import time
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading
import os

shot_name = sys.argv[1] if len(sys.argv) > 1 else 'stadium_overview'

# Root directory of web
web_dir = os.path.dirname(os.path.abspath(__file__))
dist_dir = os.path.join(web_dir, 'dist')

if not os.path.exists(dist_dir):
    print(f"Error: dist folder {dist_dir} does not exist. Run 'npm run build' first.")
    sys.exit(1)

os.chdir(dist_dir)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

server = HTTPServer(('127.0.0.1', 0), QuietHandler)
port = server.server_port

t = threading.Thread(target=server.serve_forever, daemon=True)
t.start()
time.sleep(0.3)

chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
output_file = os.path.join(web_dir, f"screenshot_{shot_name}.png")
profile_dir = f"/tmp/chrome-stadium-{shot_name}-{time.time()}"

cmd = [
    chrome,
    "--headless=new",
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=metal",
    "--enable-webgl",
    "--virtual-time-budget=2500",
    f"--user-data-dir={profile_dir}",
    f"--screenshot={output_file}",
    "--window-size=1280,720",
    f"http://127.0.0.1:{port}/?shot={shot_name}"
]

capture_started = time.time()
print(f"Capturing screenshot: {output_file} from http://127.0.0.1:{port}...", flush=True)
try:
    # Chrome can linger on background requests after writing the image.
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=35)
except subprocess.TimeoutExpired:
    print('Headless browser reached its time limit; checking the captured image.')

captured = os.path.exists(output_file) and os.path.getmtime(output_file) >= capture_started
if captured:
    print(f"Successfully saved {output_file}")
else:
    print(f"Failed to capture {output_file}")

server.shutdown()
server.server_close()
sys.exit(0 if captured else 1)
