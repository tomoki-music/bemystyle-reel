# ローカルAIテロップ動画（Local AI Caption Video）

Phase 1 実装ドキュメント。`bemystyle-reel` の `editor/` アプリに追加された、完全に独立した機能です。

## 概要

開発者のMac上にある既存のローカル動画ファイル（最大17GB程度、MP4/MOV、最大30分を想定）を、
**アプリにアップロード/コピーすることなく**パス指定のまま扱い、

1. `ffprobe` でメタデータ（長さ・解像度・コーデック・音声有無・回転）を取得
2. `ffmpeg` で小さな音声ファイル（mono/16kHz/64kbps mp3）だけを抽出
3. その音声ファイルだけを OpenAI Whisper API に送って日本語の時刻付き字幕を生成
4. Web UI で字幕を確認・追加・編集・削除・並び替え（動画プレビュー連動）
5. `ffmpeg` + ASS字幕ファイルでローカルに字幕を焼き込み、設定した出力フォルダへMP4として書き出す

という一連の作業をブラウザから行える、単一開発者用のローカルツールです。認証機能はありません
（ローカルでしか動かさない前提）。

## Phase 1 のスコープ

- **音声のみからのAI自動文字起こし**（OpenAI Whisper `whisper-1`、`response_format=verbose_json`）
- 字幕は6種類のタイプ（`normal`/`main`/`sub`/`emphasis`/`heading`/`annotation`）をASS側では
  すべて定義済みですが、**Phase 1のUIが実際に生成・使用するのは `normal` のみ**です。
- 字幕の手動追加・編集・削除・並び替え・「全てnormalに戻す」
- ffmpegによる字幕焼き込みレンダリング（進捗表示・キャンセル対応）

### Phase 2（未実装・将来）

SRT/VTT/SBV 字幕ファイルのインポートに対応し、文字起こしをスキップできるようにする。

### Phase 3（未実装・将来）

AIによる字幕の自動分類（`main`/`sub`/`emphasis`/`heading`/`annotation` への振り分け）。
`emphasisText`（強調したい部分文字列）フィールドはPhase1のデータモデルに既に用意済みですが、
UIからは設定できません（ASS生成ロジック側は対応済み）。

---

## 対応OS・動画形式

- **開発/動作確認: macOS のみ**（`fc-list`・`df` コマンド利用箇所はmacOS/Linux想定。Windowsは未確認・未対応）。
- 入力: `.mp4` / `.mov` / `.m4v`（拡張子で判定）。MOV(QuickTime)のHEVCなども、ffmpegが
  デコードできればOK（後述の decoders 確認コマンド参照）。
- 出力: 常に **MP4 / H.264 / AAC**（`-c:v libx264 -c:a aac -movflags +faststart`）に固定。
  入力がHEVCやMOVであっても再エンコードで統一します。
- 動画の最大時間・サイズはソフトウェア的には制限していませんが、動作確認は小さいテスト動画
  （数秒・数十KB）でのみ行っています。17GB・30分規模の実ファイルでの検証は**行っていません**
  （後述「未実施の検証」を参照）。

---

## セットアップ（macOS）

### 1. ffmpeg / ffprobe

```bash
brew install ffmpeg
ffmpeg -version
```

確認コマンド:

```bash
ffmpeg -version
ffmpeg -filters | grep -E 'ass|subtitles'
ffmpeg -decoders | grep -E 'hevc|h264'
```

**重要な実機確認結果（2026-09-22、このリポジトリの開発機）:**
この開発機に入っていた `brew install ffmpeg`（無印の Homebrew ffmpeg フォーミュラ、8.1_1）は
**`libass` が有効化されておらず、`ass` / `subtitles` フィルタが存在しませんでした**
（`ffmpeg -filters | grep -E 'ass|subtitles'` が何も出力しない）。この状態では
字幕焼き込みレンダリング（`-vf ass=...`）は次のように**必ず失敗します**:

```
[AVFilterGraph] No option name near '/path/to/x.ass'
[AVFilterGraph] Error parsing filterchain 'ass=...'
Error opening output files: Invalid argument
```

これはこの機能の実装バグではなく、**ffmpegのビルドにlibassが含まれていないため**です。
字幕焼き込みを使うには、libass有効なffmpegが必要です。例:

```bash
# 選択肢1: ffmpeg-full を使う社外tapがある場合はそちらを利用する
# 選択肢2: 公式Homebrewでも将来的にオプション付きビルドが提供され次第切り替える
# 選択肢3: MacPorts 版 ffmpeg（+libass variant）を使う
sudo port install ffmpeg +libass
```

**新しく環境構築する場合は、必ず `ffmpeg -filters | grep -E 'ass|subtitles'` の出力が
空でないことを事前に確認してください。** 空の場合、このアプリの「動画を生成」ボタンを押しても
ffmpegエラーで失敗します（`errorMessage` にffmpegの生出力が入るので原因は判別できます）。

