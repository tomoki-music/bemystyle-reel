# 台本作成モード（ScriptMode）

コンセプトからAIが3パターンの台本（教育系・共感系・煽り系）を作り、選んで編集し、コピーまたはスライド単位へ分割する画面。

## 開き方

`http://localhost:5173/?mode=script`（ローカル字幕モードの `?mode=local-caption` と同じ独立画面。既存のWizard/Factoryには触れない）。「← 戻る」で通常画面へ戻る。

## Wizard への受け渡し（「この台本で動画を作る」）

選択・編集した台本を、現行の Wizard（STEP2 のストーリー編集）へ渡して動画作成を始める。

- 渡すもの（`ScriptHandoff`、メモリ上だけ。URL・localStorage・ファイル・ログには入れない）: `title`（コンセプトの1行目 → パターン名 → 既定値）、`script`（編集後の台本）、`slides`（**現在の台本と一致する最新の分割結果があるときだけ**。台本を編集した後の古い分割結果は渡さない）。
- ボタンは外部APIを呼ばない。分割結果があればそれを、なければ台本を文（。！？・改行）ごとに区切って、Wizard のカードにする。
- **カード数は台本から作るときだけ 1〜14 の可変**（空カードで14枚へ水増ししない。AIも使わない）。15件以上になる場合だけ、隣り合う要素を均等にまとめて14枚に収める（切り捨て・重複・言い換えはしない。再結合すると元の台本と一致する）。
- roleは既存の14役割から決定的に割り当てる（先頭＝オープニング、末尾＝エンディング、間は重複なく順序を保って間引く。14枚は従来と同じ）。
- Wizard は STEP2 から始まり、テーマ＝タイトル。画像枠・「全Nシーン」・CTA（最終枚）などは実カード数に合わせる。動画生成側（`/api/slides`・Remotion）はもともと枚数に依存しない。通常起動・AI生成は従来どおり14枚固定。
- Wizard 側は最初のマウント時だけ受け取り、以降の再renderでユーザーの編集を上書きしない。STEP1へ戻っても、テーマを変えなければAIで作り直さない。「もう一度作り直す」を押したときだけ、従来どおりAIが置き換える。
- 通常起動（`?mode=` なし）の Wizard は従来どおり。

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
