#!/usr/bin/env node
"use strict";

const fs   = require("fs");
const path = require("path");

// ─── CLI 引数パース ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--props" && argv[i + 1]) args.props = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) args.out = argv[++i];
  }
  return args;
}

function fail(message) {
  console.error(`[RecapMovieRenderer] failed: ${message}`);
  process.exit(1);
}

// ─── メイン ────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv);

if (!args.props) fail("--props <path> is required");
if (!args.out)   fail("--out <path> is required");

console.log("[RecapMovieRenderer] start");

// props 読み込み
if (!fs.existsSync(args.props)) fail(`props file not found: ${args.props}`);

let props;
try {
  props = JSON.parse(fs.readFileSync(args.props, "utf8"));
} catch (e) {
  fail(`failed to parse props JSON: ${e.message}`);
}

console.log("[RecapMovieRenderer] props loaded:", JSON.stringify(props));

// props 最低限バリデーション
const missing = ["recapMovieId", "customerId", "year"].filter((k) => props[k] == null);
if (missing.length > 0) fail(`missing required props: ${missing.join(", ")}`);

// 出力ディレクトリ確認
const outDir = path.dirname(args.out);
if (!fs.existsSync(outDir)) {
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    fail(`failed to create output directory: ${e.message}`);
  }
}

// ─── Remotion renderMedia ──────────────────────────────────────────────────
async function render() {
  const { bundle }       = require("@remotion/bundler");
  const { getCompositions, renderMedia, RenderInternals } = require("@remotion/renderer");

  const entryPoint = path.resolve(__dirname, "../src/index.ts");
  const compositionId = "RecapMovie";

  console.log("[RecapMovieRenderer] bundling...");
  const bundleLocation = await bundle({
    entryPoint,
    // remotion.config.ts の設定を読み込む
    onProgress: (progress) => {
      process.stdout.write(`\r[RecapMovieRenderer] bundle: ${Math.round(progress * 100)}%`);
    },
  });
  process.stdout.write("\n");
  console.log("[RecapMovieRenderer] bundle done:", bundleLocation);

  console.log("[RecapMovieRenderer] getting compositions...");
  const compositions = await getCompositions(bundleLocation, {
    inputProps: props,
  });

  const composition = compositions.find((c) => c.id === compositionId);
  if (!composition) {
    fail(`composition "${compositionId}" not found. available: ${compositions.map((c) => c.id).join(", ")}`);
  }

  console.log(
    `[RecapMovieRenderer] rendering composition: ${composition.id}` +
    ` (${composition.width}x${composition.height}, ${composition.durationInFrames}frames @ ${composition.fps}fps)`
  );

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: args.out,
    inputProps: props,
    imageFormat: "jpeg",
    jpegQuality: 90,
    onProgress: ({ renderedFrames, encodedFrames, stitchStage }) => {
      const total = composition.durationInFrames;
      process.stdout.write(
        `\r[RecapMovieRenderer] render: ${renderedFrames}/${total} frames | encode: ${encodedFrames} | stage: ${stitchStage ?? "-"}`
      );
    },
  });
  process.stdout.write("\n");

  // RenderInternals がある場合はクリーンアップ
  if (RenderInternals && typeof RenderInternals.cleanDownloadCache === "function") {
    await RenderInternals.cleanDownloadCache();
  }

  console.log(`[RecapMovieRenderer] output generated: ${args.out}`);
}

render().catch((err) => fail(err?.message ?? String(err)));
