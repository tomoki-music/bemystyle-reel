# 本番利用前チェックリスト

毎回の本番利用前に、このファイルのコマンドを上から順に実行してください。

---

## 1. 環境変数確認

`editor/.env` を開き、以下の設定を目視確認します。

```bash
cat editor/.env
```

### 確認項目

| 変数 | 本番時の値 | 説明 |
|---|---|---|
| `REEL_AI_MODE` | `openai`（または `anthropic`） | `mock` のままだとAI生成がスキップされる |
| `REEL_DRY_RUN` | `false`（または未設定） | `true` だと実際のAPI呼び出しが行われない |
| `REEL_TEST_IMAGE_LIMIT` | 未設定（または `0`） | 設定されていると画像生成数が制限される |

確認コマンド（各変数の値を個別に出力）:

```bash
grep -E "REEL_AI_MODE|REEL_DRY_RUN|REEL_TEST_IMAGE_LIMIT" editor/.env
```

問題がある場合は `editor/.env` を編集してから次の手順に進む。

---

## 2. テスト実行

```bash
cd editor && npm test
```

期待結果:

```
Test Files  1 passed (1)
    Tests  12 passed (12)
```

失敗があった場合はリリース中止。

---

## 3. ビルド確認

TypeScript の型エラーがないか確認します。

```bash
npx tsc --noEmit
```

エラーが出た場合はリリース中止。

---

## 4. MP4 生成確認

実際に MP4 が生成できるか確認します（数分かかります）。

```bash
npm run render
```

期待結果: `out/reel.mp4` が生成される。

```bash
ls -lh out/reel.mp4
```

ファイルサイズが 0 バイトでないこと・更新日時が今であることを確認。

---

## 5. 投稿前の目視確認

生成された `out/reel.mp4` を再生して以下を確認します。

- [ ] スライドの文字が正しく表示されている
- [ ] 画像が意図通りに配置されている
- [ ] 動画の長さが想定通りである
- [ ] 音声・テキストに誤字がない
- [ ] ブランドカラー・フォントが崩れていない

QuickLook で確認する場合:

```bash
open out/reel.mp4
```

---

## 6. git status 確認

意図しない変更がコミットされていないか確認します。

```bash
git status
```

```bash
git diff
```

コミットしていない変更が残っている場合は、意図的かどうかを確認してからリリースする。

---

## チェックリスト まとめ

| # | 確認内容 | コマンド | 通過条件 |
|---|---|---|---|
| 1 | 環境変数 | `grep -E "REEL_AI_MODE\|REEL_DRY_RUN\|REEL_TEST_IMAGE_LIMIT" editor/.env` | AI_MODE が mock でない、DRY_RUN が true でない |
| 2 | テスト | `cd editor && npm test` | Tests: 12 passed |
| 3 | 型チェック | `npx tsc --noEmit` | エラーなし |
| 4 | MP4 生成 | `npm run render` | `out/reel.mp4` が生成される |
| 5 | 目視確認 | `open out/reel.mp4` | 動画の内容が正しい |
| 6 | git status | `git status && git diff` | 意図しない変更がない |
