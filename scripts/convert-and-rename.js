#!/usr/bin/env node
/**
 * convert-and-rename.js
 *
 * 画像フォルダの画像を
 *   slide01.jpg … slide14.jpg (1080×1920 / quality=85)
 * に変換して出力ディレクトリへ書き出す
 *
 * 使い方:
 *   node scripts/convert-and-rename.js [INPUT_DIR] [OUTPUT_DIR]
 *
 * デフォルト:
 *   INPUT_DIR  = public/assets/slides
 *   OUTPUT_DIR = public/assets/slides
 */

const fs             = require("fs");
const path           = require("path");
const os             = require("os");
const { execSync }   = require("child_process");
const sharp          = require("sharp");

// HEIC/HEIF かどうか判定
const HEIC_EXTS = new Set([".heic", ".heif"]);

// ─── 設定 ──────────────────────────────────────────────────────────────────
const EXPECTED_COUNT = 14;
const OUTPUT_WIDTH   = 1080;
const OUTPUT_HEIGHT  = 1920;
const JPEG_QUALITY   = 85;

// CLI 引数でオーバーライド可能
const INPUT_DIR  = path.resolve(process.argv[2] ?? "public/assets/slides");
const OUTPUT_DIR = path.resolve(process.argv[3] ?? "public/assets/slides");

// 対象拡張子
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif"]);

// ─── ユーティリティ ─────────────────────────────────────────────────────────

/** 出力ディレクトリを再帰的に作成 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[mkdir] ${dir}`);
  }
}

/** ゼロ埋め数字文字列を返す: 1 → "01" */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 出力ファイルパスを組み立てる */
function outPath(index) {
  return path.join(OUTPUT_DIR, `slide${pad2(index + 1)}.jpg`);
}

// ─── メイン処理 ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  convert-and-rename.js");
  console.log("=".repeat(60));
  console.log(`INPUT_DIR  : ${INPUT_DIR}`);
  console.log(`OUTPUT_DIR : ${OUTPUT_DIR}`);
  console.log(`RESIZE     : ${OUTPUT_WIDTH} x ${OUTPUT_HEIGHT}`);
  console.log(`QUALITY    : ${JPEG_QUALITY}`);
  console.log("-".repeat(60));

  // ── 1. 入力ディレクトリの存在確認 ────────────────────────────────────────
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`[ERROR] INPUT_DIR が見つかりません: ${INPUT_DIR}`);
    process.exit(1);
  }

  // ── 2. 画像ファイル一覧を取得（ソート済み slide*.jpg は除外）──────────────
  const allFiles = fs.readdirSync(INPUT_DIR).sort(); // ファイル名昇順でソート
  const imageFiles = allFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return false;
    // 既に変換済みの slide01.jpg … は処理対象から除外
    if (/^slide\d{2}\.jpe?g$/i.test(f)) return false;
    return true;
  });

  console.log(`\n対象ファイル一覧 (${imageFiles.length}件):`);
  imageFiles.forEach((f, i) => {
    console.log(`  [${pad2(i + 1)}] ${f}`);
  });
  console.log("");

  // ── 3. 枚数チェック ───────────────────────────────────────────────────────
  if (imageFiles.length !== EXPECTED_COUNT) {
    console.error(
      `[ERROR] ファイル数が ${EXPECTED_COUNT} 枚ではありません ` +
      `(実際: ${imageFiles.length} 枚)\n` +
      `       画像を正確に ${EXPECTED_COUNT} 枚用意してから再実行してください。`
    );
    process.exit(1);
  }

  // ── 4. 出力ディレクトリ作成 ───────────────────────────────────────────────
  ensureDir(OUTPUT_DIR);

  // ── 5. 上書き確認（既存 slideXX.jpg があればスキップ） ───────────────────
  const existingOutputs = imageFiles
    .map((_, i) => outPath(i))
    .filter((p) => fs.existsSync(p));

  if (existingOutputs.length > 0) {
    console.warn("[WARN] 以下の出力ファイルが既に存在するためスキップします:");
    existingOutputs.forEach((p) => console.warn(`  ${path.basename(p)}`));
    console.warn("  強制上書きする場合は --force フラグを付けてください。\n");
  }

  const forceOverwrite = process.argv.includes("--force");

  // ── 6. 変換・リサイズ・書き出し ──────────────────────────────────────────
  let successCount = 0;
  let skipCount    = 0;
  let errorCount   = 0;

  for (let i = 0; i < imageFiles.length; i++) {
    const srcFile  = path.join(INPUT_DIR, imageFiles[i]);
    const destFile = outPath(i);
    const tmpFile  = destFile + ".tmp.jpg";

    // 既存ファイルのスキップ判定
    if (!forceOverwrite && fs.existsSync(destFile)) {
      console.log(`[SKIP ] slide${pad2(i + 1)}.jpg は既に存在 → スキップ`);
      skipCount++;
      continue;
    }

    // HEIC の場合は sips で中間 JPG に変換してから sharp へ渡す
    const ext = path.extname(imageFiles[i]).toLowerCase();
    let sharpSrc = srcFile;
    let sipsTmp  = null;

    try {
      if (HEIC_EXTS.has(ext)) {
        sipsTmp = path.join(os.tmpdir(), `sips_${Date.now()}_${i}.jpg`);
        execSync(`sips -s format jpeg "${srcFile}" --out "${sipsTmp}"`, { stdio: "pipe" });
        sharpSrc = sipsTmp;
      }

      // ── Sharp で変換 (一時ファイル経由で安全に書き出し) ──────────────────
      await sharp(sharpSrc)
        .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
          fit: "cover",        // 縦横比を保ちつつ中央クロップ
          position: "center",  // 中央を基準にトリミング
        })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: false })
        .toFile(tmpFile);

      // ── 一時ファイルを本来の名前にリネーム ───────────────────────────────
      fs.renameSync(tmpFile, destFile);

      const srcSize  = (fs.statSync(srcFile).size  / 1024).toFixed(0);
      const destSize = (fs.statSync(destFile).size / 1024).toFixed(0);

      console.log(
        `[OK  ] ${imageFiles[i].padEnd(52)} ` +
        `→ slide${pad2(i + 1)}.jpg ` +
        `(${srcSize}KB → ${destSize}KB)`
      );
      successCount++;

    } catch (err) {
      // 一時ファイルが残っていれば削除
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      console.error(`[FAIL] slide${pad2(i + 1)}.jpg : ${err.message}`);
      errorCount++;
    } finally {
      // sips 中間ファイルを削除
      if (sipsTmp && fs.existsSync(sipsTmp)) fs.unlinkSync(sipsTmp);
    }
  }

  // ── 7. サマリー ───────────────────────────────────────────────────────────
  console.log("-".repeat(60));
  console.log(`完了 : 成功 ${successCount} / スキップ ${skipCount} / 失敗 ${errorCount}`);

  if (errorCount > 0) {
    console.error("\n[ERROR] 一部のファイルで変換に失敗しました。上記ログを確認してください。");
    process.exit(1);
  }

  console.log("\n変換済みファイル一覧:");
  Array.from({ length: EXPECTED_COUNT }, (_, i) => {
    const p = outPath(i);
    if (fs.existsSync(p)) {
      const kb = (fs.statSync(p).size / 1024).toFixed(0);
      console.log(`  ${path.basename(p)}  (${kb} KB)`);
    }
  });

  console.log("\nRemotionでの使い方:");
  console.log('  staticFile(`assets/slides/slide${String(i + 1).padStart(2, "0")}.jpg`)');
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
