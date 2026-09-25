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
| `FFMPEG_BIN` / `FFPROBE_BIN` | ○ | libass 対応の ffmpeg / ffprobe（前述のセットアップ参照）。 |
| `WHISPER_CLI_BIN` / `WHISPER_MODEL_PATH` | ローカル整列を使う場合 | whisper.cpp の実行ファイルとモデル（ローカルだけで完結）。 |
| `COMPOSITION_BGM_PATH` | 任意 | ダイジェストBGM（許可ルート内のファイル）。UIから素材パスは受け付けないため、素材はここか runner の引数で指定する。 |
| `COMPOSITION_QR_PATH` | 任意 | LINE QR画像（許可ルート内。PNG/JPG）。冒頭・末尾のLINE案内に表示。 |
| `COMPOSITION_MAIN_BGM_PATH` | 任意 | 本編BGMの既定MP3（許可ルート内）。UIの「MP3ファイルを選択」でも選べる。 |

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

## 本編BGM（ユーザー指定のMP3）と先頭無音カット

### 本編BGM
- 本編（冒頭LINEオーバーレイの間を含む）だけに小さく流す。ダイジェスト（既存BGM）・末尾LINE案内（無音）には使わない。別のフィルタチェーンなので同時に鳴らない。
- 設定（`mainBgm`）: `enabled`（既定OFF）/ `sourcePath` / `volume`（標準0.05・上限0.06）/ `autoGain` / `ducking` / `loop` / `fadeInSec`（1.5）/ `fadeOutSec`（2.5）/ `scope: 'main'`。素材未指定・OFFなら従来どおり。ONで素材が無い・使えないときはレンダー開始前に停止する。
- MP3は許可ルート（`VIDEO_INPUT_ROOTS`）内を直接参照（アップロード・コピーしない）。UIは「MP3ファイルを選択」（候補はファイル名と不透明なIDだけ）。CLI/環境設定は `COMPOSITION_MAIN_BGM_PATH`。
- 検証は ffprobe の実データ（音声ストリーム・コーデックmp3・duration）。拡張子・Content-Type は信用しない。
- 音量: MP3と本編トークの発話中のRMSを測り、声−BGM（ダッキング前）が目標差（ダッキングON 15.6dB / OFF 21.6dB）になる初期ゲインを決める。ユーザー音量は標準に対する倍率で、差が12dB未満になる上げ方はできない。
- ダッキング: 声をサイドチェインにした `sidechaincompress`（threshold 0.015・ratio 6・attack 60ms・release 1200ms・knee 6・makeup 1）。サイドチェインは120〜5000Hzに絞り `acompressor` で検出レベルをそろえる。
- ループ: 短いMP3は、1周目を曲の0秒から流し、2周目以降は自動選定したループ開始点（拍・音量・スペクトルの継ぎ目を実測して選ぶ。今回は34.56秒）から、末尾2秒→開始点直前2秒のクロスフェードで継ぎ目のない単位WAV（一時ファイル）を作り `-stream_loop -1` で繰り返す。長いMP3は本編の長さで切る。本編終了でフェードアウトして無音。
- 最終ミックスに `alimiter`（-1dBFS・`level=0:latency=1`。自動レベル補正を切り、先読み遅延を補正）。

### 先頭無音カット
- `server/lib/introCut.mjs`: 実音声の音量から最初の発話（息・口の立ち上がりを含む）を測り、その直前100〜150msを残して、0秒〜そこまでを削除（30fpsフレーム境界＝48kHzで1600サンプルの倍数）。
- `server/lib/mainEdit.mjs`: 同じタイムマップで映像・音声・caption・手動補完caption・テーマ・LINEオーバーレイ・BGM終了・末尾案内を変換。
- 冒頭の手動補完caption（`source: 'manual-intro-recovery'`、`full_v6.intro-recovery.json`）は確定済み（`confirmed: true`）のものだけ使う。既存captionは上書きしない。
- ランナー: `node scripts/localCaptionMainBgm.mjs intro-analyze|machinery|preview|preview-verify --job <id>`（詳細はスクリプト冒頭）。`preview` は `--main-bgm` が無ければ「素材待ち」で停止する。

---

## 正式ワークフロー（新しい動画を作る手順）と推奨初期値

「ダイジェスト → 本編（先頭無音カット・本編BGM・常時テーマ・冒頭/末尾LINE案内）」の正式版を、別の動画でも再現するための手順です。素材固有の値（パス・字幕本文・ID・秒数）はすべて Git 管理外のデータに置き、コード側にはありません。

