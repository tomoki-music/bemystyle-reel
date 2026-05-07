# bemystyle-reel

BeMyStyle の Instagram リール / YouTube Shorts / X 動画投稿用  
**縦型ショート動画**を制作するための Remotion プロジェクトです。

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [ディレクトリ構成](#2-ディレクトリ構成)
3. [基本的な使い方](#3-基本的な使い方)
4. [背景画像の変更方法](#4-背景画像の変更方法)
5. [BGM の変更方法](#5-bgm-の変更方法)
6. [テキストの変更方法](#6-テキストの変更方法)
7. [よく使うコマンド一覧](#7-よく使うコマンド一覧)
8. [よくあるエラーと解決法](#8-よくあるエラーと解決法)
9. [運用ルール](#9-運用ルール)
10. [今後の拡張アイデア](#10-今後の拡張アイデア)

---

## 1. プロジェクト概要

### このプロジェクトは何か

**Remotion** を使って、React / TypeScript のコードから `.mp4` 動画を生成するプロジェクトです。  
動画の内容・テキスト・背景画像・BGM をコードで管理し、コマンド一発で書き出せます。

### 何を作るためのものか

- Instagram リール（縦型 1080×1920 / 45 秒）
- YouTube Shorts
- X（旧 Twitter）動画投稿

### BeMyStyle との関係

| 項目 | 内容 |
|------|------|
| 動画の目的 | BeMyStyle のサービス紹介・集客 |
| 誘導先 URL | `be-my-style.com/singing/sign_up` |
| Rails 本体との関係 | **完全に独立したプロジェクト** |

> **重要：** このプロジェクトは Rails アプリ（BeMyStyle 本体）とは別フォルダに置き、  
> 絶対に Rails プロジェクト内に混入させないでください。

---

## 2. ディレクトリ構成

```
bemystyle-reel/
├── public/
│   └── assets/
│       ├── slides/          # 背景画像 (slide01.jpg〜slide14.jpg)
│       └── audio/
│           └── bgm.mp3      # BGM ファイル
├── src/
│   ├── index.ts             # Remotion エントリポイント
│   ├── compositions/
│   │   └── Reel.tsx         # 動画全体の構成（スライド順序など）
│   ├── components/
│   │   ├── SlideContainer.tsx   # 各スライドのレイアウト
│   │   ├── AnimatedText.tsx     # メインテキストアニメーション
│   │   ├── SublineText.tsx      # サブテキスト
│   │   ├── CTAButton.tsx        # CTA ボタン（最終スライド）
│   │   ├── ParticleField.tsx    # パーティクルエフェクト
│   │   ├── RadarChart.tsx       # レーダーチャート（Slide 5）
│   │   └── GrowthGraph.tsx      # 成長グラフ（Slide 8）
│   ├── data/
│   │   └── slides.ts        # ★ テキスト・画像・レイアウト設定（一番よく触る）
│   └── utils/
│       ├── timing.ts        # FPS・スライド長さ・解像度の設定
│       └── animations.ts    # Ken Burns など共通アニメーション
├── out/
│   └── reel.mp4             # 書き出された動画（Git 管理外）
├── package.json
├── remotion.config.ts
├── tsconfig.json
└── .gitignore
```

### 各フォルダの役割（初心者向け）

#### `public/assets/slides/`

背景画像を置くフォルダです。  
`slide01.jpg` から `slide14.jpg` まで、スライドの番号に対応した画像を入れます。

```
slide01.jpg  → Slide 1 の背景
slide02.jpg  → Slide 2 の背景
...
slide14.jpg  → Slide 14（CTA）の背景
```

#### `public/assets/audio/`

BGM ファイルを置くフォルダです。ファイル名は必ず `bgm.mp3` にしてください。

#### `src/data/slides.ts`

**動画の中身を変えるとき、一番よく触るファイルです。**  
各スライドのテキスト・背景画像・演出をここで設定します。詳しくは [6. テキストの変更方法](#6-テキストの変更方法) を参照。

#### `out/reel.mp4`

`npm run render` 実行後に生成される完成動画です。  
Git にはコミットしません（ファイルサイズが大きいため）。

---

## 3. 基本的な使い方

### 初回セットアップ

プロジェクトフォルダに移動し、依存パッケージをインストールします。

```bash
cd ~/bemystyle-reel
npm install
```

### プレビュー起動

ブラウザで動画をリアルタイムプレビューできます。

```bash
# Rails が localhost:3000 を使っている場合は --port 3001 を指定
npm start -- --port 3001
```

起動後、ブラウザで `http://localhost:3001` を開いてください。  
スライドを一枚ずつ確認しながら編集できます。

> **ヒント：** `src/data/slides.ts` を保存するたびにブラウザが自動リロードされます。

### mp4 書き出し

完成動画を `out/reel.mp4` に書き出します。

```bash
npm run render
```

書き出し中はターミナルに進行状況が表示されます（1350 フレーム / 約 30〜60 秒）。  
完了すると `out/reel.mp4` が生成されます。

### 完成動画の場所

```
bemystyle-reel/out/reel.mp4
```

---

## 4. 背景画像の変更方法

### 推奨スペック

| 項目 | 推奨値 |
|------|--------|
| サイズ | **1080 × 1920 px**（縦型） |
| フォーマット | **JPG** |
| 品質 | 85〜90 |
| ファイルサイズ目安 | 200〜500 KB / 枚 |

### JPG を推奨する理由

- PNG は同じ画質でも 5〜10 倍ファイルサイズが大きくなる
- Remotion のレンダリング速度に直接影響する
- 動画の背景用途では JPG の画質で十分

### 画像の変換方法（PNG → JPG 1080×1920）

ffmpeg がインストール済みであれば以下のコマンドで一括変換できます。  
アスペクト比が異なる場合はセンタークロップして 1080×1920 に合わせます。

```bash
ffmpeg -i input.png \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
  -q:v 3 \
  -frames:v 1 \
  output.jpg
```

### 命名ルールと対応スライド

画像ファイル名は必ず以下の通りにしてください。

| ファイル名 | スライド番号 | 現在のテキスト（参考） |
|------------|-------------|----------------------|
| `slide01.jpg` | Slide 1 | 練習してるのに、変わらない。 |
| `slide02.jpg` | Slide 2 | 才能じゃない。 |
| `slide03.jpg` | Slide 3 | 一人練習には鏡がない。 |
| `slide04.jpg` | Slide 4 | AIが、あなたの鏡になる。 |
| `slide05.jpg` | Slide 5 | 音声をアップするだけ。（レーダーチャート付き） |
| `slide06.jpg` | Slide 6 | 見えた瞬間、動きたくなる。 |
| `slide07.jpg` | Slide 7 | AIが毎回、あなたの演奏を聴いてくれる。 |
| `slide08.jpg` | Slide 8 | 先月の自分より、今日の自分へ。（グラフ付き） |
| `slide09.jpg` | Slide 9 | ライバルは、昨日の自分。 |
| `slide10.jpg` | Slide 10 | 一人じゃない。 |
| `slide11.jpg` | Slide 11 | 「上手い」はいらない。 |
| `slide12.jpg` | Slide 12 | 1年後の自分が、ステージに立っている。 |
| `slide13.jpg` | Slide 13 | まず、無料で。 |
| `slide14.jpg` | Slide 14 | 音楽で、人生を前に進めよう。（CTA） |

### 画像の配置手順

1. 新しい画像を用意する（1080×1920 / JPG）
2. `public/assets/slides/` フォルダに `slideXX.jpg` という名前で保存
3. `npm start -- --port 3001` でプレビューを確認
4. 問題なければ `npm run render` で書き出し

---

## 5. BGM の変更方法

### BGM ファイルの場所

```
public/assets/audio/bgm.mp3
```

### 変更手順

1. 新しい BGM ファイルを用意する
2. ファイル名を `bgm.mp3` に変更する
3. `public/assets/audio/` に上書き保存する

### 推奨 BGM ジャンル

- Lo-Fi / チルアウト
- アンビエント
- インストゥルメンタルポップ
- 感情的なピアノ曲

> 歌詞付きはテキストと干渉するため避けるのが無難です。

### 音量について

BGM の音量が大きすぎると動画全体の印象が変わります。  
`src/compositions/Reel.tsx` 内の `volume` プロパティで調整できます。

```tsx
// 例：volume={0.3} で 30% の音量
<Audio src={staticFile("assets/audio/bgm.mp3")} volume={0.3} />
```

### 著作権について

- YouTube / Instagram に投稿する場合、著作権フリーの BGM を使用してください
- 推奨サービス：**Pixabay Music**、**Free Music Archive**、**YouTube Audio Library**

---

## 6. テキストの変更方法

### 対象ファイル

```
src/data/slides.ts
```

このファイルを編集するだけで、動画内のすべてのテキストを変更できます。

### 各フィールドの意味

```typescript
{
  id: 1,                          // スライド番号（変更不要）
  headline: "練習してるのに、\n変わらない。",  // メインテキスト（\n で改行）
  subline: "その理由、わかる？",           // サブテキスト（省略可）
  emphasis: "変わらない。",              // 薄紫で強調したい文字（省略可）
  image: "slide01.jpg",               // 背景画像ファイル名
  layout: "center",                  // レイアウト（後述）
  showParticles: true,               // パーティクルエフェクト ON/OFF
}
```

#### `headline`

メインのキャッチコピーです。`\n` を入れると改行されます。

```typescript
headline: "練習してるのに、\n変わらない。"
// → 「練習してるのに、」
// 　 「変わらない。」と2行で表示
```

#### `subline`

headline の下に表示されるサブテキストです。省略可。

#### `emphasis`

headline の中で**薄紫色に強調**したい文字列を指定します。  
headline に含まれる文字列と完全一致させてください。

```typescript
headline: "練習してるのに、\n変わらない。",
emphasis: "変わらない。"
// → 「変わらない。」の部分だけ紫色になる
```

#### `layout`

スライドのテキスト配置を決めます。

| 値 | 意味 |
|----|------|
| `"center"` | 画面中央に配置（最も多く使う） |
| `"bottom"` | 画面下部に配置 |
| `"cta"` | CTA スライド専用（Slide 14 のみ） |

#### CTA スライド専用フィールド（Slide 14）

```typescript
{
  id: 14,
  headline: "音楽で、\n人生を前に進めよう。",
  layout: "cta",
  showParticles: true,
  showCTA: true,
  ctaLabel: "今すぐ無料で始める",            // ボタンのテキスト
  ctaNote: "プロフィールリンクから無料診断へ",  // ボタン下の補足テキスト
  ctaUrl: "be-my-style.com/singing/sign_up", // 表示するURL
}
```

### テキスト変更の手順

1. `src/data/slides.ts` をエディタで開く
2. 変更したいスライドの `headline` や `subline` を書き換える
3. `npm start -- --port 3001` でプレビューを確認
4. 問題なければ `npm run render` で書き出し

---

## 7. よく使うコマンド一覧

| コマンド | 意味 |
|----------|------|
| `npm install` | 依存パッケージのインストール（初回のみ） |
| `npm start` | プレビュー起動（localhost:3000） |
| `npm start -- --port 3001` | ポート指定でプレビュー起動 |
| `npm run render` | mp4 書き出し（`out/reel.mp4` に保存） |
| `npx tsc --noEmit` | TypeScript の型チェック（エラー確認用） |

---

## 8. よくあるエラーと解決法

### `localhost:3000` が使えない（Rails と競合）

**症状：** `npm start` 後にブラウザが表示されない、または Rails のページが開く

**原因：** Rails が既に `localhost:3000` を使用している

**解決法：** ポートを変えて起動する

```bash
npm start -- --port 3001
```

---

### BGM が鳴らない

**症状：** プレビューや mp4 に音が入らない

**確認項目：**
1. `public/assets/audio/bgm.mp3` が存在するか確認
2. ファイル名が正確に `bgm.mp3` か確認（大文字・小文字も一致させる）
3. ファイルが破損していないか別のプレーヤーで再生して確認

```bash
# ファイルの存在確認
ls public/assets/audio/
# → bgm.mp3 と表示されればOK
```

---

### 画像が表示されない（真っ暗なスライド）

**症状：** 特定のスライドが黒くなる

**確認項目：**
1. `public/assets/slides/` に該当ファイルが存在するか確認
2. ファイル名が `slideXX.jpg`（XX は 2 桁の数字）か確認
3. 拡張子が `.jpg` か確認（`.JPG` や `.jpeg` は不可）

```bash
# ファイル一覧確認
ls public/assets/slides/
# → slide01.jpg 〜 slide14.jpg が表示されればOK
```

---

### `npm run render` が重い・時間がかかる

**原因 1：** 背景画像が PNG 形式のまま

**解決法：** PNG を JPG に変換する（PNG は JPG の 5〜10 倍サイズになる）

```bash
# 変換例
ffmpeg -i slide01.png \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
  -q:v 3 -frames:v 1 slide01.jpg
```

**原因 2：** node_modules が壊れている

**解決法：** 再インストール

```bash
rm -rf node_modules
npm install
```

---

### `cannot find module` エラー

**解決法：** node_modules を再インストール

```bash
npm install
```

---

### TypeScript エラーが出る

**確認方法：** 型チェックを実行してエラー箇所を特定する

```bash
npx tsc --noEmit
```

---

## 9. 運用ルール

### 絶対に守ること

| ルール | 理由 |
|--------|------|
| Rails プロジェクトに混入しない | Rails の `public/` や `src/` は別物。混入するとビルドエラーの原因になる |
| `out/` を Git にコミットしない | mp4 は 20〜100MB になる。リポジトリが肥大化する |
| `*.mp4` を Git にコミットしない | 同上。`.gitignore` に設定済み |
| `node_modules/` を Git にコミットしない | `npm install` で再生成できる。コミットすると数万ファイルが増える |

### `.gitignore` の設定（設定済み）

```
node_modules/
out/
*.mp4
*.mov
*.avi
*.webm
.DS_Store
```

### 動画の更新フロー

```
1. src/data/slides.ts を編集（テキスト変更）
2. public/assets/slides/ を更新（画像変更）
3. npm start -- --port 3001 でプレビュー確認
4. npm run render で書き出し
5. out/reel.mp4 をダウンロードして SNS に投稿
```

---

## 10. 今後の拡張アイデア

このプロジェクトのコードを再利用して、さまざまな動画テンプレートに展開できます。

| アイデア | 内容 |
|----------|------|
| 別テーマ動画 | 楽器別（ピアノ・ギターなど）の紹介動画 |
| イベント告知動画 | ライブ・ワークショップの告知 |
| AI 診断紹介動画 | BeMyStyle の AI 診断機能を詳しく紹介 |
| LP 埋め込み動画 | ランディングページのヘッダー動画 |
| ブランド PV | BeMyStyle のブランドストーリー動画 |
| 動画テンプレ量産 | slides.ts だけ差し替えて複数バージョンを生成 |

### テンプレート量産のやり方

`src/data/slides.ts` を差し替えるだけで別バージョンが作れます。

```bash
# バックアップを作ってから差し替え
cp src/data/slides.ts src/data/slides_v1_backup.ts
# 新しい内容を slides.ts に書いて
npm run render
# → out/reel.mp4 が新バージョンで生成される
```

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | [Remotion](https://www.remotion.dev/) v4 |
| UI ライブラリ | React 18 |
| 言語 | TypeScript 5 |
| 解像度 | 1080 × 1920 px |
| フレームレート | 30 FPS |
| 動画長さ | 45 秒（1350 フレーム） |
| 出力形式 | H.264 mp4 |

---

*BeMyStyle Reel — Remotion Project*
