import json, urllib.request, time

BASE = "http://localhost:3002"

def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

# Use a pre-defined prompt to test image generation
print("=" * 60)
print("STEP 2: AI Image Generate (1 of 14 as representative test)")
print("=" * 60)

prompt = "Elegant anime-style person showcasing unique fashion outfit, cinematic lighting, vertical 9:16 composition, no text"
start = time.time()
img_res = post("/api/generate-image", {"prompt": prompt})
elapsed = time.time() - start
if img_res.get("ok"):
    print(f"  ✅ 画像生成成功 ({elapsed:.1f}s)")
    print(f"     image: {img_res.get('image')}")
    print(f"     imageUrl: {img_res.get('imageUrl')}")
    print(f"     path: {img_res.get('path')}")
else:
    print(f"  ❌ 画像生成失敗: {img_res.get('message')}")
