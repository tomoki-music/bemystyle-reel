import json, urllib.request, urllib.error, time

BASE = "http://localhost:3002"

def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read())

print("=" * 60)
print("STEP 1: Story Generate")
print("=" * 60)
story_res = post("/api/generate-story", {"theme": "ファッション通販の魅力", "presetKey": "fashion"})
assert story_res.get("ok"), f"Story Generate failed: {story_res}"
story_slides = story_res.get("story", {}).get("slides", [])
print(f"  ✅ Story生成完了: {len(story_slides)} slides")
for i, s in enumerate(story_slides[:3]):
    print(f"     [{i+1}] {s.get('headline','')} / prompt: {str(s.get('imagePrompt',''))[:50]}")

