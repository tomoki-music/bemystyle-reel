# 台本作成モード（ScriptMode）

コンセプトからAIが3パターンの台本（教育系・共感系・煽り系）を作り、選んで編集し、コピーまたはスライド単位へ分割する画面。

## 開き方

`http://localhost:5173/?mode=script`（ローカル字幕モードの `?mode=local-caption` と同じ独立画面。既存のWizard/Factoryには触れない）。「← 戻る」で通常画面へ戻る。

## API（`editor/server/scriptRoutes.mjs`、`/api` にマウント）

| メソッド・パス | リクエスト | 成功レスポンス |
|---|---|---|
| `POST /api/generate-script` | `{ "concept": string }`（1〜1000文字） | `{ ok: true, patterns: [{ title, script }] }`（最大3件） |
| `POST /api/split-script` | `{ "script": string }`（1〜8000文字） | `{ ok: true, slides: [{ text }] }`（最大14件） |

失敗時は `{ ok: false, message }`。

| ステータス | 意味 |
|---|---|
| 400 | 入力が空・型違い・長すぎる（OpenAIは呼ばない） |
| 500 | `OPENAI_API_KEY` 未設定（OpenAIは呼ばない） |
| 502 | OpenAIのエラー・接続失敗・AI応答の形式不正 |
| 504 | タイムアウト（60秒） |

## 安全方針

- サーバーは `127.0.0.1` 固定（既存の `app.listen`）。APIキーは環境変数 `OPENAI_API_KEY` だけから読む。
- OpenAIのエラー本文（キーの一部を含み得る）・入力・AI出力は、レスポンスにもログにも出さない。エラーは固定メッセージへ変換する。
- 自動リトライなし。入力は保存しない。`REEL_AI_MODE=mock` のときは外部へ出ず固定の応答を返す。
- モデルは既定 `gpt-4o-mini`。環境変数 `SCRIPT_AI_MODEL` で変更できる。

## テスト

`npm test`（`server/scriptRoutes.test.mjs`、`src/components/script/ScriptMode.test.tsx`、`src/App.modes.test.tsx`）。OpenAIへは接続せず、`fetch` はすべてモック。
