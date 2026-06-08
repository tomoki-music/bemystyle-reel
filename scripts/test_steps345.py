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

THEME = "ファッション通販の魅力"

print("=" * 60)
print("STEP 3: Variant Generate")
print("=" * 60)
var_res = post("/api/variant-generator", {"theme": THEME})
assert var_res.get("ok"), f"❌ Variant Generate failed: {var_res}"
variants = var_res.get("variants", [])
print(f"  ✅ Variant生成完了: {len(variants)} variants")
for v in variants:
    print(f"     - {v.get('name')} / angle: {v.get('angle')}")

print()
print("=" * 60)
print("STEP 4: Score Variants")
print("=" * 60)
score_res = post("/api/score-variants", {
    "theme": THEME,
    "variants": variants,
    "learningEvents": []
})
assert score_res.get("ok"), f"❌ Score failed: {score_res}"
scores = score_res.get("scores", [])
print(f"  ✅ スコア完了: {len(scores)} scores")
for s in scores:
    print(f"     - {s.get('variantName')} rec={s.get('recommendation')} views={s.get('predictedViews')} save={s.get('savePotential')}")

print()
print("=" * 60)
print("STEP 5: Select Top 3 (recommendation >= 4)")
print("=" * 60)
scored_with_variant = []
for s in scores:
    v = next((vv for vv in variants if vv.get("name") == s.get("variantName") or vv.get("angle") == s.get("angle")), None)
    if v:
        scored_with_variant.append({**s, "variant": v})

targets = sorted(
    [sv for sv in scored_with_variant if sv.get("recommendation", 0) >= 4],
    key=lambda x: (-x.get("recommendation",0), -x.get("predictedViews",0), -x.get("savePotential",0))
)[:3]

if not targets:
    print("  ❌ recommendation >= 4 のVariantが見つかりませんでした")
    # Show all scores for debugging
    for s in scores:
        print(f"     rec={s.get('recommendation')} {s.get('variantName')}")
else:
    print(f"  ✅ {len(targets)} 件選定")
    for t in targets:
        print(f"     - {t['variant'].get('name')} rec={t.get('recommendation')}")

print()
print(f"targets_count={len(targets)}")