### 1. 環境設定（`editor/.env`・Git管理外）
「環境変数」の表のとおり。最低限 `FFMPEG_BIN` / `FFPROBE_BIN` / `VIDEO_INPUT_ROOTS` / `VIDEO_OUTPUT_ROOT`。素材（元動画・MP3・QR）は **必ず `VIDEO_INPUT_ROOTS` の配下**に置く。出力先 `VIDEO_OUTPUT_ROOT` は実在するフォルダで、レンダー前に空き15GB以上が必要（実行中に10GB未満になったら安全に停止）。
素材が無い・読めない・許可ルート外の場合は、**レンダー開始前にエラーで停止**する（黙って省略しない）。

### 2. ジョブ作成 〜 文字起こし 〜 caption 編集（Web UI）
`npm run editor` → `http://localhost:3001/?mode=local-caption`。元動画を選んでジョブ作成 → 文字起こし → caption の追加・編集・削除・並び替え。
- captionType（normal / main / sub / emphasis）と部分強調（`emphasisText`。本文の完全な部分文字列・1captionにつき1か所）は UI で付ける。
- **トークテーマ**は本編全体を切れ目なく覆う区間として作る（未表示・重複0秒であること）。テーマ変更時は同じ位置でタイトルだけが入れ替わる。

### 3. 構成設定（ダイジェスト・遷移・LINE・BGM）
API/UI の `composition` 上書き（`POST /:id/render` ほか）で指定する。`profile: 'recommended'` を付けると、正式採用した推奨値（下記）を土台にできる。個別指定はその上に重ねる。
- ダイジェスト: `digest.enabled / durationSec / grayscale`（白黒）。
- 遷移: `transition.enabled / fadeOutFrames / holdFrames / fadeInFrames`（既定OFF。推奨プロファイルでON）。
- LINE: `lineIntro`（overlay・秒数・QR）/ `lineOutro`（秒数・QR）/ `qr.enabled`。
- 本編BGM: `mainBgm.enabled / volume / autoGain / ducking / loop / fadeInSec / fadeOutSec` と MP3 の選択。

### 4. 短時間プレビュー（動画は短く・本番の前に必ず）
- 通常のプレビュー: `POST /:id/preview-render`。
- 本編BGM付きの30〜60秒プレビュー: `POST /:id/main-bgm-preview`（BGMの音量・ダッキングを耳で確認。ダイジェスト・LINE案内は入らない）。

### 5. フルレンダー（Web UI / API）
`POST /:id/render`。一時ファイル（`.rendering-*`）へ書き、**成功したときだけ最終名へ rename**。失敗・中断時は一時ファイルを削除し、既存の動画は上書きしない。

### 6. 「確認動画 → 承認 → 最終版」の runner（`editor/scripts/`、15分級・再現性重視）
今回の正式版はこの流れで作った。各 runner は外部APIを呼ばず、保存データ（`editor/data/local_caption_comparisons/full/`、Git管理外）だけを使う。
1. `localCaptionFull.mjs align` — 全編をローカル whisper.cpp（DTW）で窓ごとに整列（**Whisper APIは使わない**）。`prepare` で種別・強調・テーマ・ダイジェストを内部検証。
2. `localCaptionMainBgm.mjs intro-analyze` — 先頭の無音を実測して、最初の息の直前100〜150msを残すカット点を決める。`intro-recovery` は冒頭の挨拶の補完caption（文言は人が確定し `confirmed: true`）。
3. **ダイジェストの発言選択**: 既定は `SHORT_DIGEST_PICKS`（この動画用）。別動画では Git管理外の `full_v6.digest-picks.json`（`[{ "firstIndex": 数, "lastIndex": 数, "emphasisText": "強調語" }, …]`、結論→理由の順、2件以上）を置くと `getDigestPicks()` がそちらを使う。形式が不正なら停止する。
4. `localCaptionMainBgm.mjs preview --job <id> --main-bgm <MP3> --bgm <ダイジェストBGM> --qr <QR>` — 確認動画（1本）。ダイジェスト末尾の余韻・暗転遷移・BGMループ境界の確認区間つき。試聴して承認する。
5. `localCaptionFinal.mjs precheck …` — レンダー前の必須確認（素材・SHA-256・空き容量・タイムライン連続・caption/テーマ/強調・BGM範囲・first_pts=0・出力名の衝突・字幕サイズ）。**1つでも失敗すれば止まる**。動画は作らず何も書かない。
6. `localCaptionFinal.mjs render …` — precheck通過後に **1回だけ**フルレンダー（空き容量を10秒ごとに監視し10GB未満で停止）。状態を `full_v6.final-state.json` に残し、存在すると再実行を拒否する。
7. `localCaptionFinal.mjs verify … --frames-dir <dir>` — レンダー後の検証（読み取りのみ）。

