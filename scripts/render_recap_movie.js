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

console.log("[RecapMovieRenderer] props loaded");

// props 最低限バリデーション
const missing = ["recapMovieId", "customerId", "year"].filter((k) => props[k] == null);
if (missing.length > 0) fail(`missing required props: ${missing.join(", ")}`);

// fixture コピー
const fixturePath = path.resolve(__dirname, "../fixtures/dummy_recap.mp4");
if (!fs.existsSync(fixturePath)) fail(`fixture not found: ${fixturePath}`);

const outDir = path.dirname(args.out);
if (!fs.existsSync(outDir)) {
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (e) {
    fail(`failed to create output directory: ${e.message}`);
  }
}

try {
  fs.copyFileSync(fixturePath, args.out);
} catch (e) {
  fail(`failed to copy fixture to output: ${e.message}`);
}

console.log(`[RecapMovieRenderer] output generated: ${args.out}`);