`h264` / `hevc` デコーダ自体は、この開発機の ffmpeg 8.1_1 で両方利用可能でした
（`ffmpeg -decoders | grep -E 'hevc|h264'` で両方ヒット）。

### 2. 日本語フォント

字幕焼き込み時、`CAPTION_VIDEO_FONT_FAMILY` 環境変数で指定したフォント名をASSスタイルに
そのまま書き込みます（デフォルト `"Noto Sans CJK JP"`）。実際にそのフォントが系に
存在するかは `fc-list` があれば確認できます:

```bash
fc-list :lang=ja
```

`fc-list` はmacOSに標準では入っていません（Homebrewで `brew install fontconfig` などが必要）。
**このアプリは `fc-list` が無い環境でもハードエラーにはしません**
（`unknown` 判定として警告付きで処理を続行します。仕様として意図的にこうしています）。

`fc-list` が無い場合のフォールバック確認方法（macOS標準フォルダを目視 or 検索）:

```bash
ls /System/Library/Fonts | grep -iE "hiragino|noto|osaka|pingfang"
ls /Library/Fonts | grep -iE "hiragino|noto|osaka|pingfang"
mdfind "kMDItemFSName == '*Hiragino*'"
```

**実機確認結果:** この開発機では `fc-list` 自体が未インストールで、上記の目視確認でも
「ヒラギノ角ゴ（日本語向け Hiragino Sans）」の通常ファイルが `/System/Library/Fonts` /
`/Library/Fonts` に見当たりませんでした（`/System/Library/Fonts/Hiragino Sans GB.ttc` は
簡体字中国語向けの別ファミリーで、日本語専用ではありません。`/Library/Fonts/Arial Unicode.ttf`
はCJKグリフを含む汎用フォールバックフォントとして存在します）。
つまりこの開発機は、通常のmacOSデスクトップと比べて日本語フォント構成が薄い可能性があります。
**実際に字幕を焼き込む前に、`CAPTION_VIDEO_FONT_FAMILY` に指定する予定のフォント名が
実在することを、ご自身の環境で必ず確認してください。** 存在しないフォント名を指定した場合、
libass はデフォルトフォントへフォールバックするため、映像自体は生成されますが、意図したフォント
にならない可能性があります（これはlibass側の挙動で、本アプリのエラーにはなりません）。

---

## 環境変数

`editor/.env` に追記して使います（既存の `OPENAI_API_KEY` と同じファイルです）。

| 変数名 | 必須 | 説明 |
|---|---|---|
| `OPENAI_API_KEY` | ○（文字起こし機能を使う場合） | 既存のOpenAIキーを流用。**存在するだけでなく空文字でないことを本機能側もチェックします**（`.length > 0`）。 |
| `VIDEO_INPUT_ROOTS` | ○ | 動画ソースとして許可する絶対パスのディレクトリ、カンマ区切りで複数指定可。例: `/Users/you/Movies,/Volumes/External/footage` |
| `VIDEO_OUTPUT_ROOT` | ○ | レンダー結果MP4の書き出し先ディレクトリ（単一、絶対パス）。例: `/Users/you/Movies/captioned-output` |
| `CAPTION_VIDEO_TMP_ROOT` | 任意 | 音声抽出やASSファイルの一時置き場。未設定時はOSの一時ディレクトリ配下 `bemystyle-caption-tmp` を使用。`VIDEO_INPUT_ROOTS` の中には絶対に置かないこと。 |
| `CAPTION_VIDEO_FONT_FAMILY` | 任意 | ASS字幕のフォント名。デフォルト `Noto Sans CJK JP`。 |

**注意:** `editor/.env` には本番運用中のOpenAI APIキーが既に記載されています。このドキュメント作成
にあたり、このファイルの中身を書き換えたり新しい行を追記したりはしていません（キー漏洩・事故を
避けるため意図的に触っていません）。上記4変数は、ご自身で `editor/.env` に手動で追記してください。
例:

```bash
# editor/.env に追記する例（OPENAI_API_KEY の行はそのまま）
VIDEO_INPUT_ROOTS=/Users/you/Movies
VIDEO_OUTPUT_ROOT=/Users/you/Movies/captioned-output
CAPTION_VIDEO_TMP_ROOT=/tmp/bemystyle-caption-tmp
CAPTION_VIDEO_FONT_FAMILY=Noto Sans CJK JP
```

`VIDEO_INPUT_ROOTS` / `VIDEO_OUTPUT_ROOT` のディレクトリは事前に実在している必要があります
（存在しないルートは無視され、パス検証で「許可されたフォルダが設定されていません」等のエラーに
なります）。

---

## 使い方（Web UI）