共通の引数: `--job <ジョブID> --main-bgm <MP3> --bgm <ダイジェストBGM> --qr <QR>`（素材は許可ルート内のパスをコマンドラインで渡す。ソースコードへ書かない）。

### 7. レンダー後の確認項目
duration（映像・音声・コンテナ）と総フレーム数 / 1920×1080・映像+音声ストリーム / 全編デコードエラー0 / 開始PTS / 冒頭・25%・50%・75%・終了付近のA/V同期と蓄積ドリフト（音声遅れ0msが基準。映像は元動画の29.9977fpsによる±1フレームのぶれが出る） / ダイジェスト末尾〜本編開始の遷移と最初の息 / ダイジェストBGM・本編BGMの範囲（末尾LINE案内は無音） / BGMループ境界すべてのクリック・音量差 / caption件数・テーマ常時表示・強調 / QR（冒頭・末尾の開始直後・中央・終了直前を 1920/430/390px で読み取り） / LINEパネルと字幕・テーマの重なり / 元素材・データ・既存動画の不変 / 一時ファイル残りなし / 空き容量。**代表フレームは必ず目視し、音声は人が聴いて確認する**（機械測定だけで「確認済み」としない）。

### 8. 失敗時の再開方法
- Web UI のレンダー: 失敗しても一時ファイルは残らない。ジョブは編集可能に戻るので、原因（素材・容量など）を直して再実行。
- runner の `render` が失敗: 不完全な完成ファイルは残らない。`full_v6.final-state.json`（`status: failed` と理由）を確認して削除してから再実行する（自動では再実行しない）。空き容量が原因なら先に空ける。
- 元動画・MP3・QR・ジョブJSONは読み取り専用で、失敗しても変更されない。

### 9. 外部APIが呼ばれる操作 / ローカルだけで完結する操作
| 操作 | 外部API |
|---|---|
| Web UI「文字起こしを開始」（`/start-processing`） | **OpenAI Whisper API（課金あり）** |
| Web UI「AIで種別を分類」（`/classify-captions`） | **OpenAI API（課金あり）** |
| `localCaptionFull.mjs align`（whisper.cpp）、`prepare`、`localCaptionCuts.mjs`、`localCaptionMainBgm.mjs`、`localCaptionFinal.mjs`（precheck / render / verify）、Web UIのcaption編集・プレビュー・フルレンダー | なし（ローカルの ffmpeg / whisper.cpp と保存データだけ） |

### 10. Git管理対象外になるもの
`editor/.env` / `editor/data/`（ジョブJSON・整列結果・比較データ・出力状態）/ 動画・音源・QR画像・生成物。素材や字幕本文・絶対パスはコミットしない（テストが追跡ファイルを検査する）。

### 11. 推奨初期値（今回正式採用）
- **ダイジェスト**: 約10秒（9〜12秒・2〜3クリップ・各2.5〜6.5秒）、結論→理由、白黒、専用BGM（音量0.05・フェードイン1.2/アウト2.0秒）、トークテーマ常時表示、字幕126px＋強調、最後の発話＋余韻0.25〜0.4秒（次の発話の語頭は混入させない）。
- **遷移**: 最終発話の余韻→黒へ10フレーム→黒3フレーム→本編へフェードイン9フレーム。黒の間は無音。ダイジェストBGMは本編へ漏らさない。
- **本編冒頭**: 先頭の無音のみカット（最初の息の直前100〜150msを残す）。それ以外の短い間・語中無音はカットしない。
- **本編BGM**: 音量0.05 / ダッキング threshold 0.015・ratio 6・attack 60ms・release 1200ms・knee 6・makeup 1（声検出120〜5000Hz） / 1周目は0秒から・2周目以降は自動選定した開始点 / クロスフェード2秒 / フェードイン1.5秒・アウト2.5秒 / リミッター −1dBFS（`level=0:latency=1`）。適用範囲は本編だけ。**音量は聴いて決めた値なので、機械測定値を理由に下げない**。
- **字幕**: normal 116px / main 122 / sub 109 / emphasis 116、トークテーマ84、`TALK THEME` 40。テーマ箱の幅は全テーマの最長タイトルに合わせて固定される（テーマが増えると確認動画より広くなり得る）。
- **LINE案内**: 冒頭は本編開始から30秒のオーバーレイ（動画の長さに加算しない・QRと見出しは最初のフレームから・本編は止めない）/ 末尾は12秒の独立区間（無音）/ 冒頭・末尾ともQR表示。
- **安全**: 出力は一時ファイル→成功時のみrename・既存動画は上書きしない・開始前15GB / 実行中10GB の空き容量・元素材は変更しない。
