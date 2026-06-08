import json, urllib.request

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

# Simulated slides with image paths (as would be after image generation)
slides_with_images = [
    {"id": f"slide-{i}", "headline": f"スライド{i+1}", "subline": "サブライン", "emphasis": "強調", 
     "image": f"generated/ai-20260607-154240-test{i}.png",
     "imagePrompt": "anime fashion"}
    for i in range(14)
]

top_targets = [
    {"angle": "action", "variant": {"name": "お得情報", "angle": "action"}},
    {"angle": "emotion", "variant": {"name": "おしゃれ体験", "angle": "emotion"}},
]

print("=" * 60)
print("STEP 6: Rewrite (2 targets as representative)")
print("=" * 60)
queue_items = []
for target in top_targets:
    print(f"  Rewriting: {target['variant']['name']} (angle={target['angle']})")
    rw_res = post("/api/rewrite-story", {
        "angle": target["angle"],
        "slides": [{"headline": s["headline"], "subline": s["subline"], "emphasis": s["emphasis"]} for s in slides_with_images],
    })
    if rw_res.get("ok"):
        rewritten = rw_res.get("slides", [])
        print(f"    ✅ Rewrite成功 ({len(rewritten)} slides)")
        print(f"       first: {rewritten[0].get('headline','') if rewritten else 'none'}")
        # Build queue item
        rewritten_slides = []
        for i, s in enumerate(slides_with_images):
            rw = rewritten[i] if i < len(rewritten) else {}
            rewritten_slides.append({
                **s,
                "headline": rw.get("headline", s["headline"]),
                "subline": rw.get("subline", s["subline"]),
                "emphasis": rw.get("emphasis", s["emphasis"]),
            })
        queue_items.append({
            "id": f"queue-{target['angle']}",
            "variantName": f"{target['variant']['name']}（Rewrite）",
            "status": "pending",
            "slidesSnapshot": rewritten_slides,
        })
    else:
        print(f"    ❌ Rewrite失敗: {rw_res.get('message')}")

print()
print("=" * 60)
print("STEP 7: Queue投入")
print("=" * 60)
print(f"  ✅ Queue投入完了 ({len(queue_items)} 件)")
for item in queue_items:
    print(f"     - {item['variantName']} ({len(item['slidesSnapshot'])} slides, image={item['slidesSnapshot'][0].get('image','none')})")