`editor` を通常どおり起動（`npm run dev`、Vite:3001 / API:3002）した状態で、ブラウザで

```
http://localhost:3001/?mode=local-caption
```

を開くと、既存のReel作成UIとは独立した「ローカルAIテロップ動画（β）」画面が表示されます
（`?mode=local-caption` が無ければ通常どおり既存UIが表示されます。既存機能への影響はありません）。

1. 左パネルでフォルダをブラウズするか、絶対パスを直接入力して動画ファイルを選択し、
   「この動画でジョブを作成」を押す（サーバー側で `ffprobe` を実行しメタデータを取得）。
2. 音声がある動画なら「文字起こしを開始」ボタンで音声抽出→Whisper文字起こしを実行
   （進捗はポーリングで自動更新されます）。音声が無い動画は自動的にその旨が表示され、
   手動での字幕追加のみ可能になります。
3. 字幕一覧で追加・編集・削除・並び替え（↑↓ボタン）ができます。字幕の開始時刻をクリックすると
   プレビュー動画がその時刻にシークします。
4. 「字幕を焼き込んで動画を生成」でレンダー開始。進捗（%）が表示され、完了後は出力パスと
   再生/ダウンロードリンクが表示されます。

---

## API概要（`/api/local-caption-videos/...`）

- `GET /roots` — 許可された入力/出力ルート一覧
- `GET /browse?path=...` — 許可ルート内のディレクトリ一覧（動画ファイルとサブフォルダのみ表示）
- `POST /` — `{ sourcePath, title? }` でジョブ作成（サーバー側で同期的に`ffprobe`実行）
- `GET /` — ジョブ一覧
- `GET /:id` — ジョブ詳細（ポーリング用）
- `DELETE /:id` — ジョブ削除（**元動画は削除しない**。自分が生成した出力ファイルのみ削除）
- `POST /:id/reprobe` — probe失敗ジョブの再試行
- `POST /:id/start-processing` — 音声抽出＋文字起こしを開始（非同期。ポーリングで進行状況を見る）
- `POST /:id/captions` / `PATCH /:id/captions/:captionId` / `DELETE /:id/captions/:captionId` — 字幕CRUD
- `POST /:id/captions/reorder` — `{ orderedIds: [...] }` で並び替え
- `POST /:id/captions/reset-types` — 全字幕を `normal` に戻す
- `POST /:id/render` — レンダー開始（全アプリで同時1件まで、ディスク空き容量チェックあり）
- `POST /:id/render/cancel` — レンダー中断（SIGTERM→猶予後SIGKILL、部分ファイル削除）
- `GET /:id/source-stream` / `GET /:id/output-stream` — Range対応のプレビューストリーミング

---

## セキュリティ設計

- 動画本体は一切コピーしない。常にパスを `ffmpeg`/`ffprobe` の引数として渡すのみ。
- すべての入力パス（ソース・出力）は `fs.realpathSync` で解決したうえで `VIDEO_INPUT_ROOTS` /
  `VIDEO_OUTPUT_ROOT` の内側にあるか検証（シンボリックリンク脱出・`..`トラバーサル対策）。
  これは `editor/server/lib/pathValidator.mjs` に切り出し、ユニットテストで重点的に検証しています。
- `child_process.spawn` は常にargv配列形式、`shell: true` は一切使わない。
- OpenAIには抽出した小さな音声ファイルのみ送信（動画本体は絶対に送らない）。使用後は
  try/finallyで確実に削除。
