import json, urllib.request, time

BASE = "http://localhost:3002"

def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=15) as r:
            return json.loads(r.read())
    except:
        return {}

print("=" * 60)
print("Render: Check current status")
print("=" * 60)
status = get("/api/render/status")
print(f"  Current render status: {status.get('status')}")
print(f"  outputFile: {status.get('outputFile')}")
print(f"  downloadUrl: {status.get('downloadUrl')}")

print()
print("Render: Check render history")
history = get("/api/render/history")
items = history.get("items", [])
print(f"  History items: {len(items)}")
for item in items[:3]:
    print(f"     - {item.get('filename')} ({item.get('size',0)//1024}KB) {item.get('createdAt','')[:10]}")

print()
print("Render: Test /api/render/view endpoint")
try:
    req = urllib.request.Request(BASE + "/api/render/view")
    with urllib.request.urlopen(req, timeout=10) as r:
        content_type = r.headers.get("Content-Type","")
        size = len(r.read())
        print(f"  ✅ /api/render/view OK: Content-Type={content_type}, size={size} bytes")
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    print(f"  ⚠️ /api/render/view: {e.code} - {body.get('message')}")
    
# Check if there's a latest video file
import os
reels_dir = "/Users/tomokiimaizumi/bemystyle-reel/out/reels"
latest = "/Users/tomokiimaizumi/bemystyle-reel/out/latest.mp4"
print()
print("File system check:")
if os.path.exists(reels_dir):
    files = sorted(os.listdir(reels_dir))
    print(f"  Reels directory: {len(files)} files")
    for f in files[-3:]:
        size = os.path.getsize(os.path.join(reels_dir, f))
        print(f"     - {f} ({size//1024}KB)")
else:
    print(f"  Reels directory not found: {reels_dir}")
    
if os.path.exists(latest):
    print(f"  ✅ latest.mp4 exists ({os.path.getsize(latest)//1024}KB)")
else:
    print(f"  ⚠️ latest.mp4 not found")