- 抽出音声が24MB超なら、OpenAI呼び出し自体を行わずエラーにする。
- ユーザー入力のキャプションテキストは `escapeAssText()` で `\` / `{` `}` / 改行をエスケープし、
  ASS override タグの注入を防止（`editor/server/lib/assText.mjs`）。
- レンダー出力は常に `<元ファイル名>_captioned_<タイムスタンプ>.mp4`。既存ファイルと衝突する
  場合はランダムサフィックスを付与し、既存ファイルを黙って上書きしない。入力パスと出力パスが
  一致するケースも拒否する。
- レンダー同時実行はアプリ全体で1件まで（メモリ内フラグ）。
- 各ジョブの各処理ステップは状態遷移表で管理し、想定していない状態からの二重実行を防止
  （`editor/server/lib/jobStore.mjs`）。OpenAI呼び出しのタイムアウトは自動リトライしない
  （二重課金リスクを避けるため。ユーザーが明示的に再試行ボタンを押す必要がある）。レスポンス
  到達前のネットワークエラー（例: ECONNREFUSED）のみ1回だけ自動リトライする。

---

## クラッシュ・再起動時の復旧

サーバー起動時、`extracting_audio` / `transcribing` / `rendering` のまま残っているジョブは
自動的に `failed`（メッセージ:「サーバー再起動により処理が中断されました。もう一度実行して
ください。」）へ強制遷移し、`rendering` だった場合は中途半端な出力ファイルがあれば削除します
（`editor/server/lib/jobStore.mjs` の `recoverIncompleteJobsOnStartup`）。

---

## OpenAI APIコストの目安

Whisper API（`whisper-1`）は音声の長さに応じた従量課金です。30分の動画から抽出した
mono/16kHz/64kbpsの音声はおおよそ十数MB程度になり、24MB上限には通常収まりますが、
**録音状態やビットレートによっては超える可能性があります**。超えた場合はOpenAIに送信せず
エラーにするため、課金は発生しません。文字起こし自体の料金は動画の長さに比例するため、
長時間動画を繰り返し文字起こしすると相応のコストがかかる点に留意してください。

## ディスク容量の注意

レンダー開始前に、出力先の空き容量が「ソースファイルサイズ×1.2」以上あるかをベストエフォートで
チェックします（`fs.statfsSync` が使えるNodeバージョンならそれを使用、無ければ `df -k` に
フォールバック。開発機のNode v16.20.2では `statfsSync` が無いため `df` 経由になることを
実機で確認済みです）。どちらも失敗した場合は「判定不能」として警告なしで処理を続行します
（ベストエフォートのため、ハードブロックはしません）。

---

## 未実装 / 今回検証できていないこと（正直な一覧）

- **ディレクトリブラウザUIの高度な機能**: フォルダの階層移動・動画一覧表示は実装しましたが、
  「よく使うフォルダのブックマーク」「検索」等はありません。
- **Finderで表示（Reveal in Finder）ボタン**: 未実装。
- **実際の `fc-list` 動作確認**: この開発機に `fc-list` が入っていないため、
  「フォントが見つかった場合」の実側動作は確認できていません（ユニットテストではモックで検証済み）。
- **実際のOpenAI Whisper API呼び出し**: 本物のAPIキーでの実呼び出しは行っていません
  （課金が発生するため）。ユニットテスト・ルート統合テストは `fetch` をモックして検証しています。
  ネットワーク疎通・レスポンス形式については実際の呼び出しで最終確認してください。
- **実際の大容量（数GB〜17GB）ファイルでの検証**: 行っていません。数秒・数十KBのテスト動画
  （`ffmpeg` の `testsrc`/`sine` で生成）でのAPI疎通・ffprobe・ffmpeg render・Range配信の
  実地動作は確認済みですが、17GBクラスのファイルでのメモリ使用量・所要時間・タイムアウト挙動は
  未検証です。
- **字幕焼き込みレンダリングの実地成功確認**: 前述のとおり、この開発機のffmpegビルドに
  libassが無いため、`-vf ass=...` を使うレンダリングは実機で**失敗することを確認しました**
  （実装のバグではなく環境要因）。libass有効なffmpegでの実地成功確認はできていません。
  ffprobe・音声抽出・パス検証・Range配信・状態遷移・字幕CRUD・削除保護（元動画非削除）は
  すべて実機で成功を確認済みです。
- **Windows / Linux での動作確認**: 未実施（macOSのみ確認）。
- **縦動画（rotation=90/270）の実ファイルでの目視確認**: ffprobe解析ロジックはユニットテストで
  Display Matrix / tags.rotate のケースを検証していますが、実際に90度回転したMOVファイルを
  用意しての目視確認（表示サイズ・字幕位置が正しいか）は行っていません。
- **SRT/VTT/SBVインポート（Phase 2）・AI自動分類（Phase 3）**: 仕様どおり未実装。

---

## 主な追加ファイル

- `editor/server/lib/pathValidator.mjs` — パス許可リスト検証（最重要セキュリティコード）
- `editor/server/lib/assText.mjs` — ASSテキスト/フィルタパスのエスケープ
- `editor/server/lib/ffprobeParser.mjs` — ffprobe JSON解析・回転正規化
- `editor/server/lib/captionStyles.mjs` — ASSスタイル定義・字幕ファイル生成
- `editor/server/lib/ffmpegRunner.mjs` — ffprobe/ffmpeg spawn ラッパー（進捗パース・キャンセル対応）
- `editor/server/lib/openaiTranscription.mjs` — OpenAI Whisper呼び出し（手組みmultipart）
- `editor/server/lib/jobStore.mjs` — ジョブ永続化・状態遷移・クラッシュ復旧
- `editor/server/lib/diskSpace.mjs` — 空き容量チェック（statfsSync / df フォールバック）
- `editor/server/lib/fontCheck.mjs` — 日本語フォント有無のベストエフォートチェック
- `editor/server/lib/outputNaming.mjs` — 出力ファイル名のユニーク化
- `editor/server/localCaptionVideoRoutes.mjs` — Expressルーター本体
- `editor/src/components/localCaption/` — フロントエンド一式（`LocalCaptionVideoMode.tsx` ほか）
